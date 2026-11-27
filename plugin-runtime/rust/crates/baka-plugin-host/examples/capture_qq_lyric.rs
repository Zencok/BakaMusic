use baka_plugin_host::PluginHost;

#[tokio::main]
async fn main() {
    let host = PluginHost::new("org.example.lyric-parity").await.unwrap();
    host.load_v2_script("// @baka-provider 2\nmodule.exports={manifest:{apiVersion:2,kind:'provider',id:'org.example.lyric-parity',name:'Lyric capture',author:'BakaMusic',sourceId:'fixture.v1',version:'1.0.0',capabilities:['lyrics.get']},handlers:{lyrics:{get:async t=>t}}};")
        .await
        .unwrap();
    let response: serde_json::Value = serde_json::from_str(
        std::fs::read_to_string("../artifacts/qq-579704844-response.json")
            .unwrap()
            .trim_start_matches('\u{feff}'),
    )
    .unwrap();
    let result = host
        .call_entry(
            "lyrics.get",
            &[serde_json::json!({
                "rawLrc":response["req"]["data"]["lyric"],
                "translation":response["req"]["data"]["trans"],
                "romanization":response["req"]["data"]["roma"],
                "platform":"QQ音乐", "title":"分かっちゃいないね (feat.花隈千冬)",
                "artist":"monet / 花隈千冬", "id":"579704844", "mid":"0016bZbj0QvC1C"
            })],
        )
        .await
        .unwrap();
    let output = std::env::args().nth(1).expect("output JSON path");
    std::fs::write(output, serde_json::to_string_pretty(&result).unwrap()).unwrap();
    println!(
        "backend={} parseError={} lines={}",
        result["parserBackend"],
        result["parseError"],
        result["parsedLines"].as_array().map_or(0, Vec::len)
    );
}
