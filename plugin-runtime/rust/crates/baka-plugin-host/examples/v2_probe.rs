//! Execute an independently rendered provider in the actual lean QuickJS host.
//! Input arguments contain paths, never credentials. Raw output stays opt-in.
use baka_plugin_host::PluginHost;
use serde_json::{Value, json};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() < 2 {
        return Err("usage: v2_probe SOURCE [CAPABILITY REQUEST_JSON_FILE]".into());
    }
    let source = std::fs::read_to_string(&args[1])?;
    let storage = std::env::var("BAKA_PROVIDER_STORAGE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("baka-provider-probe"));
    let settings = std::env::var("BAKA_PROVIDER_SETTINGS_FILE")
        .ok()
        .map(std::fs::read_to_string)
        .transpose()?
        .map(|text| serde_json::from_str::<Value>(&text))
        .transpose()?
        .unwrap_or(json!({}));
    let inspected = PluginHost::inspect_source(&source, settings.clone()).await?;
    let host = PluginHost::new(inspected["id"].as_str().ok_or("id missing")?).await?;
    host.configure_storage(&storage).await?;
    host.eval(&format!("globalThis.env={};", settings)).await?;
    host.load_v2_script(&source).await?;
    host.eval("delete globalThis.env").await?;
    let manifest = host.manifest().await?;
    let mut summary = json!({"providerId":manifest["id"],"version":manifest["version"],"capabilities":manifest["capabilities"],"lean":host.eval_json("[typeof require,typeof Buffer,typeof axios,typeof process].every(v=>v==='undefined')").await?});
    if let Some(capability) = args.get(2) {
        let request: Value = serde_json::from_str(&std::fs::read_to_string(
            args.get(3).ok_or("request file missing")?,
        )?)?;
        let result = host.call_entry(capability, &[request]).await?;
        if let Ok(path) = std::env::var("BAKA_PROVIDER_RESULT_FILE") {
            std::fs::write(path, serde_json::to_vec(&result)?)?;
        }
        summary["items"] = json!(result["items"].as_array().map(Vec::len));
        summary["hasNext"] = json!(result["nextCursor"].is_string());
        summary["hasUrl"] = json!(result["url"].is_string());
        summary["hasLyrics"] = json!(result["rawLrc"].as_str().is_some_and(|s| !s.is_empty()));
    }
    println!("{summary}");
    host.shutdown();
    Ok(())
}
