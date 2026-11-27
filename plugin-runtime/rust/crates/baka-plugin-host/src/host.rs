//! One isolated QuickJS runtime + context per plugin.

use std::sync::{Arc, Mutex};
use std::{
    collections::HashMap,
    future::{Future, poll_fn},
    sync::{
        Weak,
        atomic::{AtomicU64, Ordering},
    },
    task::{Context, Poll, Wake, Waker},
};

use baka_core::{BakaError, Result};
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, Coerced, Ctx, Function, Object, Value,
    function::Rest,
};

use crate::lifecycle::Lifecycle;
use crate::shim;

/// Plugins can allocate a lot while parsing a big search response, but a
/// runaway script must not take the app down with it.
const MEMORY_LIMIT: usize = 128 * 1024 * 1024;

/// QuickJS defaults to 256 KiB. Several harvested scripts use recursive
/// descent parsers, so give them room before blaming the host for a stack
/// overflow that is really a plugin bug.
const STACK_SIZE: usize = 2 * 1024 * 1024;

/// Upper bound on captured `console` lines. Plugins log per search result, so
/// an unbounded buffer would grow for as long as the app runs.
const LOG_CAPACITY: usize = 2000;

/// Identity of a loaded plugin. Carried into every error so a failure names the
/// plugin that caused it instead of just "javascript error".
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ScriptId(String);

impl ScriptId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ScriptId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for ScriptId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for ScriptId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

type LogSink = Arc<Mutex<Vec<String>>>;

type CallWakers = Arc<Mutex<HashMap<u64, Waker>>>;
struct RuntimeWake(Weak<Mutex<HashMap<u64, Waker>>>, AtomicU64);
impl Wake for RuntimeWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.1.fetch_add(1, Ordering::Relaxed);
        if let Some(calls) = self.0.upgrade() {
            let wakers: Vec<_> = calls
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .values()
                .cloned()
                .collect();
            for waker in wakers {
                waker.wake();
            }
        }
    }
}
struct CallRegistration {
    calls: CallWakers,
    id: u64,
}
impl Drop for CallRegistration {
    fn drop(&mut self) {
        let wakers: Vec<_> = {
            let mut calls = self.calls.lock().unwrap_or_else(|p| p.into_inner());
            calls.remove(&self.id);
            calls.values().cloned().collect()
        };
        for waker in wakers {
            waker.wake();
        }
    }
}

/// A single plugin's JavaScript world.
///
/// Each `PluginHost` owns its own [`AsyncRuntime`] and [`AsyncContext`], so two
/// plugins cannot see or clobber each other's globals. That is the whole point
/// of isolated package execution.
pub struct PluginHost {
    v2: crate::v2::V2State,
    inspect: bool,
    storage_root: Mutex<Option<std::path::PathBuf>>,
    call_scopes: crate::call_scope::CallScopes,
    lifecycle: Arc<Lifecycle>,
    background_abort: Mutex<Option<futures_util::future::AbortHandle>>,
    call_wakers: CallWakers,
    call_sequence: AtomicU64,
    id: ScriptId,
    runtime: AsyncRuntime,
    context: AsyncContext,
    logs: LogSink,
    deadline: Arc<Mutex<std::time::Instant>>,
}

impl PluginHost {
    pub fn account_revision(&self) -> u64 {
        self.v2.account_epoch.load(Ordering::Acquire)
    }
    /// Build an isolated context with the generic native V2 SDK.
    pub async fn new(id: impl Into<ScriptId>) -> Result<Self> {
        Self::new_with_network(id, crate::plugin_network::PluginNetwork::default()).await
    }

    pub async fn new_with_network(
        id: impl Into<ScriptId>,
        network: crate::plugin_network::PluginNetwork,
    ) -> Result<Self> {
        Self::new_profile(id.into(), network, false).await
    }

