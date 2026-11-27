//! Engine-scoped policy and cancellation for native plugin transports.
//! Legacy callers remain compatible until the first valid workspace command.
use baka_core::workspace::{CurrentDownload, CurrentStream, NetworkCapability, Permit, Workspace};
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use serde_json::Value;
use std::{
    future::Future,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Default)]
struct State {
    policy: Workspace,
    managed: bool,
    active: Vec<Weak<Request>>,
    next_chain: u64,
}

struct Request {
    permit: Option<Permit>,
    chain: u64,
    capability: NetworkCapability,
    abort: AbortHandle,
    download: Option<CurrentDownload>,
    retired: Arc<AtomicBool>,
}

impl State {
    fn current(&self, request: &Request) -> bool {
        if request.retired.load(Ordering::Acquire) {
            return false;
        }
        match &request.permit {
            Some(permit) => {
                self.managed
                    && self
                        .policy
                        .permits_chain(permit, request.capability, request.chain)
            }
            None => !self.managed,
        }
    }
}

#[derive(Clone, Default)]
pub struct WorkspaceTransport(Arc<Mutex<State>>);

/// One request chain's original epoch. Publication shares the policy lock so a
/// completed artifact cannot be published after a concurrent mode transition.
#[derive(Clone)]
pub struct WorkspaceRequestGuard {
    transport: WorkspaceTransport,
    request: Arc<Request>,
}

impl WorkspaceRequestGuard {
    /// Immutable original session/epoch for caches; never consult newer policy.
    pub fn cache_scope(&self) -> Value {
        serde_json::to_value(&self.request.permit).expect("permit is serializable")
    }

    /// A stream range/decoder read retains this request's original capability
    /// and epoch. It must never acquire a permit from the new active mode.
    pub fn admit_followup(&self) -> Result<WorkspaceRequest, String> {
        let mut state = self
            .transport
            .0
            .lock()
            .map_err(|_| "workspace_policy_poisoned")?;
        if !state.current(&self.request) {
            return Err("workspace_request_expired".into());
        }
        Ok(self.transport.register(
            &mut state,
            self.request.capability,
            self.request.permit.clone(),
            self.request.chain,
            self.request.download.clone(),
            Some(self.request.retired.clone()),
        ))
    }

    /// The playback owner supplies the installed session/track identity. A
    /// caller cannot acquire a fresh stream through this descriptor.
    pub fn current_stream(
        &self,
        playback_session: String,
        track: Value,
    ) -> Result<CurrentStream, String> {
        self.publish(|| {
            if self.request.capability != NetworkCapability::Stream {
                return Err("workspace_current_stream_invalid".into());
            }
            let permit = self
                .request
                .permit
                .clone()
                .ok_or("workspace_current_stream_unmanaged")?;
            Ok(CurrentStream::new(
                permit,
                self.request.chain,
                playback_session,
                track,
            ))
        })
    }

    /// Identity comes from native admission, never from the selection payload.
    pub fn current_download(&self) -> Result<CurrentDownload, String> {
        self.publish(|| {
            self.request
                .download
                .clone()
                .ok_or_else(|| "workspace_current_download_unowned".into())
        })
    }

    /// Retire the task chain even while general online capabilities remain open.
    /// Children share the terminal flag; release cannot leave an orphaned body.
    pub fn retire_download_task(&self) -> Result<Value, String> {
        let download = self
            .request
            .download
            .as_ref()
            .ok_or("workspace_current_download_unowned")?;
        let mut state = self
            .transport
            .0
            .lock()
            .map_err(|_| "workspace_policy_poisoned")?;
        self.request.retired.store(true, Ordering::Release);
        for request in state.active.iter().filter_map(Weak::upgrade) {
            if request.chain == self.request.chain {
                request.abort.abort();
            }
        }
        let (task_id, generation) = download.identity();
        let result = state.policy.release_download(task_id, generation);
        // A failed release can fault policy (for example revision exhaustion).
        // Invalidate all affected owners, not only this task's children.
        for request in state.active.iter().filter_map(Weak::upgrade) {
            if !state.current(&request) {
                request.abort.abort();
            }
        }
        result
    }

