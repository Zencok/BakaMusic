mod common;
use baka_plugin_host::PluginHost;
use serde_json::json;
#[tokio::test]
async fn strict_manifest_direct_cursor_and_no_compatibility_globals() {
    let h=common::host(&["search","media.prepare"],"{search:r=>({items:[{id:r.cursor||'first'}],nextCursor:r.cursor?null:'opaque',total:2}),media:{prepare:r=>r}}").await;
    assert_eq!(h.manifest().await.unwrap()["kind"], "provider");
    assert_eq!(h.manifest().await.unwrap()["author"], "Fixture author");
    assert_eq!(
        h.eval_json(
            "[typeof require,typeof Buffer,typeof axios,typeof lx,typeof document,typeof process]"
        )
        .await
        .unwrap(),
        json!([
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined",
            "undefined"
        ])
    );
    let first = h
        .call_entry("search", &[json!({"query":"x"})])
        .await
        .unwrap();
    assert_eq!(
        first,
        json!({"items":[{"id":"first"}],"nextCursor":"opaque","total":2})
    );
    let second = h
        .call_entry("search", &[json!({"query":"x","cursor":"opaque"})])
        .await
        .unwrap();
    assert_eq!(second["items"][0]["id"], "opaque");
    for (name, args) in [
        ("v2:search", vec![json!({})]),
        ("getMediaSource", vec![json!({})]),
        ("search", vec![]),
        ("search", vec![json!("x"), json!(1)]),
        ("search", vec![json!({"cursor":"","limit":1})]),
    ] {
        assert!(h.call_entry(name, &args).await.is_err(), "{name}: {args:?}");
    }
    assert_eq!(
        h.call_entry("media.prepare", &[json!({"entity":{"id":42}})])
            .await
            .unwrap()["entity"]["id"],
        42
    );
}
#[tokio::test]
async fn rejects_legacy_identity_and_incomplete_manifest_without_fallback() {
    let valid = common::source(
        &["media.resolve"],
        "{media:{resolve:()=>({url:'https://example.test'})}}",
    );
    for source in [
        "module.exports={platform:'old'}".to_owned(),
        "lx.send('inited',{})".to_owned(),
        valid.replace("// @baka-provider 2", "// @baka-provider 20"),
        valid.replace("kind:'provider',", ""),
        valid.replace("author:'Fixture author',", ""),
        valid.replace("sourceId:'fixture.v1',", ""),
        valid.replace("org.example.fixture", "org.example.other"),
        valid.replace("media.resolve", "no.such.capability"),
        valid.replace("resolve:()=>({url:'https://example.test'})", "resolve:42"),
    ] {
        let h = PluginHost::new(common::ID).await.unwrap();
        assert!(h.load_v2_script(&source).await.is_err(), "{source}");
        assert!(h.call_entry("media.resolve", &[json!({})]).await.is_err());
    }
}
#[tokio::test]
async fn invalid_pages_rejected_and_native_lyrics_enriched() {
    for body in [
        "({items:[]})",
        "({items:[],nextCursor:'stuck'})",
        "({items:[{}],nextCursor:r.cursor})",
        "({items:Array.from({length:31},()=>({})),nextCursor:null})",
    ] {
        let h = common::host(&["search"], &format!("{{search:r=>{body}}}")).await;
        assert!(
            h.call_entry("search", &[json!({"cursor":"same"})])
                .await
                .is_err()
        );
    }
    let h = common::host(
        &["lyrics.get"],
        "{lyrics:{get:()=>({rawLrc:'[00:00.00]Hello\\n[00:01.00]World'})}}",
    )
    .await;
    let out = h.call_entry("lyrics.get", &[json!({})]).await.unwrap();
    assert_eq!(out["parserBackend"], "rust");
    assert!(out["parsedLines"].is_array());
}
#[tokio::test]
async fn resolver_kind_sources_and_capabilities_are_authoritative() {
    let source = common::source(&["media.resolve"], "{media:{resolve:r=>r}}")
        .replace("kind:'provider'", "kind:'resolver'")
        .replace("sourceId:'fixture.v1'", "sources:['fixture.v1']");
    let h = PluginHost::new(common::ID).await.unwrap();
    h.load_v2_script(&source).await.unwrap();
    assert_eq!(h.manifest().await.unwrap()["kind"], "resolver");
    assert!(h.call_entry("search", &[json!({})]).await.is_err());
    let bad = source.replace("media.resolve", "search");
    assert!(PluginHost::inspect_source(&bad, json!({})).await.is_err());
}
#[tokio::test]
async fn disposable_inspection_preserves_metadata_and_rejects_io_and_non_json() {
    let valid = common::source(
        &["media.resolve"],
        "{media:{resolve(){throw Error('must never run')}}}",
    );
    assert_eq!(
        PluginHost::inspect_source(&valid, json!({})).await.unwrap()["id"],
        common::ID
    );
    let source = valid.replace("module.exports=", "__baka.http('{}');module.exports=");
    assert!(
        PluginHost::inspect_source(&source, json!({}))
            .await
            .is_err()
    );
    for extra in ["undefined", "NaN", "Infinity", "()=>1", "1n"] {
        let invalid = valid.clone() + &format!(";module.exports.manifest.extra={extra};");
        assert!(
            PluginHost::inspect_source(&invalid, json!({}))
                .await
                .is_err(),
            "{extra}"
        );
    }
    let cycle = valid + ";module.exports.manifest.cycle=module.exports.manifest;";
    assert!(PluginHost::inspect_source(&cycle, json!({})).await.is_err());
}
#[tokio::test]
async fn page_started_before_successful_account_change_is_retired() {
    let h=common::host(&["search","auth.login"],"{search:()=>new Promise(resolve=>{globalThis.pending=true;globalThis.release=()=>resolve({items:[{id:1}],nextCursor:'old'})}),auth:{login:()=>({authenticated:true})}}").await;
    let args = [json!({})];
    let page = h.call_entry("search", &args);
    tokio::pin!(page);
    use std::future::Future;
    assert!(
        page.as_mut()
            .poll(&mut std::task::Context::from_waker(
                futures_util::task::noop_waker_ref()
            ))
            .is_pending()
    );
    h.call_entry("auth.login", &[json!({})]).await.unwrap();
    h.eval_json("release()").await.unwrap();
    assert!(
        page.await
            .unwrap_err()
            .to_string()
            .contains("account changed")
    );
}

#[tokio::test]
async fn explicit_download_failure_codes_survive_the_quickjs_boundary() {
    for code in [
        "quality_unavailable",
        "authentication_required",
        "temporary_unavailable",
    ] {
        let h = common::host(&["media.resolve"], &format!(
            "{{media:{{resolve:async()=>{{const e=new Error('private upstream text');e.code='{code}';throw e;}}}}}}"
        )).await;
        let error = h
            .call_entry(
                "media.resolve",
                &[json!({"entity":{"id":1},"quality":"flac"})],
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, baka_core::BakaError::PluginFailure{code: actual} if actual == code)
        );
    }
    let h = common::host(
        &["media.resolve"],
        "{media:{resolve:async()=>{throw Error('quality_unavailable')}}}",
    )
    .await;
    let error = h
        .call_entry(
            "media.resolve",
            &[json!({"entity":{"id":1},"quality":"flac"})],
        )
        .await
        .unwrap_err();
    assert!(!matches!(error, baka_core::BakaError::PluginFailure { .. }));
}