    async fn new_profile(
        id: ScriptId,
        network: crate::plugin_network::PluginNetwork,
        inspect: bool,
    ) -> Result<Self> {
        let runtime = AsyncRuntime::new().map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
        runtime.set_memory_limit(MEMORY_LIMIT).await;
        runtime.set_max_stack_size(STACK_SIZE).await;

        let deadline = Arc::new(Mutex::new(
            std::time::Instant::now() + std::time::Duration::from_secs(30),
        ));
        let lifecycle = Arc::new(Lifecycle::default());
        let interrupt_lifecycle = lifecycle.clone();
        let interrupt_deadline = deadline.clone();
        runtime
            .set_interrupt_handler(Some(Box::new(move || {
                interrupt_lifecycle.is_stopped()
                    || std::time::Instant::now()
                        > *interrupt_deadline.lock().unwrap_or_else(|p| p.into_inner())
            })))
            .await;

        let context = AsyncContext::full(&runtime)
            .await
            .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;

        let logs: LogSink = Arc::new(Mutex::new(Vec::new()));
        let call_scopes = crate::call_scope::CallScopes::default();

        let install = {
            let network = network.clone();
            let id = id.clone();
            let logs = logs.clone();
            let scopes = call_scopes.clone();
            context
                .with(move |ctx| {
                    install_console(&ctx, &id, logs)?;
                    shim::install_v2_scoped(&ctx, network.clone(), scopes)?;
                    ctx.eval::<(), _>(include_str!("v2.js")).catch(&ctx).map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
                    if inspect { ctx.eval::<(), _>("for(const k of ['http','timer_wait','delay']) __baka[k]=()=>{throw Error('inspection does not allow I/O')}").map_err(|e|BakaError::js(id.as_str(),e.to_string()))?; }
                    Ok::<_, BakaError>(())
                })
                .await
        };
        install?;

        Ok(Self {
            v2: Default::default(),
            inspect,
            storage_root: Mutex::new(None),
            call_scopes,
            lifecycle,
            background_abort: Mutex::new(None),
            call_wakers: Arc::new(Mutex::new(HashMap::new())),
            call_sequence: AtomicU64::new(0),
            id,
            runtime,
            context,
            logs,
            deadline,
        })
    }

    /// Terminal for this context, including callers retaining an Arc. A future
    /// online activation must create a fresh host; it cannot resume this one.
    pub fn shutdown(&self) {
        self.lifecycle.stop();
        self.call_scopes.stop();
        self.stop_background_driver();
    }

