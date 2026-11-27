//! Volatile, task-scoped download exceptions. Never serialized as preferences.
use super::{NetworkCapability, Permit, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentDownload {
    permit: Permit,
    chain: String,
    task_id: String,
    generation: String,
}

impl CurrentDownload {
    pub fn new(permit: Permit, chain: u64, task_id: String, generation: u64) -> Self {
        Self {
            permit,
            chain: chain.to_string(),
            task_id,
            generation: generation.to_string(),
        }
    }
    pub fn valid_task_id(task_id: &str) -> bool {
        !task_id.is_empty()
            && task_id.len() <= 128
            && task_id.trim() == task_id
            && !task_id.chars().any(char::is_control)
    }
    pub fn matches(&self, permit: &Permit, chain: u64) -> bool {
        self.chain == chain.to_string() && &self.permit == permit
    }
    fn valid(&self) -> bool {
        Self::valid_task_id(&self.task_id)
            && self
                .chain
                .parse::<u64>()
                .is_ok_and(|value| value > 0 && self.chain == value.to_string())
            && self
                .generation
                .parse::<u64>()
                .is_ok_and(|value| self.generation == value.to_string())
    }
    pub(super) fn presentation(&self) -> Value {
        json!({"taskId":self.task_id,"generation":self.generation})
    }
    pub fn identity(&self) -> (&str, &str) {
        (&self.task_id, &self.generation)
    }
}

impl Workspace {
    pub(super) fn validate_downloads(
        &self,
        downloads: &[CurrentDownload],
        has_stream: bool,
    ) -> Result<(), String> {
        if (downloads.is_empty() && !has_stream) || downloads.len() > 128 {
            return Err("workspace_current_download_invalid".into());
        }
        let mut tasks = HashSet::new();
        let mut chains = HashSet::new();
        for download in downloads {
            if !download.valid()
                || !self.permits(&download.permit, NetworkCapability::Download)
                || !tasks.insert(&download.task_id)
                || !chains.insert(&download.chain)
            {
                return Err("workspace_current_download_invalid".into());
            }
        }
        Ok(())
    }

    pub fn release_download(&mut self, task_id: &str, generation: &str) -> Result<Value, String> {
        let previous = self.current_downloads.len();
        self.current_downloads
            .retain(|download| download.task_id != task_id || download.generation != generation);
        if previous != self.current_downloads.len() {
            self.revision = self.revision.checked_add(1).ok_or_else(|| {
                self.fault();
                "workspace_revision_exhausted".to_owned()
            })?;
        }
        Ok(self.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{Mode, Transition};
    fn online() -> (Workspace, Permit) {
        let mut state = Workspace::default();
        state.restore(Value::Null).unwrap();
        for event in [
            Transition::Unlock { confirmed: true },
            Transition::Switch { mode: Mode::Online },
        ] {
            state.commit(&state.revision.to_string(), event).unwrap();
        }
        let permit = state.permit(NetworkCapability::Download).unwrap();
        (state, permit)
    }
    fn retain(state: &mut Workspace, downloads: Vec<CurrentDownload>) -> Result<Value, String> {
        state.commit(
            &state.revision.to_string(),
            Transition::ContinueTasks {
                stream: None,
                downloads,
            },
        )
    }
    #[test]
    fn selection_is_volatile_scoped_and_never_mints_a_local_permit() {
        let (mut state, permit) = online();
        let task = CurrentDownload::new(permit.clone(), 9, "first".into(), 0);
        let snapshot = retain(&mut state, vec![task]).unwrap();
        assert_eq!(
            snapshot["currentDownloads"],
            json!([{"taskId":"first","generation":"0"}])
        );
        assert!(!state.permits(&permit, NetworkCapability::Download));
        assert!(state.permits_chain(&permit, NetworkCapability::Download, 9));
        assert!(!state.permits_chain(&permit, NetworkCapability::Download, 10));
        assert!(!state.permits_chain(&permit, NetworkCapability::Plugin, 9));
        assert!(state.permit(NetworkCapability::Download).is_err());
        let mut restarted = Workspace::default();
        let restored = restarted.restore(snapshot["preferences"].clone()).unwrap();
        assert_eq!(restored["activeMode"], "online");
        assert_eq!(restored["currentDownloads"], json!([]));
        assert!(!restarted.permits_chain(&permit, NetworkCapability::Download, 9));
        let revision = state.revision;
        state.release_download("first", "1").unwrap();
        assert_eq!(state.revision, revision);
        state.release_download("first", "0").unwrap();
        assert_eq!(state.revision, revision + 1);
        assert!(!state.permits_chain(&permit, NetworkCapability::Download, 9));
    }
    #[test]
    fn invalid_or_duplicate_selection_does_not_mutate_policy() {
        let (mut state, permit) = online();
        let task = CurrentDownload::new(permit.clone(), 1, "first".into(), 1);
        let before = state.snapshot();
        for downloads in [
            vec![],
            vec![task.clone(), task.clone()],
            vec![
                task.clone(),
                CurrentDownload::new(permit.clone(), 2, "first".into(), 2),
            ],
            vec![
                task.clone(),
                CurrentDownload::new(permit.clone(), 1, "second".into(), 1),
            ],
            vec![CurrentDownload::new(permit.clone(), 0, "first".into(), 1)],
            vec![CurrentDownload::new(permit.clone(), 2, " ".into(), 1)],
            vec![task; 129],
        ] {
            assert!(retain(&mut state, downloads).is_err());
            assert_eq!(state.snapshot(), before);
        }
        let plugin = state.permit(NetworkCapability::Plugin).unwrap();
        assert!(
            retain(
                &mut state,
                vec![CurrentDownload::new(plugin, 2, "first".into(), 1)]
            )
            .is_err()
        );
        assert_eq!(state.snapshot(), before);
    }
    #[test]
    fn malformed_generation_and_descriptor_fields_are_rejected() {
        let (mut state, permit) = online();
        let task =
            serde_json::to_value(CurrentDownload::new(permit, 1, "first".into(), 1)).unwrap();
        for generation in [
            json!(1),
            json!("01"),
            json!("-1"),
            json!("18446744073709551616"),
        ] {
            let mut input = task.clone();
            input["generation"] = generation;
            assert!(
                state
                    .command(json!({"version":1,"command":{"op":"prepare","transition":{
                "type":"continueTasks","downloads":[input]}}}))
                    .is_err()
            );
        }
        let mut extra = task;
        extra["url"] = json!("https://unused.invalid/");
        assert!(
            state
                .command(json!({"version":1,"command":{"op":"prepare","transition":{
            "type":"continueTasks","downloads":[extra]}}}))
                .is_err()
        );
    }
    #[test]
    fn stream_release_counter_exhaustion_also_clears_retained_downloads() {
        let (mut state, permit) = online();
        let stream_permit = state.permit(NetworkCapability::Stream).unwrap();
        let stream = super::super::CurrentStream::new(
            stream_permit,
            3,
            "player".into(),
            json!({"platform":"test","id":1}),
        );
        state
            .commit(
                &state.revision.to_string(),
                Transition::ContinueTasks {
                    stream: Some(stream),
                    downloads: vec![CurrentDownload::new(permit.clone(), 1, "first".into(), 1)],
                },
            )
            .unwrap();
        state.revision = u64::MAX;
        assert_eq!(
            state.release_stream("player").unwrap_err(),
            "workspace_revision_exhausted"
        );
        assert_eq!(state.snapshot()["faulted"], true);
        assert_eq!(state.snapshot()["currentDownloads"], json!([]));
        assert_eq!(state.snapshot()["currentStream"], Value::Null);
        assert!(!state.permits_chain(&permit, NetworkCapability::Download, 1));
    }
    #[test]
    fn release_counter_exhaustion_faults_and_clears_every_exception() {
        let (mut state, permit) = online();
        retain(
            &mut state,
            vec![
                CurrentDownload::new(permit.clone(), 1, "first".into(), 1),
                CurrentDownload::new(permit.clone(), 2, "second".into(), 1),
            ],
        )
        .unwrap();
        state.revision = u64::MAX;
        assert_eq!(
            state.release_download("first", "1").unwrap_err(),
            "workspace_revision_exhausted"
        );
        assert_eq!(state.snapshot()["faulted"], true);
        assert_eq!(state.snapshot()["currentDownloads"], json!([]));
        assert!(!state.permits_chain(&permit, NetworkCapability::Download, 2));
    }
}
