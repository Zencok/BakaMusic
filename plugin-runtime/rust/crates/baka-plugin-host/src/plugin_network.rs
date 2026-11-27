//! Shared, live plugin transport policy. In-flight requests retain their client;
//! later requests (including background work) observe the newest proxy.
use reqwest::{
    Client, Url,
    header::{HeaderMap, HeaderValue},
};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct State {
    proxy: Option<String>,
    probe: bool,
    client: Option<Client>,
}

#[derive(Clone, Default)]
pub struct PluginNetwork {
    state: Arc<Mutex<State>>,
    pub workspace: crate::workspace_transport::WorkspaceTransport,
    task: Option<crate::workspace_transport::WorkspaceRequestGuard>,
}

impl PluginNetwork {
    pub fn with_workspace(workspace: crate::workspace_transport::WorkspaceTransport) -> Self {
        Self {
            workspace,
            ..Default::default()
        }
    }
    /// A disposable resolver context inherits one native download chain.
    /// Its cached client must never share an ordinary host's redirect policy.
    pub fn for_download(
        &self,
        task: &crate::workspace_transport::WorkspaceRequestGuard,
    ) -> Result<Self, String> {
        task.current_download()?;
        let state = self
            .state
            .lock()
            .map_err(|_| "Plugin network state poisoned")?;
        Ok(Self {
            state: Arc::new(Mutex::new(State {
                proxy: state.proxy.clone(),
                probe: state.probe,
                client: None,
            })),
            workspace: self.workspace.clone(),
            task: Some(task.clone()),
        })
    }
    pub fn allowed(&self) -> bool {
        self.task
            .as_ref()
            .map_or_else(|| self.workspace.allowed(), |task| task.is_current())
    }
    pub fn admit(
        &self,
        capability: baka_core::workspace::NetworkCapability,
    ) -> Result<crate::workspace_transport::WorkspaceRequest, String> {
        match &self.task {
            Some(task)
                if matches!(
                    capability,
                    baka_core::workspace::NetworkCapability::Plugin
                        | baka_core::workspace::NetworkCapability::Stream
                ) =>
            {
                task.admit_followup()
            }
            Some(_) => Err("workspace_download_invalid_child_capability".into()),
            None => self.workspace.admit(capability),
        }
    }
    pub(crate) fn proxy_url(&self) -> Option<String> {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .proxy
            .clone()
    }
    pub fn configure(&self, proxy: Option<&str>, probe: bool) -> Result<(), String> {
        let proxy = proxy.filter(|s| !s.trim().is_empty()).map(str::trim);
        if let Some(proxy) = proxy {
            let url = Url::parse(proxy).map_err(|_| "Invalid plugin proxy URL")?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err("Invalid plugin proxy URL".into());
            }
        }
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.proxy.as_deref() != proxy {
            state.proxy = proxy.map(str::to_owned);
            state.client = None;
        }
        state.probe = probe;
        Ok(())
    }

    pub fn client(&self) -> Result<Client, String> {
        if !self.allowed() {
            return Err("workspace_network_disabled".into());
        }
        let policy = self.workspace.clone();
        let task = self.task.clone();
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(client) = &state.client {
            return Ok(client.clone());
        }
        let mut builder = crate::http_client_builder().redirect(reqwest::redirect::Policy::custom(
            move |attempt| {
                if !task
                    .as_ref()
                    .map_or_else(|| policy.allowed(), |task| task.is_current())
                {
                    attempt.error("workspace_network_disabled")
                } else if !matches!(attempt.url().scheme(), "http" | "https") {
                    attempt.error("Plugin redirect protocol is not accepted")
                } else if attempt.previous().len() > 5 {
                    attempt.error("too many redirects")
                } else {
                    attempt.follow()
                }
            },
        ));
        if let Some(proxy) = &state.proxy {
            builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
        }
        let client = builder.build().map_err(|e| e.to_string())?;
        state.client = Some(client.clone());
        Ok(client)
    }

    pub fn probes_enabled(&self) -> bool {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).probe
    }

    /// Drop the stream immediately after headers, even if Range is ignored.
    /// Only HTTP status failures are retryable, matching the desktop manager.
    pub async fn probe(&self, url: &str) -> Result<(), (String, bool)> {
        self.probe_source(&serde_json::json!({"url":url})).await
    }

    pub async fn probe_source(&self, source: &Value) -> Result<(), (String, bool)> {
        let started = std::time::Instant::now();
        let result = self
            .admit(baka_core::workspace::NetworkCapability::Stream)
            .map_err(|e| (e, false))?
            .run(async { Ok(self.probe_transport(source).await) })
            .await
            .map_err(|e| (e, false))?;
        baka_logging::record(
            if result.is_ok() { "INFO" } else { "WARN" },
            "network",
            "PluginProbe",
            "Media URL probe finished",
            &serde_json::json!({"ms":started.elapsed().as_millis(), "ok":result.is_ok()})
                .to_string(),
        );
        result
    }

    /// Probe under the original request chain, retaining its workspace epoch.
    pub async fn probe_source_with_guard(
        &self,
        source: &Value,
        guard: &crate::workspace_transport::WorkspaceRequestGuard,
    ) -> Result<(), (String, bool)> {
        guard
            .admit_followup()
            .map_err(|e| (e, false))?
            .run(async { Ok(self.probe_transport(source).await) })
            .await
            .map_err(|e| (e, false))?
    }

    async fn probe_transport(&self, source: &Value) -> Result<(), (String, bool)> {
        let url = source["url"]
            .as_str()
            .ok_or_else(|| ("Missing plugin media URL".into(), false))?;
        let parsed = Url::parse(url).map_err(|_| ("Invalid plugin media URL".into(), false))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err(("Invalid plugin media URL".into(), false));
        }
        let mut headers = media_headers(source).map_err(|e| (e, false))?;
        headers
            .entry("user-agent")
            .or_insert(HeaderValue::from_static(
                "Mozilla/5.0 BakaMusic Plugin SDK/2.0",
            ));
        headers.insert("range", HeaderValue::from_static("bytes=0-1"));
        let response = self
            .client()
            .map_err(|e| (e, false))?
            .get(parsed)
            .headers(headers)
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| (e.to_string(), false))?;
        if !matches!(response.status().as_u16(), 200 | 206) {
            return Err((
                format!(
                    "plugin media URL probe failed with HTTP {}",
                    response.status().as_u16()
                ),
                true,
            ));
        }
        Ok(())
    }
}