    /// Stop the independent background job driver.
    pub fn stop_background_driver(&self) {
        if let Some(abort) = self
            .background_abort
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            abort.abort();
        }
    }

    /// Install durable plugin storage under the application support directory.
    pub async fn configure_storage(&self, root: &std::path::Path) -> Result<()> {
        if !root.is_absolute() {
            return Err(BakaError::js(
                self.id.as_str(),
                "storage root must be absolute",
            ));
        }
        if self.inspect {
            return Err(BakaError::js(
                self.id.as_str(),
                "inspection cannot configure storage",
            ));
        }
        *self.storage_root.lock().unwrap_or_else(|p| p.into_inner()) = Some(root.to_owned());
        if self
            .v2
            .manifest
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_some()
        {
            self.install_storage().await?;
        }
        Ok(())
    }

    async fn install_storage(&self) -> Result<()> {
        let root = self
            .storage_root
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Some(root) = root {
            let id = self.id.as_str().to_owned();
            self.context
                .with(move |ctx| {
                    shim::storage::install(&ctx, root, &id)
                        .map_err(|e| BakaError::js(&id, e.to_string()))
                })
                .await?;
        }
        Ok(())
    }

    async fn run<T>(&self, work: impl Future<Output = Result<T>>) -> Result<T> {
        self.lifecycle
            .run(work)
            .await
            .map_err(|_| BakaError::js(self.id.as_str(), "plugin_host_stopped"))?
    }

    fn reset_deadline(&self) {
        *self.deadline.lock().unwrap_or_else(|p| p.into_inner()) =
            std::time::Instant::now() + std::time::Duration::from_secs(30);
    }

    /// The owner spawns this once on its long-lived executor after successful
    /// package initialization. The driver owns only a weak QuickJS runtime reference;
    /// dropping/replacing the host aborts it, including idle interval workloads.
    pub fn background_driver(&self) -> impl Future<Output = ()> + Send + 'static {
        let (abort, cancellation) = futures_util::future::AbortHandle::new_pair();
        {
            let mut background = self
                .background_abort
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            if let Some(previous) = background.replace(abort) {
                previous.abort();
            }
            if self.lifecycle.is_stopped()
                && let Some(abort) = background.as_ref()
            {
                abort.abort();
            }
        }
        let driver = self.runtime.drive();
        let calls = self.call_wakers.clone();
        let registration = CallRegistration {
            calls: calls.clone(),
            id: self.call_sequence.fetch_add(1, Ordering::Relaxed),
        };
        let deadline = self.deadline.clone();
        async move {
            let work = async move {
                let mut driver = std::pin::pin!(driver);
                let wake = Waker::from(Arc::new(RuntimeWake(
                    Arc::downgrade(&calls),
                    AtomicU64::new(0),
                )));
                poll_fn(|cx| {
                    let idle = {
                        let mut calls = calls.lock().unwrap_or_else(|p| p.into_inner());
                        calls.insert(registration.id, cx.waker().clone());
                        calls.len() == 1
                    };
                    // Do not extend the deadline of an active foreground call.
                    // Refresh an idle host's budget only at an executor wake,
                    // never from inside its JS jobs (which may spin forever).
                    if idle {
                        *deadline.lock().unwrap_or_else(|p| p.into_inner()) =
                            std::time::Instant::now() + std::time::Duration::from_secs(5);
                    }
                    driver.as_mut().poll(&mut Context::from_waker(&wake))
                })
                .await;
                drop(registration);
            };
            let _ = futures_util::future::Abortable::new(work, cancellation).await;
        }
    }

    pub fn id(&self) -> &ScriptId {
        &self.id
    }

    /// Snapshot of everything the plugin has logged so far.
    pub fn logs(&self) -> Vec<String> {
        self.logs.lock().map(|l| l.clone()).unwrap_or_default()
    }

    /// Snapshot, then clear. Useful between calls in a test.
    pub fn take_logs(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|mut l| std::mem::take(&mut *l))
            .unwrap_or_default()
    }

    /// Evaluate a script for its side effects, then drain the job queue.
    ///
    /// Intended for host environment setup and diagnostics.
    pub async fn eval(&self, source: &str) -> Result<()> {
        self.run(self.eval_inner(source)).await
    }

    async fn eval_inner(&self, source: &str) -> Result<()> {
        self.reset_deadline();
        let id = self.id.clone();
        self.context
            .with(move |ctx| {
                ctx.eval::<Value, _>(source)
                    .catch(&ctx)
                    .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
                Ok::<_, BakaError>(())
            })
            .await?;
        self.runtime.idle().await;
        Ok(())
    }

    /// Disposable inspection rejects initialization I/O and cannot call handlers.
    pub async fn inspect_source(
        source: &str,
        variables: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let host = Self::new_profile(ScriptId::new("inspection"), Default::default(), true).await?;
        if !variables.is_object() {
            return Err(BakaError::js("inspection", "variables must be an object"));
        }
        host.eval(&format!("globalThis.env={variables}")).await?;
        host.load_v2_script(source).await?;
        host.manifest().await
    }
    /// Complete validated immutable manifest snapshot.
    pub async fn manifest(&self) -> Result<serde_json::Value> {
        self.v2
            .manifest
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .ok_or_else(|| BakaError::js(self.id.as_str(), "V2 package not loaded"))
    }
    pub async fn load_v2_script(&self, source: &str) -> Result<()> {
        self.run(async {
            if source.lines().next() != Some("// @baka-provider 2") {
                return Err(BakaError::js(self.id.as_str(), "exact V2 source marker required"));
            }
            if self.v2.manifest.lock().unwrap_or_else(|p| p.into_inner()).is_some() {
                return Err(BakaError::js(self.id.as_str(), "package already loaded"));
            }
            let wrapped = format!("globalThis.module={{exports:{{}}}};globalThis.exports=module.exports;(function(module,exports){{'use strict';\n{source}\n}})(module,module.exports);");
            self.eval_inner(&wrapped).await?;
            let manifest = self.eval_json_inner(include_str!("manifest_snapshot.js")).await?;
            let validated = baka_core::plugin_contract::PackageManifest::from_value(manifest)
                .map_err(|e| BakaError::js(self.id.as_str(), e.to_string()))?;
            if !self.inspect && validated.id() != self.id.as_str() {
                return Err(BakaError::js(self.id.as_str(), "manifest id does not match storage identity"));
            }
            let manifest: serde_json::Value = validated.into();
            self.eval_inner(&format!("__baka_v2_install(module.exports,{manifest})")).await?;
            self.install_storage().await?;
            *self.v2.manifest.lock().unwrap_or_else(|p| p.into_inner()) = Some(manifest);
            Ok(())
        }).await
    }

    pub async fn call_entry(
        &self,
        name: &str,
        args: &[serde_json::Value],
    ) -> Result<serde_json::Value> {
        if self.inspect {
            return Err(BakaError::js(
                self.id.as_str(),
                "inspection cannot execute handlers",
            ));
        }
        let manifest = self.manifest().await?;
        if !manifest["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some(name))
        {
            return Err(BakaError::js(
                self.id.as_str(),
                format!("undeclared V2 capability: {name}"),
            ));
        }
        let call = self.v2.prepare(name, args, self.id.as_str())?;
        let result = self
            .run(self.call_entry_inner(name, std::slice::from_ref(&call.request)))
            .await?;
        self.v2.finish(call, result, self.id.as_str())
    }

    async fn call_entry_inner(
        &self,
        name: &str,
        args: &[serde_json::Value],
    ) -> Result<serde_json::Value> {
        self.reset_deadline();
        let id = self.id.clone();
        let name_for_err = name.to_string();
        let name_json = serde_json::to_string(name)?;
        let args_json = serde_json::to_string(args)?;
        let owner = self.call_scopes.begin();
        let scope_id = owner.id;

        let outcome = Arc::new(Mutex::new(None));
        let completed = outcome.clone();
        let registration = CallRegistration {
            calls: self.call_wakers.clone(),
            id: self.call_sequence.fetch_add(1, Ordering::Relaxed),
        };
        let completion_calls = registration.calls.clone();
        let completion_id = registration.id;
        // Register before context-lock acquisition, since another caller can
        // execute our jobs while we wait for that lock.
        let notifier = Arc::new(RuntimeWake(
            Arc::downgrade(&self.call_wakers),
            AtomicU64::new(0),
        ));
        let invocation = async {
            self.context.with(move |ctx| {
            let _context = crate::call_scope::EnteredContext::new(&ctx, scope_id);
            let callback = Function::new(ctx.clone(), move |ok: bool, value: String| {
                *completed.lock().unwrap_or_else(|p| p.into_inner()) = Some((ok, value));
                // Another caller may execute this job. Wake the result's owner,
                // even when the shared runtime has no remaining I/O to wake it.
                let waker = completion_calls.lock().unwrap_or_else(|p| p.into_inner())
                    .get(&completion_id).cloned();
                if let Some(waker) = waker { waker.wake(); }
            }).catch(&ctx).map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
            let call = format!("(done => Promise.resolve(__baka_call_entry({name_json}, {args_json})).then(v => done(true, v), e => {{ let code; try {{ code=e && e.code; }} catch (_) {{}} const allowed=['quality_unavailable','track_unavailable','authentication_required','permission_denied','rate_limited','temporary_unavailable','signature_expired']; done(false, allowed.includes(code) ? JSON.stringify({{__bakaFailure:code}}) : String(e && e.message || e)); }}))");
            let invoke = ctx.eval::<Function, _>(call).catch(&ctx)
                .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
            invoke.call::<_, Value>((callback,)).catch(&ctx)
                .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
            Ok::<_, BakaError>(())
        }).await?;
            // No JS Value lives across an await. Cancelling an FFI call must not
            // free a Promise from another thread outside QuickJS's runtime lock.
            loop {
                if let Some((ok, value)) = outcome.lock().unwrap_or_else(|p| p.into_inner()).take()
                {
                    return if ok {
                        serde_json::from_str(&value).map_err(BakaError::from)
                    } else {
                        if let Ok(failure) = serde_json::from_str::<serde_json::Value>(&value) {
                            if let Some(code) = failure["__bakaFailure"].as_str().filter(|code| {
                                [
                                    "quality_unavailable",
                                    "track_unavailable",
                                    "authentication_required",
                                    "permission_denied",
                                    "rate_limited",
                                    "temporary_unavailable",
                                    "signature_expired",
                                ]
                                .contains(code)
                            }) {
                                return Err(BakaError::PluginFailure {
                                    code: code.to_owned(),
                                });
                            }
                        }
                        Err(BakaError::js(
                            self.id.as_str(),
                            format!("{name_for_err}: {value}"),
                        ))
                    };
                }
                let observed = notifier.1.load(Ordering::Relaxed);
                match self.runtime.execute_pending_job().await {
                    Ok(true) | Err(_) => continue,
                    Ok(false) => {
                        // Lock acquisition may consume a wake while another
                        // caller completes our result or advances native I/O.
                        // Check progress again before parking.
                        let mut waiting = true;
                        poll_fn(|_| {
                            if outcome.lock().unwrap_or_else(|p| p.into_inner()).is_some()
                                || notifier.1.load(Ordering::Relaxed) != observed
                            {
                                Poll::Ready(())
                            } else if std::mem::take(&mut waiting) {
                                Poll::Pending
                            } else {
                                Poll::Ready(())
                            }
                        })
                        .await;
                    }
                }
            }
        };
        let mut invocation = std::pin::pin!(invocation);
        // QuickJS's internal scheduler has one root waker. Multiplex it across
        // FFI threads, so a finished/cancelled fast call cannot strand slow I/O.
        let wake = Waker::from(notifier.clone());
        poll_fn(|cx| {
            registration
                .calls
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .insert(registration.id, cx.waker().clone());
            invocation.as_mut().poll(&mut Context::from_waker(&wake))
        })
        .await
    }

    /// Evaluate an expression and bring the result back as JSON.
    ///
    /// Going through `JSON.stringify` keeps the boundary to one well-understood
    /// format. It also means the result is exactly what a plugin would hand to
    /// its own caller, which is what the backup schema needs to preserve.
    pub async fn eval_json(&self, source: &str) -> Result<serde_json::Value> {
        self.run(self.eval_json_inner(source)).await
    }

    async fn eval_json_inner(&self, source: &str) -> Result<serde_json::Value> {
        self.reset_deadline();
        let id = self.id.clone();
        let raw = self
            .context
            .with(move |ctx| {
                let value: Value = ctx
                    .eval(source)
                    .catch(&ctx)
                    .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;

                let json = ctx
                    .json_stringify(value)
                    .catch(&ctx)
                    .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;

                // `undefined` stringifies to None, not to the string "null".
                let Some(json) = json else {
                    return Ok::<_, BakaError>(None);
                };

                let text = json
                    .to_string()
                    .catch(&ctx)
                    .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;

                Ok(Some(text))
            })
            .await?;
        // A synchronous evaluation can resolve a promise owned by a parked
        // entry. No native I/O wakes that entry when jobs were queued here.
        let wakers: Vec<_> = self
            .call_wakers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
            .cloned()
            .collect();
        for waker in wakers {
            waker.wake();
        }
        match raw {
            None => Ok(serde_json::Value::Null),
            Some(text) => serde_json::from_str(&text).map_err(BakaError::from),
        }
    }

    /// Whether a global exists and is not `undefined`.
    ///
    /// After loading a script this answers the only question that matters at
    /// M0: did the plugin actually register its entry points?
    pub async fn has_global(&self, name: &str) -> Result<bool> {
        self.run(self.has_global_inner(name)).await
    }

    async fn has_global_inner(&self, name: &str) -> Result<bool> {
        let id = self.id.clone();
        let name = name.to_string();
        self.context
            .with(move |ctx| {
                let value: Option<Value> = ctx
                    .globals()
                    .get(name.as_str())
                    .catch(&ctx)
                    .map_err(|e| BakaError::js(id.as_str(), e.to_string()))?;
                Ok::<_, BakaError>(matches!(value, Some(v) if !v.is_undefined()))
            })
            .await
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        self.lifecycle.stop();
        self.call_scopes.stop();
        if let Some(abort) = self
            .background_abort
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            abort.abort();
        }
    }
}

