//! Local-first workspace policy. Pure state, no networking or persistence.
//!
//! The owner serializes commands. UI preferences are prepared before durable
//! storage, then committed using a revision check. Request permits are volatile:
//! callers must check them before dispatch/retry and before publishing a result.
//! This policy is not itself a transport interceptor or a permission boundary.

mod download;
pub use download::CurrentDownload;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Local,
    Online,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupMode {
    #[default]
    Local,
    RememberLast,
    Online,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    version: u8,
    online_unlocked: bool,
    startup_mode: StartupMode,
    last_mode: Mode,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: 1,
            online_unlocked: false,
            startup_mode: StartupMode::Local,
            last_mode: Mode::Local,
        }
    }
}

impl Preferences {
    fn valid(&self) -> bool {
        self.version == 1
            && (self.online_unlocked
                || (self.last_mode == Mode::Local && self.startup_mode == StartupMode::Local))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkCapability {
    Plugin,
    Artwork,
    Lyrics,
    Stream,
    Download,
    Update,
    CloudLibrary,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permit {
    // Decimal strings avoid precision loss in JSON consumers.
    epoch: String,
    session: String,
    capability: NetworkCapability,
}

/// Volatile exception for one already-admitted stream chain. It is never part
/// of device preferences, and cannot mint a new capability permit.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentStream {
    permit: Permit,
    chain: String,
    playback_session: String,
    track: Value,
}

impl CurrentStream {
    pub fn new(permit: Permit, chain: u64, playback_session: String, track: Value) -> Self {
        Self {
            permit,
            chain: chain.to_string(),
            playback_session,
            track,
        }
    }
    pub fn matches(&self, permit: &Permit, chain: u64) -> bool {
        self.chain == chain.to_string() && &self.permit == permit
    }
    fn valid(&self) -> bool {
        self.chain.parse::<u64>().is_ok_and(|v| v > 0)
            && !self.playback_session.is_empty()
            && self.playback_session.len() <= 128
            && self.track["platform"]
                .as_str()
                .is_some_and(|v| !v.is_empty() && v != "__local_library__")
            && self.track.as_object().is_some_and(|value| value.len() == 2)
            && (self.track["id"].is_string() || self.track["id"].is_number())
    }
    fn presentation(&self) -> Value {
        json!({"playbackSession":self.playback_session,"track":self.track})
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Transition {
    Unlock {
        confirmed: bool,
    },
    Switch {
        mode: Mode,
    },
    Startup {
        mode: StartupMode,
    },
    Relock {},
    ContinueStream {
        stream: CurrentStream,
    },
    ContinueTasks {
        stream: Option<CurrentStream>,
        downloads: Vec<CurrentDownload>,
    },
}

#[derive(Clone, Debug)]
pub struct Workspace {
    session: u64,
    preferences: Preferences,
    active: Mode,
    ready: bool,
    faulted: bool,
    activation_pending: bool,
    recovered_invalid_preferences: bool,
    revision: u64,
    epoch: u64,
    current_stream: Option<CurrentStream>,
    current_downloads: Vec<CurrentDownload>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            session: NEXT_SESSION
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                    value.checked_add(1)
                })
                .expect("workspace session space exhausted"),
            preferences: Preferences::default(),
            active: Mode::Local,
            ready: false,
            faulted: false,
            activation_pending: false,
            recovered_invalid_preferences: false,
            revision: 0,
            epoch: 0,
            current_stream: None,
            current_downloads: Vec::new(),
        }
    }
}

impl Workspace {
    pub fn snapshot(&self) -> Value {
        json!({
            "ready": self.ready,
            "faulted": self.faulted,
            "activationPending": self.activation_pending,
            "preferences": self.preferences,
            "activeMode": self.active,
            "startupTarget": self.startup_target(),
            "revision": self.revision.to_string(),
            "epoch": self.epoch.to_string(),
            "networkAllowed": self.network_allowed(),
            "currentStream": self.current_stream.as_ref().map(CurrentStream::presentation),
            "currentDownloads": self.current_downloads.iter().map(CurrentDownload::presentation).collect::<Vec<_>>(),
            "recoveredInvalidPreferences": self.recovered_invalid_preferences,
        })
    }

