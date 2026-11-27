//! Generic HTTP service: lazy native clients, bounded redirects and workspace
//! admission. Returns a JSON envelope for the V2 SDK request primitive. Call
//! cancellation closes native transport independently of the JavaScript driver.

use std::time::Duration;

use rquickjs::function::{Async, Func};
use serde::Deserialize;
use std::sync::{Arc, Mutex};

/// Sites routinely 403 default/empty user agents. The scripts set their own
/// UA on most requests; this covers the few that forget.
const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Applied when the SDK request carries no `timeoutMs`. When it does, the
/// script's own value wins — several scripts rely on a 10s timeout to fall
/// back to a secondary lyric endpoint.
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_REDIRECTS: usize = 10;

type ClientCache = Vec<(
    Option<String>,
    usize,
    std::result::Result<reqwest::Client, String>,
)>;

#[derive(Debug, Deserialize)]
struct HttpConfig {
    method: String,
    url: String,
    #[serde(default)]
    headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_hex: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    want_bytes: bool,
    #[serde(default)]
    want_text: bool,
    #[serde(default)]
    max_redirects: Option<usize>,
}

#[derive(Clone)]
pub struct HttpShim {
    network: crate::plugin_network::PluginNetwork,
    clients: Arc<Mutex<ClientCache>>,
}

impl HttpShim {
    pub fn new() -> Self {
        Self::with_workspace(Default::default())
    }

    pub fn with_workspace(workspace: crate::workspace_transport::WorkspaceTransport) -> Self {
        Self::with_network(crate::plugin_network::PluginNetwork::with_workspace(
            workspace,
        ))
    }

    pub fn with_network(network: crate::plugin_network::PluginNetwork) -> Self {
        Self {
            network,
            clients: Arc::new(Mutex::new(Vec::new())),
        }
    }

