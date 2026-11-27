//! Task retention must never reopen a capability or recapture a newer epoch.
use super::*;
use serde_json::{Value, json};

fn command(gate: &WorkspaceTransport, command: Value) -> Result<Value, String> {
    gate.command(json!({"version":1,"command":command}))
}
fn switch(gate: &WorkspaceTransport, transition: Value) -> Result<Value, String> {
    let revision = command(gate, json!({"op":"snapshot"}))?["revision"].clone();
    command(
        gate,
        json!({"op":"commit","revision":revision,"transition":transition}),
    )
}
fn online() -> (WorkspaceTransport, Permit) {
    let gate = WorkspaceTransport::default();
    command(&gate, json!({"op":"restore","preferences":null})).unwrap();
    switch(&gate, json!({"type":"unlock","confirmed":true})).unwrap();
    switch(&gate, json!({"type":"switch","mode":"online"})).unwrap();
    let permit = serde_json::from_value(
        command(&gate, json!({"op":"permit","capability":"download"})).unwrap(),
    )
    .unwrap();
    (gate, permit)
}
fn retain(downloads: &[CurrentDownload], stream: Option<CurrentStream>) -> Value {
    json!({"type":"continueTasks","downloads":downloads,"stream":stream})
}

#[tokio::test]
async fn keeps_only_selected_task_chains_and_current_stream_without_new_admission() {
    let (gate, permit) = online();
    let first = gate
        .admit_download_task(&permit, "task-1".into(), 0)
        .unwrap();
    let first_guard = first.guard();
    let second = gate
        .admit_download_task(&permit, "task-2".into(), 8)
        .unwrap();
    let second_guard = second.guard();
    let skipped = gate
        .admit_download_task(&permit, "task-3".into(), 4)
        .unwrap();
    let skipped_guard = skipped.guard();
    let generic = gate
        .admit_permit(NetworkCapability::Download, &permit)
        .unwrap();
    assert!(generic.guard().current_download().is_err());
    let unrelated = gate.admit(NetworkCapability::Plugin).unwrap();
    let stream = gate.admit(NetworkCapability::Stream).unwrap();
    let stream_guard = stream.guard();
    let installed = stream_guard
        .current_stream("player-1".into(), json!({"platform":"test","id":1}))
        .unwrap();
    let downloads = [
        first_guard.current_download().unwrap(),
        second_guard.current_download().unwrap(),
    ];
    let snapshot = switch(&gate, retain(&downloads, Some(installed))).unwrap();
    assert_eq!(snapshot["activeMode"], "local");
    assert_eq!(snapshot["networkAllowed"], false);
    assert_eq!(
        snapshot["currentDownloads"],
        json!([{"taskId":"task-1","generation":"0"},{"taskId":"task-2","generation":"8"}])
    );
    assert!(!gate.allowed());
    for capability in [
        NetworkCapability::Plugin,
        NetworkCapability::Download,
        NetworkCapability::Stream,
        NetworkCapability::Artwork,
        NetworkCapability::Lyrics,
        NetworkCapability::Update,
        NetworkCapability::CloudLibrary,
    ] {
        assert!(gate.admit(capability).is_err());
        assert!(command(&gate, json!({"op":"permit","capability":capability})).is_err());
    }
    assert!(
        gate.admit_download_task(&permit, "task-1".into(), 0)
            .is_err()
    );
    assert!(
        gate.admit_platform(NetworkCapability::Download, Some(&permit))
            .is_err()
    );
    assert_eq!(
        command(
            &gate,
            json!({"op":"check","permit":permit,"capability":"download"})
        )
        .unwrap(),
        false
    );
    assert!(
        generic
            .run(async {
                panic!("generic download polled in local");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
    );
    assert!(
        unrelated
            .run(async {
                panic!("plugin polled in local");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
    );
    assert!(
        skipped
            .run(async {
                panic!("unselected task polled");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
    );
    assert!(!skipped_guard.is_current());
    assert_eq!(
        first_guard
            .admit_followup()
            .unwrap()
            .run(async { Ok(42) })
            .await
            .unwrap(),
        42
    );
    assert_eq!(
        second_guard
            .admit_followup()
            .unwrap()
            .guard()
            .current_download()
            .unwrap(),
        downloads[1]
    );
    assert!(stream_guard.is_current());
    command(
        &gate,
        json!({"op":"releaseDownload","taskId":"task-1","generation":"1"}),
    )
    .unwrap();
    assert!(first_guard.is_current());
    first_guard.release_current_download().unwrap();
    assert!(
        first
            .run(async {
                panic!("released task polled");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
    );
    assert!(first_guard.admit_followup().is_err());
    assert!(second_guard.is_current());
    assert!(stream_guard.is_current());
    assert_eq!(
        second.run(async { Ok("saved bytes") }).await.unwrap(),
        "saved bytes"
    );
    second_guard.release_current_download().unwrap();
    stream_guard.release_current_stream("player-1").unwrap();
    assert!(
        stream
            .run(async {
                panic!("released stream polled");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
    );
    let final_snapshot = command(&gate, json!({"op":"snapshot"})).unwrap();
    assert_eq!(final_snapshot["currentDownloads"], json!([]));
    assert_eq!(final_snapshot["currentStream"], Value::Null);
}

#[test]
fn rejects_unowned_forged_duplicate_expired_and_foreign_tasks_atomically() {
    let (gate, permit) = online();
    let guard = gate
        .admit_download_task(&permit, "first".into(), 1)
        .unwrap()
        .guard();
    let task = guard.current_download().unwrap();
    let before = command(&gate, json!({"op":"snapshot"})).unwrap();
    let mut renamed = serde_json::to_value(&task).unwrap();
    renamed["taskId"] = json!("replacement");
    let mut generation = serde_json::to_value(&task).unwrap();
    generation["generation"] = json!("2");
    let (foreign, foreign_permit) = online();
    let foreign_guard = foreign
        .admit_download_task(&foreign_permit, "first".into(), 1)
        .unwrap()
        .guard();
    let foreign_task = foreign_guard.current_download().unwrap();
    for transition in [
        retain(&[], None),
        retain(&[task.clone(), task.clone()], None),
        retain(&vec![task.clone(); 129], None),
        retain(&[foreign_task], None),
        json!({"type":"continueTasks","downloads":[renamed]}),
        json!({"type":"continueTasks","downloads":[generation]}),
    ] {
        assert!(switch(&gate, transition).is_err());
        assert_eq!(command(&gate, json!({"op":"snapshot"})).unwrap(), before);
        assert!(guard.is_current());
    }
    command(
        &gate,
        json!({"op":"prepare","transition":retain(std::slice::from_ref(&task), None)}),
    )
    .unwrap();
    drop(guard);
    assert_eq!(
        switch(&gate, retain(&[task], None)).unwrap_err(),
        "workspace_current_download_expired"
    );
    assert_eq!(command(&gate, json!({"op":"snapshot"})).unwrap(), before);
}

#[tokio::test]
async fn fault_relock_pause_and_reentry_cancel_retained_bodies_without_reviving_them() {
    for transition in [
        json!({"type":"switch","mode":"online"}),
        json!({"type":"switch","mode":"local"}),
        json!({"type":"relock"}),
        json!({"fault":true}),
    ] {
        let (gate, permit) = online();
        let request = gate
            .admit_download_task(&permit, "original".into(), 7)
            .unwrap();
        let guard = request.guard();
        let task = guard.current_download().unwrap();
        switch(&gate, retain(std::slice::from_ref(&task), None)).unwrap();
        let body = tokio::spawn(request.run(std::future::pending::<Result<(), String>>()));
        if transition["fault"] == true {
            command(&gate, json!({"op":"fault"})).unwrap();
        } else {
            switch(&gate, transition).unwrap();
        }
        let error = tokio::time::timeout(std::time::Duration::from_secs(2), body)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(matches!(
            error.as_str(),
            "workspace_request_cancelled" | "workspace_request_expired"
        ));
        assert!(!guard.is_current());
        assert!(guard.admit_followup().is_err());
        assert_eq!(
            command(&gate, json!({"op":"snapshot"})).unwrap()["currentDownloads"],
            json!([])
        );
        assert!(switch(&gate, retain(&[task], None)).is_err());
    }
}

#[test]
fn task_admission_rejects_bad_identity_missing_scope_and_wrong_capability() {
    let (gate, permit) = online();
    for task_id in ["", " leading", "trailing ", "line\nbreak", &"x".repeat(129)] {
        assert!(
            gate.admit_download_task(&permit, task_id.into(), 0)
                .is_err()
        );
    }
    let plugin: Permit = serde_json::from_value(
        command(&gate, json!({"op":"permit","capability":"plugin"})).unwrap(),
    )
    .unwrap();
    assert!(
        gate.admit_download_task(&plugin, "first".into(), 0)
            .is_err()
    );
    assert!(
        WorkspaceTransport::default()
            .admit_download_task(&permit, "first".into(), 0)
            .is_err()
    );
}

#[test]
fn old_generation_release_cannot_cancel_reentered_task_with_same_identity() {
    let (gate, old_permit) = online();
    let old = gate
        .admit_download_task(&old_permit, "same-task".into(), 4)
        .unwrap()
        .guard();
    let old_descriptor = old.current_download().unwrap();
    switch(&gate, retain(std::slice::from_ref(&old_descriptor), None)).unwrap();
    switch(&gate, json!({"type":"switch","mode":"online"})).unwrap();
    let fresh_permit: Permit = serde_json::from_value(
        command(&gate, json!({"op":"permit","capability":"download"})).unwrap(),
    )
    .unwrap();
    let fresh = gate
        .admit_download_task(&fresh_permit, "same-task".into(), 5)
        .unwrap()
        .guard();
    switch(&gate, retain(&[fresh.current_download().unwrap()], None)).unwrap();
    old.release_current_download().unwrap();
    assert!(!old.is_current());
    assert!(fresh.is_current());
    assert!(switch(&gate, retain(&[old_descriptor], None)).is_err());
    fresh.release_current_download().unwrap();
    assert!(!fresh.is_current());
}

#[tokio::test]
async fn selected_http_body_finishes_while_unselected_body_is_cancelled() {
    async fn serve() -> (
        String,
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<()>,
        tokio::sync::oneshot::Sender<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/song", listener.local_addr().unwrap());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        let slot = Arc::new(Mutex::new(Some((started_tx, finish_rx))));
        let app = axum::Router::new().route(
            "/song",
            axum::routing::get(move || {
                let slot = slot.clone();
                async move {
                    let (started, finish) = slot.lock().unwrap().take().unwrap();
                    let stream = futures_util::stream::unfold(
                        (0u8, Some(started), Some(finish)),
                        |mut state| async move {
                            let bytes = match state.0 {
                                0 => {
                                    state.1.take().unwrap().send(()).unwrap();
                                    b"part".to_vec()
                                }
                                1 => {
                                    if state.2.take().unwrap().await.is_err() {
                                        return None;
                                    }
                                    b"done".to_vec()
                                }
                                _ => return None,
                            };
                            state.0 += 1;
                            Some((Ok::<_, std::io::Error>(bytes), state))
                        },
                    );
                    axum::response::Response::builder()
                        .header("content-length", "8")
                        .body(axum::body::Body::from_stream(stream))
                        .unwrap()
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stop_rx.await;
                })
                .await
                .unwrap();
        });
        (url, started_rx, finish_tx, stop_tx, server)
    }
    let (gate, permit) = online();
    let first = gate
        .admit_download_task(&permit, "selected".into(), 2)
        .unwrap();
    let guard = first.guard();
    let skipped = gate
        .admit_download_task(&permit, "skipped".into(), 2)
        .unwrap();
    let (first_url, first_started, finish, first_stop, first_server) = serve().await;
    let (skipped_url, skipped_started, skipped_finish, skipped_stop, skipped_server) =
        serve().await;
    let client = crate::http_client_builder().no_proxy().build().unwrap();
    let other_client = client.clone();
    let selected_body = tokio::spawn(first.run(async move {
        client
            .get(first_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())
    }));
    let skipped_body = tokio::spawn(skipped.run(async move {
        other_client
            .get(skipped_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())
    }));
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        first_started.await.unwrap();
        skipped_started.await.unwrap();
    })
    .await
    .unwrap();
    switch(&gate, retain(&[guard.current_download().unwrap()], None)).unwrap();
    let cancelled = tokio::time::timeout(std::time::Duration::from_secs(3), skipped_body)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(cancelled, "workspace_request_cancelled");
    assert!(!selected_body.is_finished());
    finish.send(()).unwrap();
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(3), selected_body)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "partdone"
    );
    guard.release_current_download().unwrap();
    drop(skipped_finish);
    first_stop.send(()).unwrap();
    skipped_stop.send(()).unwrap();
    first_server.await.unwrap();
    skipped_server.await.unwrap();
}
