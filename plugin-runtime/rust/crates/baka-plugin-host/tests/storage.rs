mod common;
use baka_plugin_host::PluginHost;
use serde_json::json;
#[tokio::test]
async fn storage_survives_recreation_isolates_identity_and_rejects_oversize() {
    let root = std::env::temp_dir().join(format!(
        "baka-v2-storage-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let source = common::source(
        &["media.resolve"],
        "{media:{resolve:async(r,sdk)=>{if(r.op==='set')return sdk.storage.set(r.key,r.value);if(r.op==='remove')return sdk.storage.remove(r.key);return sdk.storage.get(r.key)}}}",
    );
    let h = PluginHost::new(common::ID).await.unwrap();
    h.configure_storage(&root).await.unwrap();
    h.load_v2_script(&source).await.unwrap();
    h.call_entry(
        "media.resolve",
        &[json!({"op":"set","key":"user-1","value":"identity-1"})],
    )
    .await
    .unwrap();
    drop(h);
    let h = PluginHost::new(common::ID).await.unwrap();
    h.configure_storage(&root).await.unwrap();
    h.load_v2_script(&source).await.unwrap();
    assert_eq!(
        h.call_entry("media.resolve", &[json!({"key":"user-1"})])
            .await
            .unwrap(),
        "identity-1"
    );
    let other = PluginHost::new("org.example.other").await.unwrap();
    other.configure_storage(&root).await.unwrap();
    other
        .load_v2_script(&source.replace(common::ID, "org.example.other"))
        .await
        .unwrap();
    assert_eq!(
        other
            .call_entry("media.resolve", &[json!({"key":"user-1"})])
            .await
            .unwrap(),
        json!(null)
    );
    assert!(
        h.call_entry(
            "media.resolve",
            &[json!({"op":"set","key":"user-1","value":"x".repeat(10*1024*1024+1)})]
        )
        .await
        .is_err()
    );
    assert_eq!(
        h.call_entry("media.resolve", &[json!({"key":"user-1"})])
            .await
            .unwrap(),
        "identity-1"
    );
    h.call_entry("media.resolve", &[json!({"op":"remove","key":"user-1"})])
        .await
        .unwrap();
    assert_eq!(
        h.call_entry("media.resolve", &[json!({"key":"user-1"})])
            .await
            .unwrap(),
        json!(null)
    );
    drop(h);
    drop(other);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn storage_is_not_exposed_until_identity_is_validated() {
    let h = PluginHost::new(common::ID).await.unwrap();
    h.configure_storage(&std::env::temp_dir().join("baka-unused-storage"))
        .await
        .unwrap();
    assert_eq!(
        h.eval_json("typeof __baka.storage_set").await.unwrap(),
        "undefined"
    );
    let wrong = common::source(&["media.resolve"], "{media:{resolve:()=>null}}")
        .replace(common::ID, "org.example.other");
    assert!(h.load_v2_script(&wrong).await.is_err());
    assert_eq!(
        h.eval_json("typeof __baka.storage_set").await.unwrap(),
        "undefined"
    );
}