    pub fn release_current_download(&self) -> Result<Value, String> {
        let download = self
            .request
            .download
            .as_ref()
            .ok_or("workspace_current_download_unowned")?;
        let (task_id, generation) = download.identity();
        self.transport
            .command(serde_json::json!({"version":1,"command":{
            "op":"releaseDownload","taskId":task_id,"generation":generation}}))
    }

    /// Playback completion/new selection releases only this session's exception.
    pub fn release_current_stream(&self, playback_session: &str) -> Result<Value, String> {
        self.transport
            .command(serde_json::json!({"version":1,"command":{
            "op":"releaseStream","playbackSession":playback_session}}))
    }

    pub fn is_current(&self) -> bool {
        self.transport
            .0
            .lock()
            .map(|state| state.current(&self.request))
            .unwrap_or(false)
    }

    /// The closure must not re-enter policy APIs while this lock is held.
    pub fn publish<T>(&self, publish: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let state = self
            .transport
            .0
            .lock()
            .map_err(|_| "workspace_policy_poisoned")?;
        if !state.current(&self.request) {
            return Err("workspace_request_expired".into());
        }
        publish()
    }
}

/// Admission is synchronous: scheduling work must not recapture a newer epoch.
pub struct WorkspaceRequest {
    guard: WorkspaceRequestGuard,
    registration: AbortRegistration,
}

impl WorkspaceRequest {
    pub fn guard(&self) -> WorkspaceRequestGuard {
        self.guard.clone()
    }

    pub async fn run<T>(
        self,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let result = Abortable::new(future, self.registration)
            .await
            .map_err(|_| "workspace_request_cancelled".to_string())?;
        self.guard.publish(|| result)
    }
}

impl WorkspaceTransport {
    /// Command processing and invalidation share the same lock as admission.
    /// A malformed command does not opt a legacy engine into managed mode.
    pub fn command(&self, value: Value) -> Result<Value, String> {
        self.command_impl(
            value,
            None::<fn(Option<WorkspaceRequestGuard>) -> Result<(), String>>,
        )
    }

    /// Registry effects share the admission lock with the committed policy.
    /// Observers must not re-enter transport APIs or wait for JavaScript.
    pub fn command_observe(
        &self,
        value: Value,
        observe: impl FnOnce(Option<WorkspaceRequestGuard>) -> Result<(), String>,
    ) -> Result<Value, String> {
        self.command_impl(value, Some(observe))
    }

