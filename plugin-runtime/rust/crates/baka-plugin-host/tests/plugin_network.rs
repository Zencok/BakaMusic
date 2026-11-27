mod common;
use baka_plugin_host::{PluginHost, plugin_network::PluginNetwork};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};

fn server(
    statuses: Vec<u16>,
    body: &'static str,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for status in statuses {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            seen.push(String::from_utf8(request).unwrap());
            write!(socket,"HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            socket.flush().unwrap();
            let _ = socket.read(&mut [0]);
        }
        seen
    });
    (url, task)
}

#[tokio::test]
async fn media_probe_preserves_source_headers_and_user_agent() {
    use axum::{
        Router,
        body::Body,
        http::{HeaderMap, StatusCode},
        response::Response,
        routing::get,
    };
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = calls.clone();
    let app = Router::new().route(
        "/audio",
        get(move |headers: HeaderMap| {
            seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                let authorized = headers.get("authorization").and_then(|v| v.to_str().ok())
                    == Some("Bearer fixture")
                    && headers.get("referer").and_then(|v| v.to_str().ok())
                        == Some("https://fixture.test/")
                    && headers.get("user-agent").and_then(|v| v.to_str().ok())
                        == Some("FixturePlayer/1")
                    && headers.get("range").and_then(|v| v.to_str().ok()) == Some("bytes=0-1");
                Response::builder()
                    .status(if authorized {
                        StatusCode::PARTIAL_CONTENT
                    } else {
                        StatusCode::FORBIDDEN
                    })
                    .body(Body::empty())
                    .unwrap()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/audio", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let network = PluginNetwork::default();
    network.configure(None, true).unwrap();
    let source = json!({"url":url,"headers":{"Authorization":"Bearer fixture","Referer":"https://fixture.test/","Range":"bytes=0-9999"},"userAgent":"FixturePlayer/1"});
    let resolved = network.probe_source(&source).await;
    server.abort();
    resolved.unwrap();
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn caller_budget_bounds_stalled_canonical_handler() {
    let host = common::host(
        &["media.resolve"],
        "{media:{resolve:()=>new Promise(()=>{})}}",
    )
    .await;
    assert!(
        tokio::time::timeout(
            Duration::from_millis(50),
            host.call_entry("media.resolve", &[json!({})])
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn proxy_changes_apply_to_existing_runtime_requests() {
    let network = PluginNetwork::default();
    let (first, a) = server(vec![200], "https://example.test/first");
    let (second, b) = server(vec![200], "https://example.test/second");
    network.configure(Some(&first), false).unwrap();
    let host = PluginHost::new_with_network(common::ID, network.clone())
        .await
        .unwrap();
    host.load_v2_script(&common::source(&["media.resolve"],"{media:{resolve:async(r,sdk)=>({url:(await sdk.http.request({url:'http://fixture.invalid/media',responseType:'text'})).body})}}" )).await.unwrap();
    assert_eq!(
        host.call_entry("media.resolve", &[json!({})])
            .await
            .unwrap()["url"],
        "https://example.test/first"
    );
    network.configure(Some(&second), false).unwrap();
    assert_eq!(
        host.call_entry("media.resolve", &[json!({})])
            .await
            .unwrap()["url"],
        "https://example.test/second"
    );
    for seen in [a.join().unwrap(), b.join().unwrap()] {
        assert!(seen[0].starts_with("GET http://fixture.invalid/media HTTP/1.1"));
    }
    assert!(
        network
            .configure(Some("socks5://localhost:1"), false)
            .is_err()
    );
}

#[tokio::test]
async fn probe_reports_http_retryability_and_accepts_partial_content() {
    let network = PluginNetwork::default();
    let (url, task) = server(vec![403, 206], "");
    network.configure(Some(&url), true).unwrap();
    let source = json!({"url":url});
    let error = network.probe_source(&source).await.unwrap_err();
    assert!(error.1);
    assert!(error.0.contains("403"));
    network.probe_source(&source).await.unwrap();
    let seen = tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    assert_eq!(seen.len(), 2);
    assert!(
        seen.iter()
            .all(|r| r.to_lowercase().contains("range: bytes=0-1"))
    );
    let error = network.probe_source(&source).await.unwrap_err();
    assert!(!error.1);
}

#[tokio::test]
async fn successful_probe_releases_stream_without_downloading_media_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let network = PluginNetwork::default();
    network.configure(Some(&url), true).unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000000000\r\n\r\n")
            .unwrap();
        // No body is sent. Returning from probe requires dropping, not reading it.
        match socket.read(&mut [0]) {
            Ok(0) => (),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                ) => {}
            other => panic!("probe retained the media stream: {other:?}"),
        }
    });
    tokio::time::timeout(Duration::from_secs(2), network.probe(&url))
        .await
        .unwrap()
        .unwrap();
    // Hyper closes the connection on the executor after Response is dropped.
    // A blocking join on this current-thread runtime would prevent that work.
    tokio::task::spawn_blocking(move || server.join().unwrap())
        .await
        .unwrap();
}
