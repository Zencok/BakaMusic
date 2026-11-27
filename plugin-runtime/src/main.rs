//! Bounded stdio transport around the shared, strict native V2 package host.
mod lx_v2_migration;

use baka_core::BakaError;
use baka_plugin_host::{PluginHost, plugin_network::PluginNetwork};
use futures_util::future::{AbortHandle, Abortable};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{Semaphore, mpsc},
    task::JoinSet,
};

const MAX_FRAME: usize = 16 * 1024 * 1024;
const MAX_PENDING: usize = 128;
const WORKERS: usize = 4;
const RUNTIME: &str = "rust-quickjs-v2";

#[derive(Debug)]
struct Error {
    number: i32,
    code: &'static str,
    message: String,
    failure: Option<String>,
}
impl Error {
    fn new(number: i32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            number,
            code,
            message: message.into(),
            failure: None,
        }
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self::new(-32602, "invalid_params", message)
    }
    fn cancelled() -> Self {
        Self::new(-32002, "cancelled", "Plugin request cancelled")
    }
    fn response(&self, id: Value) -> Value {
        let mut data = json!({"code":self.code});
        if let Some(failure) = &self.failure {
            data["failureCode"] = json!(failure);
        }
        json!({"jsonrpc":"2.0","id":id,"error":{"code":self.number,
            "message":baka_logging::redact(&self.message),"data":data}})
    }
}
impl From<BakaError> for Error {
    fn from(error: BakaError) -> Self {
        match error {
            BakaError::PluginFailure { code } => Self {
                number: -32000,
                code: "plugin_failure",
                message: "Plugin capability failed".into(),
                failure: Some(code),
            },
            BakaError::Js { message, .. } if message == "plugin_host_stopped" => {
                Self::new(-32005, "host_stopped", "Plugin context was stopped")
            }
            other => Self::new(-32000, "plugin_error", other.to_string()),
        }
    }
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    jsonrpc: String,
    id: String,
    method: String,
    params: Value,
    #[serde(skip)]
    load_generation: Option<u64>,
    #[serde(skip)]
    invoke_host: Option<Arc<PluginHost>>,
    #[serde(skip)]
    import_scope: Option<Arc<ImportScope>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Inspect {
    code: String,
    #[serde(default = "object")]
    settings: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Load {
    plugin_id: String,
    code: String,
    #[serde(default = "object")]
    settings: Value,
    storage_root: String,
    proxy_url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Invoke {
    plugin_id: String,
    capability: String,
    request: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    plugin_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cancel {
    request_id: String,
}
fn object() -> Value {
    json!({})
}
fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| Error::invalid("Invalid method parameters"))
}
fn settings(value: &Value) -> Result<()> {
    if value.is_object() {
        Ok(())
    } else {
        Err(Error::invalid("Settings must be an object"))
    }
}
fn descriptor(id: &str, manifest: Value) -> Value {
    json!({"id":id,"manifest":manifest,"protocolVersion":2,"runtime":RUNTIME})
}

#[derive(Default)]
struct Registry {
    hosts: HashMap<String, Arc<PluginHost>>,
    loading: HashMap<String, Weak<PluginHost>>,
    generations: HashMap<String, u64>,
    next: u64,
    imports: HashMap<String, Weak<ImportScope>>,
}

/// A disposable initializer belongs to its admitted request, including while
/// queued. Clearing the registry revokes it before any later evaluation or I/O.
#[derive(Default)]
struct ImportState {
    stopped: bool,
    hosts: Vec<Weak<PluginHost>>,
}
#[derive(Default)]
struct ImportScope(Mutex<ImportState>);
impl ImportScope {
    fn active(&self) -> Result<()> {
        if self.0.lock().unwrap_or_else(|p| p.into_inner()).stopped {
            Err(Error::new(
                -32005,
                "host_stopped",
                "Plugin import was retired",
            ))
        } else {
            Ok(())
        }
    }
    fn observe(&self, host: &Arc<PluginHost>) -> std::result::Result<(), String> {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if state.stopped {
            host.shutdown();
            return Err("Plugin import was retired".into());
        }
        state.hosts.push(Arc::downgrade(host));
        Ok(())
    }
    fn stop(&self) {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        state.stopped = true;
        for host in std::mem::take(&mut state.hosts)
            .into_iter()
            .filter_map(|host| host.upgrade())
        {
            host.shutdown();
        }
    }
}
struct ImportGuard(Arc<ImportScope>);
impl Drop for ImportGuard {
    fn drop(&mut self) {
        self.0.stop();
    }
}
#[derive(Default)]
struct Engine {
    registry: Mutex<Registry>,
    pending: Mutex<HashMap<String, AbortHandle>>,
}
impl Engine {
    fn host(&self, id: &str) -> Result<Arc<PluginHost>> {
        self.registry
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .hosts
            .get(id)
            .cloned()
            .ok_or_else(|| Error::new(-32001, "not_loaded", "Plugin is not loaded"))
    }
    fn begin_load(&self, id: &str) -> u64 {
        let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
        registry.next = registry
            .next
            .checked_add(1)
            .expect("plugin generation exhausted");
        let generation = registry.next;
        registry.generations.insert(id.into(), generation);
        if let Some(previous) = registry.loading.remove(id).and_then(|host| host.upgrade()) {
            previous.shutdown();
        }
        generation
    }
    fn observe_load(&self, id: &str, generation: u64, host: &Arc<PluginHost>) -> Result<()> {
        let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
        if registry.generations.get(id) != Some(&generation) {
            return Err(Error::new(
                -32005,
                "host_stopped",
                "Plugin load was retired",
            ));
        }
        registry.loading.insert(id.into(), Arc::downgrade(host));
        Ok(())
    }
    fn publish(&self, id: &str, generation: u64, host: Arc<PluginHost>) -> Result<()> {
        let previous = {
            let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
            if registry.generations.get(id) != Some(&generation) {
                return Err(Error::new(
                    -32005,
                    "host_stopped",
                    "Plugin load was retired",
                ));
            }
            registry.loading.remove(id);
            registry.hosts.insert(id.into(), host)
        };
        if let Some(previous) = previous {
            previous.shutdown();
        }
        Ok(())
    }
    fn unload(&self, id: &str) {
        let previous = {
            let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
            registry.generations.remove(id);
            if let Some(loading) = registry.loading.remove(id).and_then(|host| host.upgrade()) {
                loading.shutdown();
            }
            registry.hosts.remove(id)
        };
        if let Some(previous) = previous {
            previous.shutdown();
        }
    }
    fn clear(&self) {
        let hosts = {
            let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
            registry.generations.clear();
            for scope in std::mem::take(&mut registry.imports)
                .into_values()
                .filter_map(|scope| scope.upgrade())
            {
                scope.stop();
            }
            for loading in std::mem::take(&mut registry.loading)
                .into_values()
                .filter_map(|host| host.upgrade())
            {
                loading.shutdown();
            }
            std::mem::take(&mut registry.hosts)
        };
        for host in hosts.into_values() {
            host.shutdown();
        }
    }
    fn cancel(&self, id: &str) -> bool {
        let pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(handle) = pending.get(id) {
            handle.abort();
            true
        } else {
            false
        }
    }
    fn stop(&self) {
        self.clear();
        for handle in self
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
        {
            handle.abort();
        }
    }
    async fn dispatch(&self, request: &Request) -> Result<Value> {
        match request.method.as_str() {
            "prepareImport" => {
                let scope = request
                    .import_scope
                    .as_ref()
                    .expect("admitted import scope");
                let _guard = ImportGuard(scope.clone());
                scope.active()?;
                let network = PluginNetwork::default();
                let proxy = request.params.get("proxyUrl");
                if proxy.is_some_and(|value| !value.is_null() && !value.is_string()) {
                    return Err(Error::invalid("Proxy URL must be a string"));
                }
                network
                    .configure(proxy.and_then(Value::as_str), false)
                    .map_err(Error::invalid)?;
                let result = lx_v2_migration::prepare_import(&request.params, network, scope)
                    .await
                    .map_err(|message| Error::new(-32000, "plugin_import", message))?;
                scope.active()?;
                Ok(result)
            }
            "inspect" => {
                let input: Inspect = parse(request.params.clone())?;
                settings(&input.settings)?;
                let manifest = PluginHost::inspect_source(&input.code, input.settings).await?;
                let id = manifest["id"]
                    .as_str()
                    .expect("validated manifest id")
                    .to_owned();
                Ok(descriptor(&id, manifest))
            }
            "load" => {
                let input: Load = parse(request.params.clone())?;
                settings(&input.settings)?;
                if !Path::new(&input.storage_root).is_absolute() {
                    return Err(Error::invalid("Storage root must be absolute"));
                }
                let generation = request.load_generation.expect("admitted load generation");
                let network = PluginNetwork::default();
                network
                    .configure(input.proxy_url.as_deref(), false)
                    .map_err(Error::invalid)?;
                let host =
                    Arc::new(PluginHost::new_with_network(input.plugin_id.clone(), network).await?);
                let mut provisional = Provisional(Some(host.clone()));
                // A loading context is revocable before any source evaluation
                // or initialization I/O, as well as after registry publication.
                self.observe_load(&input.plugin_id, generation, &host)?;
                host.configure_storage(Path::new(&input.storage_root))
                    .await?;
                host.eval(&format!("globalThis.env={};", input.settings))
                    .await?;
                host.load_v2_script(&input.code).await?;
                host.eval("delete globalThis.env").await?;
                let manifest = host.manifest().await?;
                self.publish(&input.plugin_id, generation, host.clone())?;
                provisional.0 = None;
                tokio::spawn(host.background_driver());
                Ok(descriptor(&input.plugin_id, manifest))
            }
            "invoke" => {
                let input: Invoke = parse(request.params.clone())?;
                if !input.request.is_object() {
                    return Err(Error::invalid("Capability request must be an object"));
                }
                let host = request
                    .invoke_host
                    .as_ref()
                    .expect("admitted invocation host");
                let result = host.call_entry(&input.capability, &[input.request]).await?;
                // Do not publish a result from a replaced context.
                if !Arc::ptr_eq(&self.host(&input.plugin_id)?, host) {
                    return Err(Error::new(
                        -32005,
                        "host_stopped",
                        "Plugin context was replaced",
                    ));
                }
                Ok(result)
            }
            _ => Err(Error::new(
                -32601,
                "method_not_found",
                "Unknown plugin runtime method",
            )),
        }
    }
    fn control(&self, request: &Request) -> Option<Result<Value>> {
        Some(match request.method.as_str() {
            "health" => {
                if request.params == object() {
                    Ok(json!({"protocolVersion":2,"runtime":RUNTIME}))
                } else {
                    Err(Error::invalid("health expects empty parameters"))
                }
            }
            "unload" => parse::<Identity>(request.params.clone()).map(|input| {
                self.unload(&input.plugin_id);
                Value::Null
            }),
            "clear" => {
                if request.params == object() {
                    self.clear();
                    Ok(Value::Null)
                } else {
                    Err(Error::invalid("clear expects empty parameters"))
                }
            }
            "cancel" => parse::<Cancel>(request.params.clone())
                .map(|input| json!(self.cancel(&input.request_id))),
            _ => return None,
        })
    }
}
struct Provisional(Option<Arc<PluginHost>>);
impl Drop for Provisional {
    fn drop(&mut self) {
        if let Some(host) = &self.0 {
            host.shutdown();
        }
    }
}
fn response(id: &str, result: Result<Value>) -> Value {
    match result {
        Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
        Err(error) => error.response(json!(id)),
    }
}

/// Reject overlong frames before accumulating unbounded input.
async fn frame(
    reader: &mut BufReader<tokio::io::Stdin>,
    line: &mut Vec<u8>,
) -> std::io::Result<Option<Vec<u8>>> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then(|| std::mem::take(line)));
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map_or(available.len(), |n| n + 1);
        if line.len() + count > MAX_FRAME {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "RPC frame exceeds 16 MiB",
            ));
        }
        line.extend_from_slice(&available[..count]);
        let complete = available[count - 1] == b'\n';
        reader.consume(count);
        if complete {
            return Ok(Some(std::mem::take(line)));
        }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 6)]