    fn command_impl(
        &self,
        value: Value,
        observe: Option<impl FnOnce(Option<WorkspaceRequestGuard>) -> Result<(), String>>,
    ) -> Result<Value, String> {
        let mut state = self.0.lock().map_err(|_| "workspace_policy_poisoned")?;
        // Continue only a chain still owned by an admitted native request.
        // The descriptor alone cannot create or revive a request chain.
        if value["command"]["transition"]["type"] == "continueStream" {
            let stream: CurrentStream =
                serde_json::from_value(value["command"]["transition"]["stream"].clone())
                    .map_err(|_| "workspace_current_stream_invalid")?;
            if !state
                .active
                .iter()
                .filter_map(Weak::upgrade)
                .any(|request| {
                    state.current(&request)
                        && request.capability == NetworkCapability::Stream
                        && request
                            .permit
                            .as_ref()
                            .is_some_and(|permit| stream.matches(permit, request.chain))
                })
            {
                return Err("workspace_current_stream_expired".into());
            }
        }
        if value["command"]["transition"]["type"] == "continueTasks" {
            let downloads: Vec<CurrentDownload> =
                serde_json::from_value(value["command"]["transition"]["downloads"].clone())
                    .map_err(|_| "workspace_current_download_invalid")?;
            if downloads.len() > 128 {
                return Err("workspace_current_download_invalid".into());
            }
            for download in &downloads {
                if !state
                    .active
                    .iter()
                    .filter_map(Weak::upgrade)
                    .any(|request| {
                        state.current(&request) && request.download.as_ref() == Some(download)
                    })
                {
                    return Err("workspace_current_download_expired".into());
                }
            }
            if !value["command"]["transition"]["stream"].is_null() {
                let stream: CurrentStream =
                    serde_json::from_value(value["command"]["transition"]["stream"].clone())
                        .map_err(|_| "workspace_current_stream_invalid")?;
                if !state
                    .active
                    .iter()
                    .filter_map(Weak::upgrade)
                    .any(|request| {
                        state.current(&request)
                            && request.capability == NetworkCapability::Stream
                            && request
                                .permit
                                .as_ref()
                                .is_some_and(|permit| stream.matches(permit, request.chain))
                    })
                {
                    return Err("workspace_current_stream_expired".into());
                }
            }
        }
        let result = state.policy.command(value);
        if result.is_ok() {
            state.managed = true;
        }

        state.active.retain(|request| request.strong_count() > 0);
        for request in state.active.iter().filter_map(Weak::upgrade) {
            if !state.current(&request) {
                request.abort.abort();
            }
        }
        if let Some(observe) = observe.filter(|_| state.managed) {
            let guard = if state.policy.network_allowed() {
                let permit = state.policy.permit(NetworkCapability::Plugin)?;
                state.next_chain = state
                    .next_chain
                    .checked_add(1)
                    .ok_or("workspace_chain_exhausted")?;
                let chain = state.next_chain;
                Some(
                    self.register(
                        &mut state,
                        NetworkCapability::Plugin,
                        Some(permit),
                        chain,
                        None,
                        None,
                    )
                    .guard(),
                )
            } else {
                None
            };
            observe(guard)?;
        }
        result
    }

    /// Used by redirect callbacks as well as the initial client boundary.
    pub fn allowed(&self) -> bool {
        self.0
            .lock()
            .map(|s| !s.managed || s.policy.network_allowed())
            .unwrap_or(false)
    }

    /// Synchronous local effects share the policy lock without issuing a network
    /// permit. The closure must not re-enter transport APIs.
    pub fn local_effect<T>(
        &self,
        effect: impl FnOnce(bool) -> Result<T, String>,
    ) -> Result<T, String> {
        let state = self.0.lock().map_err(|_| "workspace_policy_poisoned")?;
        effect(!state.managed || state.policy.network_allowed())
    }

    /// Reserve the original capability/epoch before scheduling a producer.
    pub fn admit(&self, capability: NetworkCapability) -> Result<WorkspaceRequest, String> {
        self.admit_expected(capability, None, false, None)
    }

    /// Platform callers pass their original opaque permit across the ABI. Never
    /// recapture a newer epoch when their worker eventually reaches admission.
    pub fn admit_permit(
        &self,
        capability: NetworkCapability,
        permit: &Permit,
    ) -> Result<WorkspaceRequest, String> {
        self.admit_expected(capability, Some(permit), false, None)
    }

    /// Managed platform workers must supply their original permit. Legacy
    /// engines may omit it, but a delayed worker cannot adopt a newer epoch.
    pub fn admit_platform(
        &self,
        capability: NetworkCapability,
        permit: Option<&Permit>,
    ) -> Result<WorkspaceRequest, String> {
        self.admit_expected(capability, permit, true, None)
    }

    /// A download owner reserves one original request chain for one task generation.
    /// The descriptor cannot be minted by a generic Download permit or in local mode.
    pub fn admit_download_task(
        &self,
        permit: &Permit,
        task_id: String,
        generation: u64,
    ) -> Result<WorkspaceRequest, String> {
        if !CurrentDownload::valid_task_id(&task_id) {
            return Err("workspace_current_download_invalid".into());
        }
        self.admit_expected(
            NetworkCapability::Download,
            Some(permit),
            true,
            Some((task_id, generation)),
        )
    }

