//! Strict V2 entry ownership, independent from workspace shutdown.
mod common;
use baka_plugin_host::PluginHost;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Arc,
    time::Duration,
};

fn headers(socket: &mut std::net::TcpStream) {
    socket.set_nonblocking(false).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut data = Vec::new();
    while !data.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        socket.read_exact(&mut byte).unwrap();
        data.push(byte[0]);
    }
}
fn closed(socket: &mut std::net::TcpStream) -> bool {
    match socket.read(&mut [0]) {
        Ok(0) => true,
        Err(error) => matches!(
            error.kind(),
            std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
        ),
        _ => false,
    }
}
async fn host() -> Arc<PluginHost> {
    let host = PluginHost::new(common::ID).await.unwrap();
    let source = common::source(
        &["media.resolve"],
        "{media:{resolve:async(r,sdk)=>{globalThis.request=url=>sdk.http.request({url}).then(r=>r.body);return globalThis.entries[r.op](r.url)}}}",
    );
    let source = source
        + r#";
        let release; const sharedGate=new Promise(r=>release=r);
        let started=0;globalThis.ticks=0;
        globalThis.entries={
            slow:async url=>{await Promise.resolve();await new Promise(r=>setTimeout(r,5));
                try{await request(url+'/slow')}catch(_){}
                try{await request(url+'/late')}catch(_){}
                return true;
            },
            healthy:async url=>request(url),
            gated:async url=>{started++;await sharedGate;try{await request(url)}catch(_){}return true},
            started:()=>started,release:()=>release(),
            tick:()=>new Promise(r=>setTimeout(()=>r(true),5))
        };
    "#;
    host.load_v2_script(&source).await.unwrap();
    host.call_entry("media.resolve", &[json!({"op":"started"})])
        .await
        .unwrap();
    host.eval_json("Boolean((function tick(){ticks++;setTimeout(tick,5)})())")
        .await
        .unwrap();
    Arc::new(host)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_a_timer_wait_prevents_later_io_without_stopping_background_timers() {
    for _fixture in [()] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let host = host().await;
        host.eval_json("Boolean(entries.delayed=async url=>{globalThis.sleeping=true;await new Promise(r=>setTimeout(r,80));return request(url)})").await.unwrap();
        let a = host.clone();
        let call = tokio::spawn(async move {
            a.call_entry("media.resolve", &[json!({"op":"delayed","url":url})])
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while host
                .eval_json("Boolean(globalThis.sleeping)")
                .await
                .unwrap()
                != true
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        call.abort();
        assert!(call.await.unwrap_err().is_cancelled());
        let driver = tokio::spawn(host.background_driver());
        tokio::time::sleep(Duration::from_millis(120)).await;
        for _ in 0..3 {
            host.call_entry("media.resolve", &[json!({"op":"tick"})])
                .await
                .unwrap();
        }
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err());
        assert!(host.eval_json("ticks").await.unwrap().as_u64().unwrap() > 0);
        drop(host);
        driver.await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn host_shutdown_closes_independent_background_http_without_a_js_driver() {
    for _fixture in [()] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (sent, received) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            headers(&mut socket);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n")
                .unwrap();
            sent.send(()).unwrap();
            closed(&mut socket)
        });
        let host = host().await;
        // Executed in scope zero, independently from a foreground call.
        host.eval_json(&format!("Boolean(request({}).catch(()=>{{}}))", json!(url)))
            .await
            .unwrap();
        tokio::task::spawn_blocking(move || received.recv_timeout(Duration::from_secs(2)).unwrap())
            .await
            .unwrap();
        host.shutdown();
        assert!(
            tokio::task::spawn_blocking(move || server.join().unwrap())
                .await
                .unwrap()
        );
        assert!(
            host.call_entry("media.resolve", &[json!({"op":"tick"})])
                .await
                .is_err()
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_closes_headers_and_body_waits_without_background_driver_or_harming_another_call() {
    for _fixture in [()] {
        for body in [false, true] {
            let slow_listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let slow_url = format!("http://{}", slow_listener.local_addr().unwrap());
            let (sent, received) = std::sync::mpsc::channel();
            let slow_server = std::thread::spawn(move || {
                let (mut socket, _) = slow_listener.accept().unwrap();
                headers(&mut socket);
                if body {
                    socket
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n")
                        .unwrap();
                }
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                sent.send(()).unwrap();
                // No JS driver is running after abort. Tokio must dispose the
                // native request itself, rather than wait for another plugin call.
                let is_closed = closed(&mut socket);
                drop(socket);
                slow_listener.set_nonblocking(true).unwrap();
                std::thread::sleep(Duration::from_millis(100));
                (is_closed, slow_listener.accept().is_ok())
            });
            let healthy_listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let healthy_url = format!("http://{}/healthy", healthy_listener.local_addr().unwrap());
            let (healthy_sent, healthy_received) = std::sync::mpsc::channel();
            let (release, wait_release) = std::sync::mpsc::channel();
            let healthy_server = std::thread::spawn(move || {
                let (mut socket, _) = healthy_listener.accept().unwrap();
                headers(&mut socket);
                healthy_sent.send(()).unwrap();
                wait_release.recv_timeout(Duration::from_secs(3)).unwrap();
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                    )
                    .unwrap();
                socket.flush().unwrap();
                let _ = socket.read(&mut [0]);
            });
            let host = host().await;
            let a = host.clone();
            let slow = tokio::spawn(async move {
                a.call_entry("media.resolve", &[json!({"op":"slow","url":slow_url})])
                    .await
            });
            let b = host.clone();
            let healthy = tokio::spawn(async move {
                b.call_entry(
                    "media.resolve",
                    &[json!({"op":"healthy","url":healthy_url})],
                )
                .await
            });
            tokio::task::spawn_blocking(move || {
                received.recv_timeout(Duration::from_secs(2)).unwrap();
                healthy_received
                    .recv_timeout(Duration::from_secs(2))
                    .unwrap()
            })
            .await
            .unwrap();
            slow.abort();
            assert!(slow.await.unwrap_err().is_cancelled());
            assert!(!healthy.is_finished());
            let (is_closed, late) =
                tokio::task::spawn_blocking(move || slow_server.join().unwrap())
                    .await
                    .unwrap();
            assert!(is_closed, "body={body}: cancelled socket retained");
            assert!(!late);
            release.send(()).unwrap();
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), healthy)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
                json!({})
            );
            tokio::task::spawn_blocking(move || healthy_server.join().unwrap())
                .await
                .unwrap();
            let driver = tokio::spawn(host.background_driver());
            tokio::time::timeout(Duration::from_secs(1), async {
                while host.eval_json("ticks").await.unwrap().as_u64().unwrap() == 0 {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            drop(host);
            driver.await.unwrap();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_promise_uses_each_subscribers_scope_and_blocks_retired_followups() {
    use axum::{Router, routing::get};
    use std::sync::atomic::{AtomicUsize, Ordering};
    for _fixture in [()] {
        let orphan = Arc::new(AtomicUsize::new(0));
        let valid = Arc::new(AtomicUsize::new(0));
        let a = orphan.clone();
        let b = valid.clone();
        let app = Router::new()
            .route(
                "/orphan",
                get(move || {
                    a.fetch_add(1, Ordering::SeqCst);
                    async { "{}" }
                }),
            )
            .route(
                "/valid",
                get(move || {
                    b.fetch_add(1, Ordering::SeqCst);
                    async { "{}" }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let host = host().await;
        let url = format!("{origin}/orphan");
        let a = host.clone();
        let retired = tokio::spawn(async move {
            a.call_entry("media.resolve", &[json!({"op":"gated","url":url})])
                .await
        });
        let url = format!("{origin}/valid");
        let a = host.clone();
        let valid_call = tokio::spawn(async move {
            a.call_entry("media.resolve", &[json!({"op":"gated","url":url})])
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while host
                .call_entry("media.resolve", &[json!({"op":"started"})])
                .await
                .unwrap()
                != 2
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        retired.abort();
        assert!(retired.await.unwrap_err().is_cancelled());
        // Settled by a *third* call. Neither its scope nor the scope zero of
        // the shared promise's creation may replace either subscriber's owner.
        host.call_entry("media.resolve", &[json!({"op":"release"})])
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), valid_call)
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
            true
        );
        for _ in 0..3 {
            host.call_entry("media.resolve", &[json!({"op":"tick"})])
                .await
                .unwrap();
        }
        assert_eq!(orphan.load(Ordering::SeqCst), 0);
        assert_eq!(valid.load(Ordering::SeqCst), 1);
        server.abort();
    }
}