    /// Device startup intent is independent of policy-first bootstrap parking.
    fn startup_target(&self) -> Mode {
        match self.preferences.startup_mode {
            StartupMode::Local => Mode::Local,
            StartupMode::Online => Mode::Online,
            StartupMode::RememberLast => self.preferences.last_mode,
        }
    }

    pub fn network_allowed(&self) -> bool {
        !self.faulted
            && !self.activation_pending
            && self.ready
            && self.preferences.online_unlocked
            && self.active == Mode::Online
    }

    /// Irreversible for this engine session, without touching device preferences.
    /// No fallible revision/epoch increment: even exhausted counters fail closed.
    pub fn fault(&mut self) -> Value {
        self.faulted = true;
        self.current_stream = None;
        self.current_downloads.clear();
        self.snapshot()
    }

    /// Restore intent without admitting requests until the device owner
    /// acknowledges a successful durable write.
    pub fn restore_deferred(&mut self, raw: Value) -> Result<Value, String> {
        self.restore(raw)?;
        self.activation_pending = true;
        Ok(self.snapshot())
    }

    /// Keep original device preferences while the application initializes its
    /// owners and restores local playback. No network capability is admitted.
    pub fn restore_local_deferred(&mut self, raw: Value) -> Result<Value, String> {
        self.restore_deferred(raw)?;
        self.active = Mode::Local;
        Ok(self.snapshot())
    }

    pub fn activate_restored(&mut self, revision: &str) -> Result<Value, String> {
        if self.faulted {
            return Err("workspace_faulted".into());
        }
        if !self.ready {
            return Err("workspace_not_restored".into());
        }
        if revision != self.revision.to_string() {
            return Err("workspace_stale_revision".into());
        }
        self.activation_pending = false;
        Ok(self.snapshot())
    }

    /// Exactly once per engine; only the device preference store may supply
    /// this input. Ordinary library backup imports must never call restore.
    pub fn restore(&mut self, raw: Value) -> Result<Value, String> {
        if self.faulted {
            return Err("workspace_faulted".into());
        }
        if self.ready {
            return Err("workspace_already_restored".into());
        }
        let (preferences, recovered) = if raw.is_null() {
            (Preferences::default(), false)
        } else {
            match serde_json::from_value::<Preferences>(raw) {
                Ok(prefs) if prefs.valid() => (prefs, false),
                _ => (Preferences::default(), true),
            }
        };
        self.active = match preferences.startup_mode {
            StartupMode::Local => Mode::Local,
            StartupMode::Online => Mode::Online,
            StartupMode::RememberLast => preferences.last_mode,
        };
        self.preferences = preferences;
        self.recovered_invalid_preferences = recovered;
        self.ready = true;
        self.revision = 1;
        self.epoch = 1;
        Ok(self.snapshot())
    }