    fn admit_expected(
        &self,
        capability: NetworkCapability,
        expected: Option<&Permit>,
        platform: bool,
        download_task: Option<(String, u64)>,
    ) -> Result<WorkspaceRequest, String> {
        let mut state = self.0.lock().map_err(|_| "workspace_policy_poisoned")?;
        if platform && state.managed && expected.is_none() {
            return Err("workspace_permit_required".into());
        }
        if let Some(expected) = expected
            && (!state.managed || !state.policy.permits(expected, capability))
        {
            return Err("workspace_request_expired".into());
        }
        let permit = if state.managed {
            Some(state.policy.permit(capability)?)
        } else {
            None
        };
        state.next_chain = state
            .next_chain
            .checked_add(1)
            .ok_or("workspace_chain_exhausted")?;
        let chain = state.next_chain;
        let download = if let Some((task_id, generation)) = download_task {
            Some(CurrentDownload::new(
                permit.clone().ok_or("workspace_permit_required")?,
                chain,
                task_id,
                generation,
            ))
        } else {
            None
        };
        Ok(self.register(&mut state, capability, permit, chain, download, None))
    }

    fn register(
        &self,
        state: &mut State,
        capability: NetworkCapability,
        permit: Option<Permit>,
        chain: u64,
        download: Option<CurrentDownload>,
        retired: Option<Arc<AtomicBool>>,
    ) -> WorkspaceRequest {
        let (abort, registration) = AbortHandle::new_pair();
        let request = Arc::new(Request {
            permit,
            chain,
            capability,
            abort,
            download,
            retired: retired.unwrap_or_default(),
        });
        state.active.retain(|request| request.strong_count() > 0);
        state.active.push(Arc::downgrade(&request));
        WorkspaceRequest {
            guard: WorkspaceRequestGuard {
                transport: self.clone(),
                request,
            },
            registration,
        }
    }

    /// The future is never polled when admission fails. Dropping an aborted
    /// request drops its response/body too. Re-entry cannot revive old results.
    pub async fn run<T>(
        &self,
        capability: NetworkCapability,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        self.admit(capability)?.run(future).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn command(gate: &WorkspaceTransport, command: Value) -> Value {
        gate.command(json!({"version":1,"command":command}))
            .unwrap()
    }

    fn transition(gate: &WorkspaceTransport, transition: Value) {
        let revision = command(gate, json!({"op":"snapshot"}))["revision"].clone();
        command(
            gate,
            json!({"op":"commit","revision":revision,"transition":transition}),
        );
    }

    fn online(gate: &WorkspaceTransport) {
        command(gate, json!({"op":"restore","preferences":null}));
        transition(gate, json!({"type":"unlock","confirmed":true}));
        transition(gate, json!({"type":"switch","mode":"online"}));
    }

    #[tokio::test]
    async fn fault_cancels_pending_requests_and_blocks_future_transport() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let request = gate.run(
            NetworkCapability::Plugin,
            std::future::pending::<Result<(), String>>(),
        );
        tokio::pin!(request);
        assert!(
            request
                .as_mut()
                .poll(&mut std::task::Context::from_waker(
                    futures_util::task::noop_waker_ref()
                ))
                .is_pending()
        );
        command(&gate, json!({"op":"fault"}));
        assert!(!gate.allowed());
        assert_eq!(request.await.unwrap_err(), "workspace_request_cancelled");
        assert!(
            gate.run(NetworkCapability::Plugin, async {
                panic!("transport polled after fault");
                #[allow(unreachable_code)]
                Ok(())
            })
            .await
            .is_err()
        );
        assert_eq!(command(&gate, json!({"op":"snapshot"}))["faulted"], true);
    }