    // Most plugins only declare metadata at startup. Build their HTTP client
    // on the first request for each redirect limit, sharing it across calls
    // but never across plugins. A no-follow call must not affect later calls.
    fn client(&self, max_redirects: usize) -> std::result::Result<reqwest::Client, String> {
        // Bound both redirect work and the number of cached clients per plugin.
        let max_redirects = max_redirects.min(MAX_REDIRECTS);
        let workspace = self.network.clone();
        let proxy = self.network.proxy_url();
        let mut clients = self.clients.lock().unwrap_or_else(|p| p.into_inner());
        clients.retain(|(cached, _, _)| cached == &proxy);
        if let Some((_, _, client)) = clients.iter().find(|(_, limit, _)| *limit == max_redirects) {
            return client.clone();
        }
        let mut builder = crate::http_client_builder()
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if !workspace.allowed() {
                    attempt.error("workspace_network_disabled")
                } else if max_redirects == 0 {
                    attempt.stop()
                } else if attempt.previous().len() > max_redirects {
                    attempt.error("too many redirects")
                } else {
                    attempt.follow()
                }
            }))
            .user_agent(DEFAULT_UA);
        if let Some(proxy) = &proxy {
            builder = builder.proxy(
                reqwest::Proxy::all(proxy).map_err(|e| format!("invalid plugin proxy: {e}"))?,
            );
        }
        let client = builder
            .build()
            .map_err(|e| format!("client build failed: {e}"));
        clients.push((proxy, max_redirects, client.clone()));
        client
    }

    /// Define `__baka.http(configJson) -> Promise<envelopeString>`.
    ///
    /// `Async` turns the returned future into a promise. Ctx is used only to
    /// capture its numeric call scope; the independently polled I/O task and
    /// returned future contain no JS values or context/runtime pointers.
    pub fn install(self, ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
        self.install_scoped(ctx, crate::call_scope::CallScopes::default())
    }

    pub(crate) fn install_scoped(
        self,
        ctx: &rquickjs::Ctx<'_>,
        scopes: crate::call_scope::CallScopes,
    ) -> rquickjs::Result<()> {
        let shim = self.clone();
        let native = Func::from(Async(move |ctx: rquickjs::Ctx<'_>, config_json: String| {
            let shim = shim.clone();
            // Capture ownership synchronously, before QuickJS polls the future.
            let task = scopes.start(
                &ctx,
                async move { shim.request_envelope(config_json).await },
            );
            async move {
                task.await
                    .unwrap_or_else(|error| error_envelope(error.into()))
            }
        }));

        let globals = ctx.globals();
        let baka: rquickjs::Object = globals.get("__baka")?;
        baka.set("http", native)?;
        Ok(())
    }

    /// Never fails: config or transport errors become `{"kind":"error"}`
    /// envelopes so the JS side decides rejection semantics.
    async fn request_envelope(&self, config_json: String) -> String {
        let config: HttpConfig = match serde_json::from_str(&config_json) {
            Ok(c) => c,
            Err(e) => return error_envelope(format!("bad axios config: {e}")),
        };
        let request = match self
            .network
            .admit(baka_core::workspace::NetworkCapability::Plugin)
        {
            Ok(request) => request,
            Err(error) => return error_envelope(error),
        };
        request
            .run(async {
                let client = self.client(config.max_redirects.unwrap_or(MAX_REDIRECTS))?;
                Ok(self.perform(client, config).await)
            })
            .await
            .unwrap_or_else(error_envelope)
    }

    async fn perform(&self, client: reqwest::Client, config: HttpConfig) -> String {
        let timeout_ms = config
            .timeout_ms
            .filter(|ms| *ms > 0)
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS);
        let method = reqwest::Method::from_bytes(config.method.to_uppercase().as_bytes())
            .unwrap_or(reqwest::Method::GET);

        let mut request = client
            .request(method, &config.url)
            .timeout(Duration::from_millis(timeout_ms));
        for (name, value) in &config.headers {
            if value.is_empty() {
                continue;
            }
            request = request.header(name.as_str(), value.as_str());
        }
        if let Some(body_hex) = &config.body_hex {
            let body = match hex::decode(body_hex) {
                Ok(body) => body,
                Err(e) => return error_envelope(format!("bad SDK binary body: {e}")),
            };
            request = request.body(body);
        } else if let Some(body) = &config.body {
            request = request.body(body.clone());
        }

        let diagnostic_start = std::time::Instant::now();
        let mut response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                baka_logging::record(
                    "WARN",
                    "network",
                    "PluginHTTP",
                    &format!(
                        "{} transport failed after {} ms",
                        config.method,
                        diagnostic_start.elapsed().as_millis()
                    ),
                    &e.to_string(),
                );
                return error_envelope(format!("network error: {e}"));
            }
        };
        let status = response.status().as_u16();
        baka_logging::record(
            if status >= 400 { "WARN" } else { "INFO" },
            "network",
            "PluginHTTP",
            &format!(
                "{} HTTP {} headers received in {} ms",
                config.method,
                status,
                diagnostic_start.elapsed().as_millis()
            ),
            "",
        );
        let mut headers = std::collections::BTreeMap::new();
        for (name, value) in response.headers() {
            let entry = headers
                .entry(name.as_str().to_ascii_lowercase())
                .or_insert_with(String::new);
            if !entry.is_empty() {
                entry.push_str(", ");
            }
            entry.push_str(&String::from_utf8_lossy(value.as_bytes()));
        }
        let content_type = headers.get("content-type").cloned().unwrap_or_default();
        let mut bytes = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                        return error_envelope("response exceeds 16 MB".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(e) => return error_envelope(format!("network error: {e}")),
            }
        }

        let kind;
        let data: std::borrow::Cow<'_, str>;
        if config.want_bytes {
            kind = "bytes";
            data = hex::encode(&bytes).into();
        } else if !config.want_text && (content_type.contains("json") || looks_like_json(&bytes)) {
            // Content-type JSON selects JSON decoding. The lookalike fallback is
            // needed because several real endpoints (netease weapi, at least)
            // ship a JSON body as text/plain — the scripts index straight
            // into res.result and RN's fetch stack parses those too.
            // arbitrary_precision keeps every JSON scalar byte-exact through
            // the parse/reserialize round trip.
            let value: serde_json::Value = match serde_json::from_slice(&bytes) {
                Ok(v) => v,
                Err(e) => {
                    return error_envelope(format!(
                        "content-type said json but the body did not parse: {e}"
                    ));
                }
            };
            kind = "json";
            data = serde_json::to_string(&value)
                .map(std::borrow::Cow::Owned)
                .unwrap_or_default();
        } else {
            kind = "text";
            data = String::from_utf8_lossy(&bytes).into_owned().into();
        }

        let envelope = serde_json::json!({
            "kind": kind,
            "data": data,
            "status": status,
            "headers": headers,
        });
        serde_json::to_string(&envelope).unwrap_or_else(|e| error_envelope(e.to_string()))
    }
}