    fn proposed(&self, transition: Transition) -> Result<Self, String> {
        if self.faulted {
            return Err("workspace_faulted".into());
        }
        if !self.ready {
            return Err("workspace_not_restored".into());
        }
        if self.activation_pending {
            return Err("workspace_startup_not_acknowledged".into());
        }
        let mut next = self.clone();
        match transition {
            Transition::Unlock { confirmed: false } => {
                return Err("workspace_confirmation_required".into());
            }
            Transition::Unlock { confirmed: true } => {
                // First confirmation changes future startup, never the current session.
                if !self.preferences.online_unlocked {
                    next.preferences.startup_mode = StartupMode::Online;
                }
                next.preferences.online_unlocked = true;
            }
            Transition::Switch { mode } => {
                if mode == Mode::Online && !self.preferences.online_unlocked {
                    return Err("workspace_online_locked".into());
                }
                next.current_stream = None;
                next.current_downloads.clear();
                next.active = mode;
                next.preferences.last_mode = mode;
            }
            Transition::Startup { mode } => {
                if !self.preferences.online_unlocked && mode != StartupMode::Local {
                    return Err("workspace_online_locked".into());
                }
                next.preferences.startup_mode = mode;
            }
            Transition::Relock {} => {
                next.current_stream = None;
                next.current_downloads.clear();
                next.active = Mode::Local;
                next.preferences = Preferences::default();
            }
            Transition::ContinueStream { stream } => {
                if !stream.valid() || !self.permits(&stream.permit, NetworkCapability::Stream) {
                    return Err("workspace_current_stream_invalid".into());
                }
                next.active = Mode::Local;
                next.preferences.last_mode = Mode::Local;
                next.current_stream = Some(stream);
                next.current_downloads.clear();
            }
            Transition::ContinueTasks { stream, downloads } => {
                if stream.as_ref().is_some_and(|stream| {
                    !stream.valid() || !self.permits(&stream.permit, NetworkCapability::Stream)
                }) {
                    return Err("workspace_current_stream_invalid".into());
                }
                self.validate_downloads(&downloads, stream.is_some())?;
                next.active = Mode::Local;
                next.preferences.last_mode = Mode::Local;
                next.current_stream = stream;
                next.current_downloads = downloads;
            }
        }
        if next.preferences != self.preferences
            || next.active != self.active
            || next.current_stream != self.current_stream
            || next.current_downloads != self.current_downloads
        {
            next.revision = self
                .revision
                .checked_add(1)
                .ok_or("workspace_revision_exhausted")?;
        }
        if next.active != self.active
            || next.preferences.online_unlocked != self.preferences.online_unlocked
        {
            next.epoch = self
                .epoch
                .checked_add(1)
                .ok_or("workspace_epoch_exhausted")?;
        }
        Ok(next)
    }

    pub fn prepare(&self, transition: Transition) -> Result<Value, String> {
        Ok(self.proposed(transition)?.snapshot())
    }

    pub fn commit(&mut self, revision: &str, transition: Transition) -> Result<Value, String> {
        if revision != self.revision.to_string() {
            return Err("workspace_stale_revision".into());
        }
        *self = self.proposed(transition)?;
        Ok(self.snapshot())
    }

    pub fn permit(&self, capability: NetworkCapability) -> Result<Permit, String> {
        if !self.network_allowed() {
            return Err("workspace_network_disabled".into());
        }
        Ok(Permit {
            epoch: self.epoch.to_string(),
            session: self.session.to_string(),
            capability,
        })
    }

    /// Only existing native requests/followups may consult this exception.
    /// General permit acquisition and checks remain disabled in local mode.
    pub fn permits_chain(
        &self,
        permit: &Permit,
        capability: NetworkCapability,
        chain: u64,
    ) -> bool {
        self.permits(permit, capability)
            || (!self.faulted
                && self.ready
                && !self.activation_pending
                && self.preferences.online_unlocked
                && self.active == Mode::Local
                && ((capability == NetworkCapability::Stream
                    && permit.capability == NetworkCapability::Stream
                    && self
                        .current_stream
                        .as_ref()
                        .is_some_and(|stream| stream.matches(permit, chain)))
                    || (capability == NetworkCapability::Download
                        && permit.capability == NetworkCapability::Download
                        && self
                            .current_downloads
                            .iter()
                            .any(|download| download.matches(permit, chain)))))
    }

    pub fn release_stream(&mut self, playback_session: &str) -> Result<Value, String> {
        if self
            .current_stream
            .as_ref()
            .is_some_and(|stream| stream.playback_session == playback_session)
        {
            // Exhaustion must not leave an exception active.
            self.current_stream = None;
            self.revision = self.revision.checked_add(1).ok_or_else(|| {
                self.fault();
                "workspace_revision_exhausted".to_owned()
            })?;
        }
        Ok(self.snapshot())
    }

    pub fn permits(&self, permit: &Permit, capability: NetworkCapability) -> bool {
        self.network_allowed()
            && permit.session == self.session.to_string()
            && permit.epoch == self.epoch.to_string()
            && permit.capability == capability
    }
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Snapshot {},
    ReleaseStream {
        #[serde(rename = "playbackSession")]
        playback_session: String,
    },
    ReleaseDownload {
        #[serde(rename = "taskId")]
        task_id: String,
        generation: String,
    },
    Fault {},
    Restore {
        preferences: Value,
    },
    RestoreDeferred {
        preferences: Value,
    },
    RestoreLocalDeferred {
        preferences: Value,
    },
    ActivateRestored {
        revision: String,
    },
    Prepare {
        transition: Transition,
    },
    Commit {
        revision: String,
        transition: Transition,
    },
    Permit {
        capability: NetworkCapability,
    },
    Check {
        permit: Permit,
        capability: NetworkCapability,
    },
}

