mod common;
use serde_json::json;
use std::time::{Duration, Instant};
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn contended_entries_and_cancelled_waiters_do_not_lose_progress() {
    let h=std::sync::Arc::new(common::host(&["media.resolve"],"{media:{resolve:async r=>{await new Promise(done=>setTimeout(done,r.delay||1));return r.value}}}").await);
    tokio::time::timeout(Duration::from_secs(10), async {
        for round in 0..32 {
            let mut tasks = Vec::new();
            for i in 0..8 {
                let h = h.clone();
                tasks.push(tokio::spawn(async move {
                    let v = round * 8 + i;
                    assert_eq!(
                        h.call_entry("media.resolve", &[json!({"value":v})])
                            .await
                            .unwrap(),
                        v
                    );
                }));
            }
            let args = [json!({"value":-1})];
            let _ =
                tokio::time::timeout(Duration::ZERO, h.call_entry("media.resolve", &args)).await;
            for task in tasks {
                task.await.unwrap();
            }
        }
    })
    .await
    .expect("entry progress stranded");
}
#[tokio::test]
async fn fast_entry_does_not_wait_for_slow_entry_or_clobber_result() {
    let h=common::host(&["media.resolve"],"{media:{resolve:async r=>{if(r.fail)throw Error('expected');await new Promise(done=>setTimeout(done,r.delay||1));return r.value}}}").await;
    let args = [json!({"value":"slow","delay":400})];
    let (slow, fast) = tokio::join!(h.call_entry("media.resolve", &args), async {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let start = Instant::now();
        let v = h
            .call_entry("media.resolve", &[json!({"value":"fast"})])
            .await
            .unwrap();
        assert!(start.elapsed() < Duration::from_millis(200));
        assert!(
            h.call_entry("media.resolve", &[json!({"fail":true})])
                .await
                .is_err()
        );
        v
    });
    assert_eq!(slow.unwrap(), "slow");
    assert_eq!(fast, "fast");
}
#[tokio::test]
async fn timed_out_entry_cannot_overwrite_later_result() {
    let h=common::host(&["media.resolve"],"{media:{resolve:async r=>{await new Promise(done=>setTimeout(done,r.delay));return r.value}}}").await;
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            h.call_entry("media.resolve", &[json!({"value":1,"delay":100})])
        )
        .await
        .is_err()
    );
    assert_eq!(
        h.call_entry("media.resolve", &[json!({"value":2,"delay":150})])
            .await
            .unwrap(),
        2
    );
}
