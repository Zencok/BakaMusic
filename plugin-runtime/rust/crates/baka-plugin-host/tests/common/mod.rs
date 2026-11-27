#![allow(dead_code)]
use baka_plugin_host::PluginHost;
pub const ID: &str = "org.example.fixture";
pub fn source(capabilities: &[&str], handlers: &str) -> String {
    format!(
        "// @baka-provider 2\nmodule.exports={{manifest:{{apiVersion:2,kind:'provider',author:'Fixture author',sourceId:'fixture.v1',id:'org.example.fixture',name:'Fixture',version:'1.2.3',capabilities:{}}},handlers:{handlers}}}",
        serde_json::to_string(capabilities).unwrap()
    )
}
pub async fn host(capabilities: &[&str], handlers: &str) -> PluginHost {
    let h = PluginHost::new(ID).await.unwrap();
    h.load_v2_script(&source(capabilities, handlers))
        .await
        .unwrap();
    h
}
