mod common;
use baka_plugin_host::PluginHost;
use futures_util::future::{Either, select};
use serde_json::json;
use std::{future::Future, sync::Arc, task::Context, time::Duration};

async fn bounded<T>(work: impl Future<Output = T>) -> T {
    match select(
        Box::pin(work),
        Box::pin(futures_timer::Delay::new(Duration::from_secs(2))),
    )
    .await
    {
        Either::Left((value, _)) => value,
        Either::Right(_) => panic!("host shutdown exceeded two seconds"),
    }
}

#[tokio::test]
async fn shutdown_cancels_unresolved_entries_and_is_terminal_only_for_this_host() {
    let host = PluginHost::new(common::ID).await.unwrap();
    let other = PluginHost::new(common::ID).await.unwrap();
    host.load_v2_script(&common::source(
        &["media.resolve"],
        "{media:{resolve:r=>r.wait?new Promise(()=>{}):42}}",
    ))
    .await
    .unwrap();
    other
        .load_v2_script(&common::source(
            &["media.resolve"],
            "{media:{resolve:()=>7}}",
        ))
        .await
        .unwrap();
    let args = [json!({"wait":true})];
    let call = host.call_entry("media.resolve", &args);
    let mut call = std::pin::pin!(call);
    assert!(
        call.as_mut()
            .poll(&mut Context::from_waker(
                futures_util::task::noop_waker_ref()
            ))
            .is_pending()
    );
    host.shutdown();
    host.shutdown();
    assert!(
        bounded(call)
            .await
            .unwrap_err()
            .to_string()
            .contains("plugin_host_stopped")
    );
    assert!(
        host.call_entry("media.resolve", &[json!({})])
            .await
            .unwrap_err()
            .to_string()
            .contains("plugin_host_stopped")
    );
    assert!(host.eval("console.log('must not run')").await.is_err());
    assert!(
        host.load_v2_script("console.log('must not load')")
            .await
            .is_err()
    );
    assert!(host.eval_json("42").await.is_err());
    assert!(host.has_global("module").await.is_err());
    assert!(host.logs().is_empty());
    assert_eq!(
        other
            .call_entry("media.resolve", &[json!({})])
            .await
            .unwrap(),
        7
    );
}

#[tokio::test]
async fn shutdown_cancels_a_script_load_waiting_for_a_long_timer() {
    let host = PluginHost::new("loading").await.unwrap();
    let load = host
        .load_v2_script("// @baka-provider 2\nsetTimeout(() => console.log('too late'), 3600000);");
    let mut load = std::pin::pin!(load);
    assert!(
        load.as_mut()
            .poll(&mut Context::from_waker(
                futures_util::task::noop_waker_ref()
            ))
            .is_pending()
    );
    host.shutdown();
    assert!(
        bounded(load)
            .await
            .unwrap_err()
            .to_string()
            .contains("plugin_host_stopped")
    );
    assert!(host.logs().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_interrupts_running_javascript_even_with_a_retained_host() {
    let host = Arc::new(PluginHost::new("spinning").await.unwrap());
    let worker = host.clone();
    let call = tokio::spawn(async move {
        worker
            .eval_json("(() => { console.log('entered'); while(true) {} })()")
            .await
    });
    bounded(async {
        while host.logs().is_empty() {
            futures_timer::Delay::new(Duration::from_millis(1)).await;
        }
    })
    .await;
    host.shutdown();
    assert!(
        bounded(call)
            .await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("plugin_host_stopped")
    );
    assert!(host.eval_json("1").await.is_err());
}

#[tokio::test]
async fn shutdown_stops_background_timers_and_rejects_late_driver_registration() {
    let host = PluginHost::new("background").await.unwrap();
    host.eval_json("Boolean((function tick(){console.log('tick');setTimeout(tick,5)})())")
        .await
        .unwrap();
    let driver = tokio::spawn(host.background_driver());
    bounded(async {
        while host.logs().is_empty() {
            futures_timer::Delay::new(Duration::from_millis(1)).await;
        }
    })
    .await;
    host.shutdown();
    bounded(driver).await.unwrap();
    let logs = host.logs();
    futures_timer::Delay::new(Duration::from_millis(30)).await;
    assert_eq!(host.logs(), logs);
    bounded(host.background_driver()).await;
    assert_eq!(host.logs(), logs);
}