impl Workspace {
    /// Versioned protocol carried by the existing baka_call ABI.
    pub fn command(&mut self, value: Value) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Envelope {
            version: u8,
            command: Command,
        }
        let envelope: Envelope =
            serde_json::from_value(value).map_err(|_| "workspace_invalid_command".to_string())?;
        if envelope.version != 1 {
            return Err("workspace_unsupported_version".into());
        }
        match envelope.command {
            Command::Snapshot {} => Ok(self.snapshot()),
            Command::ReleaseStream { playback_session } => self.release_stream(&playback_session),
            Command::ReleaseDownload {
                task_id,
                generation,
            } => self.release_download(&task_id, &generation),
            Command::Fault {} => Ok(self.fault()),
            Command::Restore { preferences } => self.restore(preferences),
            Command::RestoreDeferred { preferences } => self.restore_deferred(preferences),
            Command::RestoreLocalDeferred { preferences } => {
                self.restore_local_deferred(preferences)
            }
            Command::ActivateRestored { revision } => self.activate_restored(&revision),
            Command::Prepare { transition } => self.prepare(transition),
            Command::Commit {
                revision,
                transition,
            } => self.commit(&revision, transition),
            Command::Permit { capability } => Ok(json!(self.permit(capability)?)),
            Command::Check { permit, capability } => Ok(json!(self.permits(&permit, capability))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> Workspace {
        let mut state = Workspace::default();
        state.restore(Value::Null).unwrap();
        state
    }
    fn apply(state: &mut Workspace, event: Transition) -> Value {
        state.commit(&state.revision.to_string(), event).unwrap()
    }
    fn online() -> Workspace {
        let mut state = local();
        apply(&mut state, Transition::Unlock { confirmed: true });
        apply(&mut state, Transition::Switch { mode: Mode::Online });
        state
    }

    #[test]
    fn before_restore_and_first_install_are_closed() {
        let mut state = Workspace::default();
        assert!(!state.network_allowed());
        assert!(
            state
                .prepare(Transition::Unlock { confirmed: true })
                .is_err()
        );
        state.restore(Value::Null).unwrap();
        assert_eq!(state.active, Mode::Local);
        assert!(!state.network_allowed());
        assert!(state.permit(NetworkCapability::Artwork).is_err());
    }

    #[test]
    fn unlocking_requires_confirmation_and_does_not_enter_online() {
        let mut state = local();
        assert!(
            state
                .prepare(Transition::Unlock { confirmed: false })
                .is_err()
        );
        assert!(
            state
                .prepare(Transition::Switch { mode: Mode::Online })
                .is_err()
        );
        apply(&mut state, Transition::Unlock { confirmed: true });
        assert!(state.preferences.online_unlocked);
        assert!(!state.network_allowed());
    }

    #[test]
    fn prepare_is_side_effect_free_and_commit_is_revision_checked() {
        let mut state = local();
        let before = state.snapshot();
        let event = Transition::Unlock { confirmed: true };
        let prepared = state.prepare(event.clone()).unwrap();
        assert_eq!(state.snapshot(), before);
        assert_eq!(apply(&mut state, event.clone()), prepared);
        assert!(state.commit("1", event).is_err());
        assert_eq!(state.snapshot(), prepared);
    }

    #[test]
    fn same_mode_is_idempotent() {
        let mut state = online();
        let before = state.snapshot();
        apply(&mut state, Transition::Switch { mode: Mode::Online });
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn explicitly_local_startup_still_overrides_last_online_mode() {
        let mut state = online();
        apply(
            &mut state,
            Transition::Startup {
                mode: StartupMode::Local,
            },
        );
        let mut cold = Workspace::default();
        cold.restore(json!(state.preferences)).unwrap();
        assert!(cold.preferences.online_unlocked);
        assert_eq!(cold.active, Mode::Local);
        assert!(!cold.network_allowed());
    }

    #[test]
    fn first_unlock_defaults_future_starts_online_independently_of_switches() {
        let mut state = local();
        apply(&mut state, Transition::Unlock { confirmed: true });
        assert_eq!(state.preferences.startup_mode, StartupMode::Online);
        assert_eq!(state.active, Mode::Local);
        assert!(!state.network_allowed());
        apply(&mut state, Transition::Switch { mode: Mode::Online });
        apply(&mut state, Transition::Switch { mode: Mode::Local });
        let mut cold = Workspace::default();
        cold.restore_local_deferred(json!(state.preferences))
            .unwrap();
        assert_eq!(cold.startup_target(), Mode::Online);
        assert_eq!(cold.active, Mode::Local);
        assert!(!cold.network_allowed());
        // Repeated confirmation must not overwrite an explicit preference.
        apply(
            &mut state,
            Transition::Startup {
                mode: StartupMode::RememberLast,
            },
        );
        apply(&mut state, Transition::Unlock { confirmed: true });
        assert_eq!(state.preferences.startup_mode, StartupMode::RememberLast);
    }

    #[test]
    fn remember_last_is_explicit_and_retains_unlock() {
        let mut state = online();
        apply(
            &mut state,
            Transition::Startup {
                mode: StartupMode::RememberLast,
            },
        );
        let mut cold = Workspace::default();
        cold.restore(json!(state.preferences)).unwrap();
        assert_eq!(cold.active, Mode::Online);
        assert!(cold.network_allowed());
    }

    #[test]
    fn local_invalidates_permits_and_returning_online_does_not_revive_them() {
        let mut state = online();
        let ticket = state.permit(NetworkCapability::Plugin).unwrap();
        assert!(state.permits(&ticket, NetworkCapability::Plugin));
        apply(&mut state, Transition::Switch { mode: Mode::Local });
        assert!(!state.permits(&ticket, NetworkCapability::Plugin));
        apply(&mut state, Transition::Switch { mode: Mode::Online });
        assert!(!state.permits(&ticket, NetworkCapability::Plugin));
    }

    #[test]
    fn permits_are_scoped_to_capability() {
        let state = online();
        let ticket = state.permit(NetworkCapability::Stream).unwrap();
        assert!(!state.permits(&ticket, NetworkCapability::Update));
        assert!(!online().permits(&ticket, NetworkCapability::Stream));
    }

    #[test]
    fn startup_preference_does_not_interrupt_current_request() {
        let mut state = online();
        let ticket = state.permit(NetworkCapability::Download).unwrap();
        apply(
            &mut state,
            Transition::Startup {
                mode: StartupMode::RememberLast,
            },
        );
        assert!(state.permits(&ticket, NetworkCapability::Download));
    }

    #[test]
    fn relock_resets_preferences_and_invalidates_all_remote_work() {
        let mut state = online();
        let ticket = state.permit(NetworkCapability::Lyrics).unwrap();
        apply(&mut state, Transition::Relock {});
        assert_eq!(state.preferences, Preferences::default());
        assert!(!state.permits(&ticket, NetworkCapability::Lyrics));
        assert!(state.permit(NetworkCapability::Plugin).is_err());
        let before = state.snapshot();
        apply(&mut state, Transition::Relock {});
        assert_eq!(before, state.snapshot());
    }

    #[test]
    fn corrupt_future_and_inconsistent_preferences_recover_closed() {
        for value in [
            json!("corrupt"),
            json!({}),
            json!({"version": 2,"onlineUnlocked":true,"startupMode":"rememberLast","lastMode":"online"}),
            json!({"version": 1,"onlineUnlocked":false,"startupMode":"rememberLast","lastMode":"online"}),
            json!({"version": 1,"onlineUnlocked":true,"startupMode":"local","lastMode":"online","extra":true}),
        ] {
            let mut state = Workspace::default();
            state.restore(value).unwrap();
            assert!(state.recovered_invalid_preferences);
            assert_eq!(state.preferences, Preferences::default());
            assert!(!state.network_allowed());
        }
    }

    #[test]
    fn repeated_restore_cannot_overwrite_live_state() {
        let mut state = online();
        let before = state.snapshot();
        assert!(state.restore(Value::Null).is_err());
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn invalid_protocol_does_not_mutate_and_does_not_echo_input() {
        let mut state = local();
        let before = state.snapshot();
        for command in [
            json!({"op":"secret-token"}),
            json!({"version":1,"command":{"op":"snapshot","extra":true}}),
            json!({"version":2,"command":{"op":"snapshot"}}),
            json!({"version":1,"command":{"op":"commit","revision":1,"transition":{"type":"relock"}}}),
        ] {
            assert!(state.command(command).is_err());
            assert_eq!(state.snapshot(), before);
        }
    }

    #[test]
    fn revision_and_epoch_exhaustion_are_atomic() {
        let mut state = online();
        state.revision = u64::MAX;
        let before = state.snapshot();
        assert!(
            state
                .commit(&u64::MAX.to_string(), Transition::Relock {})
                .is_err()
        );
        assert_eq!(state.snapshot(), before);
        state.revision = 3;
        state.epoch = u64::MAX;
        let before = state.snapshot();
        assert!(state.commit("3", Transition::Relock {}).is_err());
        assert_eq!(state.snapshot(), before);
    }

    #[test]
    fn deferred_restore_requires_revision_ack_before_online_admission() {
        let mut state = Workspace::default();
        assert!(state.activate_restored("0").is_err());
        let preferences = json!({"version":1,"onlineUnlocked":true,
            "startupMode":"rememberLast","lastMode":"online"});
        let pending = state.restore_deferred(preferences.clone()).unwrap();
        assert_eq!(pending["activeMode"], "online");
        assert_eq!(pending["activationPending"], true);
        assert!(!state.network_allowed());
        assert!(state.permit(NetworkCapability::Plugin).is_err());
        assert!(
            state
                .prepare(Transition::Switch { mode: Mode::Online })
                .is_err()
        );
        assert!(state.activate_restored("0").is_err());
        assert_eq!(state.snapshot(), pending);
        state.activate_restored("1").unwrap();
        assert!(state.network_allowed());
        let ticket = state.permit(NetworkCapability::Plugin).unwrap();
        state.activate_restored("1").unwrap();
        assert!(state.permits(&ticket, NetworkCapability::Plugin));
        assert_eq!(state.snapshot()["preferences"], preferences);
        state.fault();
        assert!(state.activate_restored("1").is_err());
    }

    #[test]
    fn deferred_corrupt_preferences_remain_local_after_ack() {
        let mut state = Workspace::default();
        let snapshot = state
            .command(json!({"version":1,"command":{
            "op":"restoreDeferred","preferences":{"version":99}}}))
            .unwrap();
        assert_eq!(snapshot["recoveredInvalidPreferences"], true);
        state
            .command(json!({"version":1,"command":{
            "op":"activateRestored","revision":"1"}}))
            .unwrap();
        assert!(!state.network_allowed());
        assert_eq!(state.snapshot()["activationPending"], false);
    }

    #[test]
    fn fault_is_sticky_idempotent_and_preserves_preferences() {
        let mut state = online();
        let ticket = state.permit(NetworkCapability::Plugin).unwrap();
        let before = state.snapshot();
        state.epoch = u64::MAX;
        state.revision = u64::MAX;
        let faulted = state.fault();
        assert_eq!(faulted["faulted"], true);
        assert_eq!(faulted["networkAllowed"], false);
        assert_eq!(faulted["preferences"], before["preferences"]);
        assert!(!state.permits(&ticket, NetworkCapability::Plugin));
        assert!(state.permit(NetworkCapability::Plugin).is_err());
        assert_eq!(state.fault(), faulted);
        for transition in [
            Transition::Switch { mode: Mode::Online },
            Transition::Relock {},
        ] {
            assert!(state.prepare(transition.clone()).is_err());
            assert!(state.commit(&u64::MAX.to_string(), transition).is_err());
        }
        let mut fresh = Workspace::default();
        fresh.restore(before["preferences"].clone()).unwrap();
        assert_eq!(fresh.snapshot()["faulted"], false);
    }

    #[test]
    fn fault_before_restore_stays_closed_and_protocol_is_strict() {
        let mut state = Workspace::default();
        assert!(
            state
                .command(json!({"version":1,"command":{"op":"fault","extra":true}}))
                .is_err()
        );
        assert_eq!(state.snapshot()["faulted"], false);
        state
            .command(json!({"version":1,"command":{"op":"fault"}}))
            .unwrap();
        assert!(state.restore(Value::Null).is_err());
        assert!(!state.network_allowed());
    }

    #[test]
    fn json_protocol_round_trip() {
        let mut state = online();
        let ticket = state
            .command(json!({"version":1,"command":{"op":"permit","capability":"artwork"}}))
            .unwrap();
        assert_eq!(state.command(json!({"version":1,"command":{"op":"check","capability":"artwork","permit":ticket}})).unwrap(), true);
    }
    #[test]
    fn current_stream_is_volatile_exactly_scoped_and_never_a_new_permit() {
        let mut state = online();
        let permit = state.permit(NetworkCapability::Stream).unwrap();
        let stream = CurrentStream::new(
            permit.clone(),
            7,
            "player-1".into(),
            json!({"platform":"test","id":3}),
        );
        let event = Transition::ContinueStream { stream };
        let prepared = state.prepare(event.clone()).unwrap();
        assert_eq!(state.snapshot()["currentStream"], Value::Null);
        assert_eq!(prepared["networkAllowed"], false);
        assert_eq!(prepared["activeMode"], "local");
        assert!(prepared["preferences"].get("currentStream").is_none());
        assert!(prepared["currentStream"].get("permit").is_none());
        apply(&mut state, event);
        assert!(!state.network_allowed());
        assert!(state.permit(NetworkCapability::Stream).is_err());
        assert!(!state.permits(&permit, NetworkCapability::Stream));
        assert!(state.permits_chain(&permit, NetworkCapability::Stream, 7));
        assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 8));
        assert!(!state.permits_chain(&permit, NetworkCapability::Artwork, 7));
        state.release_stream("late-other-player").unwrap();
        assert!(state.permits_chain(&permit, NetworkCapability::Stream, 7));
        state.release_stream("player-1").unwrap();
        assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 7));
        apply(&mut state, Transition::Switch { mode: Mode::Online });
        assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 7));
    }

    #[test]
    fn every_exit_or_same_local_pause_clears_current_stream() {
        for exit in [
            Transition::Switch { mode: Mode::Local },
            Transition::Switch { mode: Mode::Online },
            Transition::Relock {},
        ] {
            let mut state = online();
            let permit = state.permit(NetworkCapability::Stream).unwrap();
            apply(
                &mut state,
                Transition::ContinueStream {
                    stream: CurrentStream::new(
                        permit.clone(),
                        1,
                        "p".into(),
                        json!({"platform":"test","id":"track"}),
                    ),
                },
            );
            let revision = state.snapshot()["revision"].clone();
            apply(&mut state, exit);
            assert_eq!(state.snapshot()["currentStream"], Value::Null);
            assert_ne!(state.snapshot()["revision"], revision);
            assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 1));
        }
        let mut state = online();
        let permit = state.permit(NetworkCapability::Stream).unwrap();
        apply(
            &mut state,
            Transition::ContinueStream {
                stream: CurrentStream::new(
                    permit.clone(),
                    1,
                    "p".into(),
                    json!({"platform":"test","id":1}),
                ),
            },
        );
        state.fault();
        assert_eq!(state.snapshot()["currentStream"], Value::Null);
        assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 1));
    }

    #[test]
    fn stream_release_counter_exhaustion_still_closes_the_exception() {
        let mut state = online();
        let permit = state.permit(NetworkCapability::Stream).unwrap();
        apply(
            &mut state,
            Transition::ContinueStream {
                stream: CurrentStream::new(
                    permit.clone(),
                    1,
                    "p".into(),
                    json!({"platform":"test","id":1}),
                ),
            },
        );
        state.revision = u64::MAX;
        assert!(state.release_stream("p").is_err());
        assert!(state.snapshot()["faulted"].as_bool().unwrap());
        assert!(!state.permits_chain(&permit, NetworkCapability::Stream, 1));
    }
}

#[cfg(test)]
#[path = "workspace_bootstrap_tests.rs"]
mod bootstrap_tests;