async fn main() -> std::io::Result<()> {
    let engine = Arc::new(Engine::default());
    let semaphore = Arc::new(Semaphore::new(WORKERS));
    let (send, mut receive) = mpsc::channel::<Value>(MAX_PENDING);
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(value) = receive.recv().await {
            let mut bytes = serde_json::to_vec(&value)?;
            if bytes.len() + 1 > MAX_FRAME {
                bytes = serde_json::to_vec(
                    &Error::new(
                        -32010,
                        "response_too_large",
                        "Plugin response exceeds 16 MiB",
                    )
                    .response(value["id"].clone()),
                )?;
            }
            bytes.push(b'\n');
            stdout.write_all(&bytes).await?;
            stdout.flush().await?;
        }
        Ok::<_, std::io::Error>(())
    });
    let mut reader = BufReader::new(tokio::io::stdin());
    // Partial bytes survive select cancellation when another task finishes.
    let mut incoming = Vec::new();
    let mut jobs = JoinSet::new();
    loop {
        let next = tokio::select! {
            value = frame(&mut reader, &mut incoming) => value,
            _ = send.closed() => break,
            _ = jobs.join_next(), if !jobs.is_empty() => continue,
        };
        let line = match next {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                eprintln!("{}", baka_logging::redact(&error.to_string()));
                break;
            }
        };
        let input = serde_json::from_slice::<Value>(&line);
        let request = input.and_then(serde_json::from_value::<Request>);
        let mut request = match request {
            Ok(request)
                if request.jsonrpc == "2.0"
                    && !request.id.is_empty()
                    && request.id.len() <= 128
                    && request.params.is_object() =>
            {
                request
            }
            _ => {
                if send
                    .send(
                        Error::new(-32600, "invalid_request", "Invalid JSON-RPC request")
                            .response(Value::Null),
                    )
                    .await
                    .is_err()
                {
                    break;
                }
                continue;
            }
        };
        // IDs must be unique, including for cancellation and other controls.
        if engine
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains_key(&request.id)
        {
            let _ = send
                .send(
                    Error::new(-32600, "duplicate_id", "Request ID is already active")
                        .response(json!(request.id)),
                )
                .await;
            continue;
        }
        if let Some(result) = engine.control(&request) {
            if send.send(response(&request.id, result)).await.is_err() {
                break;
            }
            continue;
        }
        let (abort, registration) = AbortHandle::new_pair();
        let admitted = {
            let mut pending = engine.pending.lock().unwrap_or_else(|p| p.into_inner());
            if pending.len() >= MAX_PENDING {
                false
            } else {
                pending.insert(request.id.clone(), abort);
                true
            }
        };
        if !admitted {
            let _ = send
                .send(
                    Error::new(-32004, "busy", "Plugin runtime request limit reached")
                        .response(json!(request.id)),
                )
                .await;
            continue;
        }
        // Reserve at admission, before waiting for a permit. A later clear or
        // unload also retires queued loads; rejected overloads have no effect.
        if request.method == "load" {
            match parse::<Load>(request.params.clone()) {
                Ok(input) => request.load_generation = Some(engine.begin_load(&input.plugin_id)),
                Err(error) => {
                    engine
                        .pending
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .remove(&request.id);
                    let _ = send.send(error.response(json!(request.id))).await;
                    continue;
                }
            }
        }
        if request.method == "invoke" {
            let host = parse::<Invoke>(request.params.clone())
                .and_then(|input| engine.host(&input.plugin_id));
            match host {
                Ok(host) => request.invoke_host = Some(host),
                Err(error) => {
                    engine
                        .pending
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .remove(&request.id);
                    let _ = send.send(error.response(json!(request.id))).await;
                    continue;
                }
            }
        }
        if request.method == "prepareImport" {
            let scope = Arc::new(ImportScope::default());
            engine
                .registry
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .imports
                .insert(request.id.clone(), Arc::downgrade(&scope));
            request.import_scope = Some(scope);
        }
        let engine = engine.clone();
        let semaphore = semaphore.clone();
        let send = send.clone();
        jobs.spawn(async move {
            let work = async {
                let seconds = match request.method.as_str() {
                    "invoke" => 30,
                    "prepareImport" => 15,
                    _ => 10,
                };
                tokio::time::timeout(Duration::from_secs(seconds), async {
                    let _permit = semaphore.acquire().await.map_err(|_| Error::cancelled())?;
                    engine.dispatch(&request).await
                })
                .await
                .unwrap_or_else(|_| Err(Error::new(-32003, "deadline", "Plugin request timed out")))
            };
            let result = Abortable::new(work, registration)
                .await
                .unwrap_or_else(|_| Err(Error::cancelled()));
            engine
                .pending
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&request.id);
            engine
                .registry
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .imports
                .remove(&request.id);
            let _ = send.send(response(&request.id, result)).await;
        });
    }
    engine.stop();
    while jobs.join_next().await.is_some() {}
    drop(send);
    writer.await??;
    Ok(())
}