    #[tokio::test]
    async fn unready_and_local_never_poll_transport() {
        let gate = WorkspaceTransport::default();
        command(&gate, json!({"op":"snapshot"}));
        let polled = AtomicBool::new(false);
        for restored in [false, true] {
            if restored {
                command(&gate, json!({"op":"restore","preferences":null}));
            }
            let result = gate
                .run(NetworkCapability::Plugin, async {
                    polled.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .await;
            assert!(result.is_err());
            assert!(!polled.load(Ordering::SeqCst));
        }
    }

    #[tokio::test]
    async fn switch_cancels_pending_body_and_reentry_never_revives_it() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let request = gate.run(
            NetworkCapability::Plugin,
            std::future::pending::<Result<(), String>>(),
        );
        tokio::pin!(request);
        assert!(
            request
                .as_mut()
                .poll(&mut std::task::Context::from_waker(
                    futures_util::task::noop_waker_ref()
                ))
                .is_pending()
        );
        transition(&gate, json!({"type":"switch","mode":"local"}));
        transition(&gate, json!({"type":"switch","mode":"online"}));
        assert_eq!(request.await.unwrap_err(), "workspace_request_cancelled");
        assert_eq!(
            gate.run(NetworkCapability::Plugin, async { Ok(42) })
                .await
                .unwrap(),
            42
        );
    }

    #[tokio::test]
    async fn changed_policy_rejects_same_poll_completion() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let result = gate
            .run(NetworkCapability::Plugin, async {
                transition(&gate, json!({"type":"switch","mode":"local"}));
                transition(&gate, json!({"type":"switch","mode":"online"}));
                Ok("stale")
            })
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn prepare_and_startup_preference_do_not_cancel_requests() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let result = gate
            .run(NetworkCapability::Plugin, async {
                command(
                    &gate,
                    json!({"op":"prepare","transition":{"type":"switch","mode":"local"}}),
                );
                transition(&gate, json!({"type":"startup","mode":"rememberLast"}));
                Ok(42)
            })
            .await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn activating_policy_cancels_legacy_requests_but_is_engine_scoped() {
        let gate = WorkspaceTransport::default();
        let other = WorkspaceTransport::default();
        assert!(gate.command(json!({"version":99})).is_err());
        assert!(gate.allowed());
        let request = gate.run(
            NetworkCapability::Plugin,
            std::future::pending::<Result<(), String>>(),
        );
        tokio::pin!(request);
        assert!(
            request
                .as_mut()
                .poll(&mut std::task::Context::from_waker(
                    futures_util::task::noop_waker_ref()
                ))
                .is_pending()
        );
        command(&gate, json!({"op":"snapshot"}));
        assert_eq!(request.await.unwrap_err(), "workspace_request_cancelled");
        assert!(other.allowed());
        assert_eq!(
            other
                .run(NetworkCapability::Plugin, async { Ok(42) })
                .await
                .unwrap(),
            42
        );
    }

    #[tokio::test]
    async fn synchronous_admission_cannot_recapture_a_new_epoch_before_first_poll() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let request = gate.admit(NetworkCapability::Download).unwrap();
        let guard = request.guard();
        transition(&gate, json!({"type":"switch","mode":"local"}));
        transition(&gate, json!({"type":"switch","mode":"online"}));
        assert!(!guard.is_current());
        let published = AtomicBool::new(false);
        assert_eq!(
            guard
                .publish(|| {
                    published.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap_err(),
            "workspace_request_expired"
        );
        assert!(!published.load(Ordering::SeqCst));
        let polled = AtomicBool::new(false);
        assert_eq!(
            request
                .run(async {
                    polled.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .await
                .unwrap_err(),
            "workspace_request_cancelled"
        );
        assert!(!polled.load(Ordering::SeqCst));
    }

    #[test]
    fn synchronous_publication_rejects_local_fault_and_relocked_epochs() {
        for transition_value in [
            json!({"type":"switch","mode":"local"}),
            json!({"type":"relock"}),
        ] {
            let gate = WorkspaceTransport::default();
            online(&gate);
            let request = gate.admit(NetworkCapability::Download).unwrap();
            let guard = request.guard();
            assert_eq!(guard.publish(|| Ok(42)).unwrap(), 42);
            transition(&gate, transition_value);
            assert!(guard.publish(|| Ok(42)).is_err());
        }
        let gate = WorkspaceTransport::default();
        online(&gate);
        let request = gate.admit(NetworkCapability::Download).unwrap();
        command(&gate, json!({"op":"fault"}));
        assert!(request.guard().publish(|| Ok(42)).is_err());
    }

    #[test]
    fn publication_and_mode_commit_share_one_lock() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let request = gate.admit(NetworkCapability::Download).unwrap();
        let guard = request.guard();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let policy = gate.clone();
        let worker = std::thread::spawn(move || {
            release_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            started_tx.send(()).unwrap();
            transition(&policy, json!({"type":"switch","mode":"local"}));
        });
        let artifact = guard
            .publish(|| {
                release_tx.send(()).unwrap();
                started_rx
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                // The competing transition cannot invalidate an in-progress publish.
                Ok("completed artifact")
            })
            .unwrap();
        worker.join().unwrap();
        assert_eq!(artifact, "completed artifact");
        assert!(!guard.is_current());
        assert!(guard.publish(|| Ok("late artifact")).is_err());
    }
    #[tokio::test]
    async fn lease_keeps_only_selected_chain_followups_and_cancels_prefetch() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let current = gate.admit(NetworkCapability::Stream).unwrap();
        let guard = current.guard();
        let prefetch = gate.admit(NetworkCapability::Stream).unwrap();
        let prefetch_guard = prefetch.guard();
        assert_eq!(guard.cache_scope(), prefetch_guard.cache_scope());
        let current_task = tokio::spawn(current.run(std::future::pending::<Result<(), String>>()));
        let prefetch_task =
            tokio::spawn(prefetch.run(std::future::pending::<Result<(), String>>()));
        let stream = guard
            .current_stream("player-1".into(), json!({"platform":"test","id":1}))
            .unwrap();
        transition(&gate, json!({"type":"continueStream","stream":stream}));
        assert!(!gate.allowed());
        assert!(!current_task.is_finished());
        assert!(
            prefetch_task
                .await
                .unwrap()
                .unwrap_err()
                .contains("cancelled")
        );
        assert!(!prefetch_guard.is_current());
        for capability in [
            NetworkCapability::Stream,
            NetworkCapability::Plugin,
            NetworkCapability::Artwork,
            NetworkCapability::Lyrics,
            NetworkCapability::Download,
            NetworkCapability::Update,
        ] {
            assert!(gate.admit(capability).is_err());
        }
        let permit: Permit = serde_json::from_value(guard.cache_scope()).unwrap();
        assert!(
            gate.admit_platform(NetworkCapability::Stream, Some(&permit))
                .is_err()
        );
        assert!(
            guard
                .admit_followup()
                .unwrap()
                .run(async { Ok(7) })
                .await
                .is_ok()
        );
        command(
            &gate,
            json!({"op":"releaseStream","playbackSession":"old-session"}),
        );
        assert!(guard.is_current());
        command(
            &gate,
            json!({"op":"releaseStream","playbackSession":"player-1"}),
        );
        assert!(
            current_task
                .await
                .unwrap()
                .unwrap_err()
                .contains("cancelled")
        );
        assert!(guard.admit_followup().is_err());
        transition(&gate, json!({"type":"switch","mode":"online"}));
        assert!(!guard.is_current());
    }

    #[test]
    fn stale_foreign_or_unowned_descriptors_cannot_revive_a_stream() {
        let gate = WorkspaceTransport::default();
        online(&gate);
        let other = WorkspaceTransport::default();
        online(&other);
        let foreign = other
            .admit(NetworkCapability::Stream)
            .unwrap()
            .guard()
            .current_stream("player".into(), json!({"platform":"test","id":1}))
            .unwrap();
        let revision = command(&gate, json!({"op":"snapshot"}))["revision"].clone();
        assert!(gate.command(json!({"version":1,"command":{"op":"prepare","transition":{"type":"continueStream","stream":foreign}}})).is_err());
        let guard = gate.admit(NetworkCapability::Stream).unwrap().guard();
        let stream = guard
            .current_stream("player".into(), json!({"platform":"test","id":1}))
            .unwrap();
        drop(guard);
        assert!(gate.command(json!({"version":1,"command":{"op":"commit","revision":revision,"transition":{"type":"continueStream","stream":stream}}})).is_err());
        assert!(gate.allowed());
    }
}

#[cfg(test)]
mod download_tests;