/// Install `console.{log,info,warn,error,debug}`.
///
/// Every level lands in the same per-plugin buffer, tagged only with its level,
/// because plugin authors are not consistent about which level they use for the
/// line you actually want. The plugin ID is redundant in this buffer's UI.
fn install_console(ctx: &Ctx<'_>, id: &ScriptId, logs: LogSink) -> Result<()> {
    let to_js_err = |e: rquickjs::Error| BakaError::js(id.as_str(), e.to_string());

    let console = Object::new(ctx.clone()).map_err(to_js_err)?;

    for level in ["log", "info", "warn", "error", "debug"] {
        let logs = logs.clone();
        let diagnostic_tag = id.as_str().to_string();

        let f = Function::new(ctx.clone(), move |args: Rest<Coerced<String>>| {
            let body = args
                .iter()
                .map(|arg| arg.0.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            baka_logging::record(level, "plugin", &diagnostic_tag, &body, "");
            let line = format!("{level}: {body}");

            // Mirror to stderr so a hanging plugin still shows progress.
            eprintln!("{line}");

            if let Ok(mut logs) = logs.lock()
                && logs.len() < LOG_CAPACITY
            {
                logs.push(line);
            }
        })
        .map_err(to_js_err)?;

        console.set(level, f).map_err(to_js_err)?;
    }

    ctx.globals().set("console", console).map_err(to_js_err)?;
    Ok(())
}