/// Shared playback/probe headers. Keep transport framing under native control.
pub fn media_headers(source: &Value) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if let Some(value) = source.get("headers").filter(|v| !v.is_null()) {
        let object = value.as_object().ok_or("Invalid media headers")?;
        if object.len() > 64 {
            return Err("Too many media headers".into());
        }
        for (name, value) in object {
            let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| "Invalid media header name")?;
            if [
                "host",
                "range",
                "accept-encoding",
                "connection",
                "content-length",
                "transfer-encoding",
            ]
            .contains(&name.as_str())
            {
                continue;
            }
            let value = value.as_str().ok_or("Invalid media header value")?;
            headers.insert(
                name,
                HeaderValue::from_str(value).map_err(|_| "Invalid media header value")?,
            );
        }
    }
    if !headers.contains_key("user-agent")
        && let Some(agent) = source.get("userAgent").and_then(Value::as_str)
    {
        headers.insert(
            "user-agent",
            HeaderValue::from_str(agent).map_err(|_| "Invalid user agent")?,
        );
    }
    headers.insert("accept-encoding", HeaderValue::from_static("identity"));
    Ok(headers)
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn media_headers_validate_values_and_preserve_native_framing() {
        let headers = media_headers(&serde_json::json!({"headers":{
            "Authorization":"Bearer fixture", "User-Agent":"HeaderAgent",
            "Host":"wrong.invalid", "Range":"bytes=99-", "Accept-Encoding":"gzip",
            "Connection":"close", "Content-Length":"9", "Transfer-Encoding":"chunked"
        }, "userAgent":"FallbackAgent"}))
        .unwrap();
        assert_eq!(headers["authorization"], "Bearer fixture");
        assert_eq!(headers["user-agent"], "HeaderAgent");
        assert_eq!(headers["accept-encoding"], "identity");
        for name in [
            "host",
            "range",
            "connection",
            "content-length",
            "transfer-encoding",
        ] {
            assert!(!headers.contains_key(name));
        }
        for source in [
            serde_json::json!({"headers":[]}),
            serde_json::json!({"headers":{"Bad Name":"x"}}),
            serde_json::json!({"headers":{"Authorization":"bad\r\ninjected: x"}}),
            serde_json::json!({"headers":{"Referer":4}}),
            serde_json::json!({"userAgent":"bad\nagent"}),
        ] {
            assert!(media_headers(&source).is_err());
        }
    }

    #[tokio::test]
    async fn guarded_probe_retains_original_workspace_epoch() {
        use serde_json::json;
        let network = PluginNetwork::default();
        let command = |value| network.workspace.command(json!({"version":1,"command":value})).unwrap();
        command(json!({"op":"restore","preferences":null}));
        let transition = |value| {
            let revision=command(json!({"op":"snapshot"}))["revision"].clone();
            command(json!({"op":"commit","revision":revision,"transition":value}));
        };
        transition(json!({"type":"unlock","confirmed":true}));
        transition(json!({"type":"switch","mode":"online"}));
        let original=network.workspace.admit(baka_core::workspace::NetworkCapability::Stream).unwrap();
        let guard=original.guard();
        // A guarded probe reaches descriptor validation without needing a fresh permit.
        let error=network.probe_source_with_guard(&json!({}),&guard).await.unwrap_err();
        assert_eq!(error,("Missing plugin media URL".into(),false));
        transition(json!({"type":"switch","mode":"local"}));
        transition(json!({"type":"switch","mode":"online"}));
        let error=network.probe_source_with_guard(&json!({"url":"http://127.0.0.1:9"}),&guard).await.unwrap_err();
        assert_eq!(error,("workspace_request_expired".into(),false));
        assert!(network.state.lock().unwrap().client.is_none());
    }

    #[tokio::test]
    async fn blocked_probe_is_not_retryable_and_never_builds_client() {
        let network = PluginNetwork::default();
        network
            .workspace
            .command(serde_json::json!({
                "version":1,"command":{"op":"restore","preferences":null}
            }))
            .unwrap();
        let error = network.probe("http://127.0.0.1:9/").await.unwrap_err();
        assert_eq!(error, ("workspace_network_disabled".into(), false));
        assert!(network.state.lock().unwrap().client.is_none());
    }
}