impl Default for HttpShim {
    fn default() -> Self {
        Self::new()
    }
}

fn error_envelope(message: String) -> String {
    serde_json::json!({ "kind": "error", "message": message }).to_string()
}

/// Conservative sniffing: only bodies that unambiguously start as a JSON
/// document. HTML pages and base64 lyric payloads never match.
fn looks_like_json(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(64)];
    let head_text = String::from_utf8_lossy(head);
    let trimmed = head_text.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clients_are_lazy_and_scoped_to_one_plugin() {
        let shim = HttpShim::new();
        let other = HttpShim::new();
        assert!(shim.clients.lock().unwrap().is_empty());
        assert!(!Arc::ptr_eq(&shim.clients, &other.clients));
        let clone = shim.clone();
        assert!(Arc::ptr_eq(&shim.clients, &clone.clients));
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    shim.client(MAX_REDIRECTS).unwrap();
                });
            }
        });
        assert!(clone.clients.lock().unwrap()[0].2.is_ok());
        assert!(other.clients.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn invalid_config_does_not_construct_client() {
        let shim = HttpShim::new();
        let envelope = shim.request_envelope("not json".into()).await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&envelope).unwrap()["kind"],
            "error"
        );
        assert!(shim.clients.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn managed_local_never_constructs_http_client() {
        let workspace = crate::workspace_transport::WorkspaceTransport::default();
        workspace
            .command(serde_json::json!({"version":1,"command":{"op":"snapshot"}}))
            .unwrap();
        let shim = HttpShim::with_workspace(workspace);
        let envelope = shim
            .request_envelope(
                serde_json::json!({
                    "method":"get", "url":"http://127.0.0.1:9/"
                })
                .to_string(),
            )
            .await;
        assert!(envelope.contains("workspace_network_disabled"));
        assert!(shim.clients.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn text_round_trip_through_local_server() {
        // Minimal TCP listener speaking just enough HTTP for reqwest.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            use std::io::{BufRead, BufReader, Read, Write};
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
            }
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 5\r\n\r\nhello",
                )
                .unwrap();
            stream.shutdown(std::net::Shutdown::Write).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let _ = reader.read_to_end(&mut Vec::new());
        });

        let shim = HttpShim::new();
        assert!(shim.clients.lock().unwrap().is_empty());
        let config = serde_json::json!({"method":"get", "url":format!("http://{addr}/")});
        let envelope = shim.request_envelope(config.to_string()).await;
        assert!(shim.clients.lock().unwrap()[0].2.is_ok());
        let v: serde_json::Value = serde_json::from_str(&envelope).unwrap();
        assert_eq!(v["kind"], "text", "{v}");
        assert_eq!(v["status"], 200);
        assert_eq!(v["data"], "hello");
        assert_eq!(v["headers"]["content-type"], "text/plain");
    }
}
