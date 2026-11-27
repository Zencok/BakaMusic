mod common;
use baka_plugin_host::PluginHost;

#[tokio::test(flavor = "multi_thread")]
async fn qrc_literal_quotes_survive_plugin_parse_and_download() {
    // NEON (QQ 733159779) has unescaped quotes in the XML attribute.
    // Keep a small synthetic excerpt so this regression needs no network.
    let raw = "<?xml version=\"1.0\"?><QrcInfos><Lyric_1 LyricContent=\"[22013,4000]the (22013,1000)\"LITE\"(23013,3000)\n[27380,1655]next(27380,1655)\n[180000,1000]end(180000,1000)\"/></QrcInfos>";
    let host = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["lyrics.get"],
        "{lyrics:{get:async(t)=>t}}",
    ))
    .await
    .unwrap();
    let result = host
        .call_entry(
            "lyrics.get",
            &[serde_json::json!({
                "rawLrc": raw,
                "translation": "[00:22.013]跟随“LITE”\n[00:27.380]下一句",
                "romanization": "[00:27.380]next"
            })],
        )
        .await
        .unwrap();
    assert_eq!(result["parserBackend"], "rust");
    assert_eq!(result["decryptBackend"], "rust");
    assert!(result["parseError"].is_null(), "{result}");
    let lines = result["parsedLines"].as_array().unwrap();
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[0]["lrc"], "the \"LITE\"");
    assert_eq!(lines[0]["translation"], "跟随“LITE”");
    assert_eq!(lines[1]["romanization"], "next");
    assert_eq!(lines[2]["time"], 180.0);
    assert_eq!(lines[2]["words"][0]["endTime"], 181.0);
    let output = result["downloadLrc"].as_str().unwrap();
    let system = result["systemLrc"].as_str().unwrap();
    assert!(system.contains("[00:22.01]the \"LITE\""));
    assert!(!system.contains('<'));
    assert!(!system.contains("next\n[00:27.380]next"));
    let roundtrip: Vec<_> = baka_plugin_host::lyric_native::parse_core(output)
        .unwrap()
        .into_iter()
        .filter(|line| line.has_word_timeline)
        .collect();
    assert_eq!(roundtrip.len(), 3);
    for (parsed, source) in roundtrip.iter().zip(lines) {
        assert_eq!(parsed.lrc, source["lrc"].as_str().unwrap());
        assert_eq!(parsed.time, source["time"].as_f64().unwrap());
        assert!(parsed.has_word_timeline);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn native_parser_through_plugin_boundary() {
    let host = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["lyrics.get"],
        "{lyrics:{get:async(t)=>t}}",
    ))
    .await
    .unwrap();
    for raw in [
        "[00:01.00][00:03.00]repeat\n[00:05.00]end",
        "[1000,2000]Hello(1000,1000) world(2000,1000)",
        "[1000,2000](1000,1000,0)Hello (2000,1000,0)world",
        "<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><div><p begin=\"1s\" end=\"3s\"><span begin=\"1s\" end=\"2s\">Hello</span><span begin=\"2s\" end=\"3s\"> world</span></p></div></body></tt>",
    ] {
        let result = host
            .call_entry("lyrics.get", &[serde_json::json!({"rawLrc":raw})])
            .await
            .unwrap();
        assert_eq!(result["parserBackend"], "rust");
        assert!(result["parseError"].is_null(), "{result}");
        assert!(
            !result["parsedLines"].as_array().unwrap().is_empty(),
            "{result}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn simple_lyric_does_not_load_desktop_bundle() {
    let host = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["lyrics.get"],
        "{lyrics:{get:async()=>({rawLrc:'[00:01.00]hello'})}}",
    ))
    .await
    .unwrap();
    let result = host
        .call_entry("lyrics.get", &[serde_json::json!({})])
        .await
        .unwrap();
    assert_eq!(result["parserBackend"], "rust");
    assert_eq!(
        host.eval_json("typeof globalThis.__bakaParseLyric")
            .await
            .unwrap(),
        "undefined"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn encrypted_lyrics_export_after_native_decryption_and_parsing() {
    let host = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["lyrics.get"],
        "{lyrics:{get:async(t)=>t}}",
    ))
    .await
    .unwrap();
    let vectors: serde_json::Value =
        serde_json::from_str(include_str!("qrc_vectors.json")).unwrap();
    for vector in vectors.as_array().unwrap() {
        let cipher = vector["encrypted"].as_str().unwrap();
        let result = host
            .call_entry("lyrics.get", &[serde_json::json!({"rawLrc": cipher})])
            .await
            .unwrap();
        assert!(result["parseError"].is_null(), "{result}");
        let output = result["downloadLrc"].as_str().unwrap();
        assert!(!output.contains(cipher));
        assert!(!output.contains("LyricContent="));
        assert!(output.starts_with('['), "{result}");
        let parsed = baka_plugin_host::lyric_native::parse_core(output).unwrap();
        assert!(!parsed.is_empty());
        for source in result["parsedLines"].as_array().unwrap() {
            let text = source["lrc"].as_str().unwrap();
            assert!(
                parsed.iter().any(|line| line.lrc == text),
                "lost text: {text}, output: {output}"
            );
        }
        if result["parsedLines"]
            .as_array()
            .unwrap()
            .iter()
            .any(|l| l["hasWordTimeline"] == true)
        {
            assert!(output.contains('<'), "{result}");
        }
    }
    assert!(
        host.call_entry(
            "lyrics.get",
            &[serde_json::json!({"rawLrc": "0".repeat(32)})]
        )
        .await
        .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn download_export_includes_auxiliary_only_and_ttml_lyrics() {
    let host = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["lyrics.get"],
        "{lyrics:{get:async(t)=>t}}",
    ))
    .await
    .unwrap();
    for source in [
        serde_json::json!({"translation":"[00:01.00]translation only"}),
        serde_json::json!({"rawLrc":"<tt xmlns=\"http://www.w3.org/ns/ttml\"><body><div><p begin=\"1s\" end=\"3s\"><span begin=\"1s\" end=\"2s\">Hello</span><span begin=\"2s\" end=\"3s\"> world</span></p></div></body></tt>"}),
        serde_json::json!({"rawLrc":"[1000,2000]Hello(1000,1000) world(2000,1000)", "translation":"[00:01.00]你好", "romanization":"[00:01.00]hello"}),
    ] {
        let result = host.call_entry("lyrics.get", &[source]).await.unwrap();
        assert!(result["parseError"].is_null(), "{result}");
        let lrc = result["downloadLrc"].as_str().unwrap();
        assert!(lrc.starts_with("[00:01.000]"), "{result}");
        assert!(!lrc.contains("<tt"));
    }
}
