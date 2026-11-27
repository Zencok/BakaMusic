//! Source-to-source LX import: generated artifacts use only the V2 host contract.
use crate::{ImportScope, Provisional};
use baka_plugin_host::{PluginHost, plugin_network::PluginNetwork};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;

const MAX_SOURCE: usize = 5 * 1024 * 1024;
const ADAPTER: &str = include_str!("lx_v2_adapter.js");

fn header(source: &str, key: &str) -> Option<String> {
    let body = source.trim_start_matches('\u{feff}').trim_start();
    let header = body.strip_prefix("/*")?.split_once("*/")?.0;
    header.lines().find_map(|line| {
        let line = line.trim().trim_start_matches('*').trim();
        let (name, value) = line.strip_prefix('@')?.split_once(char::is_whitespace)?;
        (name.eq_ignore_ascii_case(key) && !value.trim().is_empty())
            .then(|| value.trim().to_owned())
    })
}

fn marked_source(source: &str) -> Option<&str> {
    let normalized = source.trim_start_matches('\u{feff}').trim_start();
    normalized
        .starts_with("// @baka-provider")
        .then_some(normalized)
}

/// Prepare imports without weakening the runtime's V2-only admission contract.
/// Marked packages stay V2 even when malformed or explicitly imported as LX.
pub(crate) async fn prepare_import(
    request: &Value,
    network: PluginNetwork,
    lease: &ImportScope,
) -> Result<Value, String> {
    let source = request["source"]
        .as_str()
        .ok_or("plugin_import_missing_source")?;
    if source.len() > MAX_SOURCE {
        return Err("Plugin exceeds 5 MB".into());
    }
    let kind = request["kind"].as_str().unwrap_or("auto");
    if !matches!(kind, "auto" | "v2" | "lx") {
        return Err("plugin_import_invalid_kind".into());
    }
    if let Some(source) = marked_source(source) {
        return Ok(json!({"source":source}));
    }
    if kind == "v2" {
        return Err("V2 plugins must begin with // @baka-provider 2".into());
    }
    if kind == "auto"
        && ![
            "lx.",
            "window.lx",
            "globalThis.lx",
            "EVENT_NAMES",
            "currentScriptInfo",
        ]
        .iter()
        .any(|hint| source.contains(hint))
        && header(source, "name").is_none()
    {
        return Err(
            "Cannot detect plugin format; select LX to import an obfuscated LX script".into(),
        );
    }
    let explicit_id = request["id"].as_str().filter(|id| !id.trim().is_empty());
    let script_name = header(source, "name");
    let effective_name = script_name.as_deref().or_else(|| {
        request["name"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
    });
    let default_identity = script_name
        .as_ref()
        .map(|name| format!("lx:name:{name}"))
        .or_else(|| {
            request["locator"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("lx:locator:{value}"))
        })
        .or_else(|| {
            request["name"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("lx:name:{value}"))
        });
    let installed = if explicit_id.is_none() {
        request["installedLx"].as_array().and_then(|installed| {
            installed.iter().find(|candidate| {
                (effective_name.is_some_and(|name| candidate["name"].as_str() == Some(name))
                    || default_identity
                        .as_deref()
                        .is_some_and(|identity| candidate["id"].as_str() == Some(identity)))
                    && candidate["id"]
                        .as_str()
                        .is_some_and(|id| !id.trim().is_empty())
            })
        })
    } else {
        None
    };
    let identity = explicit_id
        .or_else(|| installed.and_then(|candidate| candidate["id"].as_str()))
        .map(str::to_owned)
        .or(default_identity)
        .ok_or("LX import requires a name or source location")?;
    let mut conversion_request = request.clone();
    conversion_request["id"] = json!(identity);
    if let Some(installed) = installed {
        for key in ["enabled", "variables"] {
            if let Some(value) = installed.get(key) {
                conversion_request[key] = value.clone();
            }
        }
    }
    let converted = convert(&conversion_request, network, lease).await?;
    Ok(json!({"source":converted["source"],"id":converted["id"],
        "originalId":converted["conversion"]["originalId"],"manifest":converted["manifest"]}))
}

fn generated(
    request: &Value,
    sources: Vec<String>,
    qualities: Vec<String>,
) -> Result<(String, Value), String> {
    if request
        .get("enabled")
        .is_some_and(|enabled| !enabled.is_boolean())
    {
        return Err("lx_conversion_invalid_enabled".into());
    }
    let original = request["source"]
        .as_str()
        .ok_or("lx_conversion_missing_source")?;
    if original.len() > MAX_SOURCE {
        return Err("LX source exceeds 5 MB".into());
    }
    if marked_source(original).is_some() {
        return Err("lx_conversion_already_v2".into());
    }
    let identity = request["id"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
        .ok_or("lx_conversion_missing_identity")?;
    let digest = Sha256::digest(identity.as_bytes());
    let id = if identity
        .strip_prefix("org.baka.lx.s")
        .is_some_and(|suffix| suffix.len() == 64 && suffix.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        identity.to_owned()
    } else {
        format!(
            "org.baka.lx.s{}",
            digest
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    };
    let name = header(original, "name")
        .or_else(|| request["name"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "LX resolver".into());
    let author =
        header(original, "author").unwrap_or_else(|| "Original author not specified".into());
    let info = json!({"name":name,"author":author,"version":header(original,"version").unwrap_or_default(),
        "description":header(original,"description").unwrap_or_default(),"homepage":header(original,"homepage").unwrap_or_default()});
    let mut manifest = json!({"apiVersion":2,"kind":"resolver","id":id,"name":name,"author":author,
        "version":header(original,"version").unwrap_or_else(||"1.0.0".into()),"sources":sources,"capabilities":["media.resolve"],
        "description":info["description"],"homepage":info["homepage"],"supportedQualities":qualities,
        "conversion":{"format":"lx-to-v2","version":1,"initializationVerified":request["enabled"] != false,"originalId":identity,"originalVersion":info["version"],
            "limitations":["per-request cancellation suppresses callbacks; native transport abort follows call/workspace cancellation",
                "update alerts and configuration views have no V2 UI callback", "background intervals follow V2 call lifecycle; persistent background parity is not guaranteed"]}});
    if baka_core::plugin_contract::PackageManifest::from_value(manifest.clone()).is_err() {
        // LX headers permit display versions; retain them in provenance while
        // valid semantic versions continue to participate in V2 update checks.
        manifest["version"] = json!("1.0.0");
    }
    baka_core::plugin_contract::PackageManifest::from_value(manifest.clone())
        .map_err(|e| e.to_string())?;
    let source = format!(
        "// @baka-provider 2\n{ADAPTER}\nmodule.exports={{manifest:{manifest},handlers:{{media:{{resolve:createLegacyLxAdapter({},{info})}}}}}};\n",
        serde_json::to_string(original).map_err(|e| e.to_string())?
    );
    if source.len() > MAX_SOURCE {
        return Err("Converted LX source exceeds 5 MB".into());
    }
    Ok((source, manifest))
}

/// Initialize the unchanged source through an actual disposable V2 host before
/// returning any replaceable artifact. Failures preserve the caller's old body.
pub(crate) async fn convert(
    request: &Value,
    network: PluginNetwork,
    lease: &ImportScope,
) -> Result<Value, String> {
    let protocols = ["qq.v1", "wy.v1", "kg.v1", "kw.v1", "mg.v1"]
        .map(str::to_owned)
        .to_vec();
    let (source, manifest) = generated(request, protocols, vec![])?;
    if request["enabled"] == false {
        let variables = request
            .get("variables")
            .cloned()
            .unwrap_or_else(|| json!({}));
        PluginHost::inspect_source(&source, variables)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(
            json!({"source":source,"manifest":manifest,"id":manifest["id"],"initializedSources":{},"conversion":manifest["conversion"]}),
        );
    }
    let host = Arc::new(
        PluginHost::new_with_network(manifest["id"].as_str().unwrap(), network)
            .await
            .map_err(|e| e.to_string())?,
    );
    let _shutdown = Provisional(Some(host.clone()));
    lease.observe(&host)?;
    let variables = request
        .get("variables")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !variables.is_object() {
        return Err("LX variables must be an object".into());
    }
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        host.eval(&format!("globalThis.env={variables};for(const k of ['debug','log','info','warn','error'])console[k]=()=>{{}};"))
            .await
            .map_err(|e| e.to_string())?;
        host.load_v2_script(&source)
            .await
            .map_err(|e| e.to_string())?;
        host.call_entry("media.resolve", &[json!({"__bakaLxInitialize":true})])
            .await
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "LX initialization timed out".to_owned())
    .and_then(|v| v);
    host.shutdown();
    let initialized = result?;
    let sources = initialized["sources"]
        .as_object()
        .ok_or("LX initialization returned no sources")?;
    let protocols = sources
        .keys()
        .map(|key| format!("{}.v1", if key == "tx" { "qq" } else { key }))
        .collect();
    let mut qualities = Vec::new();
    for source in sources.values() {
        for quality in source["qualities"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !qualities.iter().any(|value| value == quality) {
                qualities.push(quality.to_owned());
            }
        }
    }
    let (source, manifest) = generated(request, protocols, qualities)?;
    Ok(
        json!({"source":source,"manifest":manifest,"id":manifest["id"],"initializedSources":sources,"conversion":manifest["conversion"]}),
    )
}
