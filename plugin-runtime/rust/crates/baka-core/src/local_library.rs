//! Pure local import policy. The storage owner persists each plan and its cursor
//! atomically, then acknowledges it. This module never enumerates or opens files.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_BATCH_SIZE: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    /// Opaque source-relative locator, including content URIs. Never normalize
    /// case, separators or percent escapes here; that belongs to the adapter.
    pub locator: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub track_id: String,
    pub source_id: String,
    pub observed: Observation,
    pub available: bool,
    pub metadata_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AssetChange {
    Insert {
        asset: Asset,
    },
    /// Update technical observations only. Do not replace tags, user overrides,
    /// favourites, cue tracks or collection membership with scan results.
    Refresh {
        asset_id: String,
        observed: Observation,
        metadata_stale: bool,
    },
    Seen {
        asset_id: String,
    },
}

/// UUIDs are allocated by the future storage adapter, not derived from paths.
/// Matching is strictly source + opaque locator. Moves/duplicates require a
/// separate confirmed relink transaction, never title/artist heuristics.
pub fn reconcile(
    source_id: &str,
    observed: Observation,
    existing: Option<&Asset>,
    fresh_asset_id: &str,
    fresh_track_id: &str,
) -> Result<AssetChange, ImportError> {
    if source_id.trim().is_empty() || observed.locator.trim().is_empty() {
        return Err(ImportError::InvalidInput);
    }
    if let Some(asset) = existing {
        if asset.source_id != source_id || asset.observed.locator != observed.locator {
            return Err(ImportError::IdentityMismatch);
        }
        if asset.id.trim().is_empty() || asset.track_id.trim().is_empty() {
            return Err(ImportError::InvalidInput);
        }
        let changed = asset.observed != observed;
        return Ok(if changed || !asset.available {
            AssetChange::Refresh {
                asset_id: asset.id.clone(),
                observed,
                // Missing mtime cannot prove unchanged content, even at equal size.
                metadata_stale: changed || asset.observed.modified_ms.is_none(),
            }
        } else if observed.modified_ms.is_none() {
            AssetChange::Refresh {
                asset_id: asset.id.clone(),
                observed,
                metadata_stale: true,
            }
        } else {
            AssetChange::Seen {
                asset_id: asset.id.clone(),
            }
        });
    }
    if fresh_asset_id.trim().is_empty()
        || fresh_track_id.trim().is_empty()
        || fresh_asset_id == fresh_track_id
    {
        return Err(ImportError::InvalidInput);
    }
    Ok(AssetChange::Insert {
        asset: Asset {
            id: fresh_asset_id.to_owned(),
            track_id: fresh_track_id.to_owned(),
            source_id: source_id.to_owned(),
            observed,
            available: true,
            metadata_revision: 0,
        },
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanState {
    Running,
    Paused,
    Cancelled,
    Complete,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ImportError {
    #[error("local_import_invalid_input")]
    InvalidInput,
    #[error("local_import_identity_mismatch")]
    IdentityMismatch,
    #[error("local_import_stale_generation")]
    StaleGeneration,
    #[error("local_import_not_running")]
    NotRunning,
    #[error("local_import_batch_pending")]
    BatchPending,
    #[error("local_import_cursor_mismatch")]
    CursorMismatch,
    #[error("local_import_counter_exhausted")]
    CounterExhausted,
}

/// A prepared batch is immutable. The owner must persist observations plus
/// source/generation/sequence in one transaction before calling `acknowledge`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    source_id: String,
    generation: u64,
    sequence: u64,
    observations: Vec<Observation>,
    enumeration_complete: bool,
}
impl Batch {
    pub fn source_id(&self) -> &str {
        &self.source_id
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn observations(&self) -> &[Observation] {
        &self.observations
    }
    /// Only the final successfully persisted batch establishes unseen assets.
    /// Storage marks generic observations missing or prunes directory records;
    /// neither operation permits deleting physical files.
    pub fn marks_unseen_missing(&self) -> bool {
        self.enumeration_complete
    }
}

/// One coordinator per source, owned by the single Rust storage writer.
/// Generation must come from a durable monotonic source counter; do not reset
/// it when reopening the app. Permission failure is not successful enumeration.
#[derive(Debug)]
pub struct Scan {
    source_id: String,
    generation: u64,
    sequence: u64,
    committed: u64,
    state: ScanState,
    pending: Option<Batch>,
}
impl Scan {
    pub fn start(source_id: String, generation: u64) -> Result<Self, ImportError> {
        if source_id.trim().is_empty() || generation == 0 {
            return Err(ImportError::InvalidInput);
        }
        Ok(Self {
            source_id,
            generation,
            sequence: 0,
            committed: 0,
            state: ScanState::Running,
            pending: None,
        })
    }
    /// Reconstruct only acknowledged progress from the storage transaction.
    /// Pending batches are deliberately not restored. The storage owner checks
    /// durable lifecycle state before using this running coordinator.
    pub fn from_checkpoint(
        source_id: String,
        generation: u64,
        sequence: u64,
        committed: u64,
    ) -> Result<Self, ImportError> {
        let mut scan = Self::start(source_id, generation)?;
        if sequence == 0 && committed != 0 {
            return Err(ImportError::InvalidInput);
        }
        scan.sequence = sequence;
        scan.committed = committed;
        Ok(scan)
    }

    pub fn state(&self) -> ScanState {
        self.state
    }
    /// Number of committed observations, not a unique asset count.
    pub fn committed(&self) -> u64 {
        self.committed
    }
    pub fn pending(&self) -> Option<&Batch> {
        self.pending.as_ref()
    }

    pub fn prepare(
        &mut self,
        generation: u64,
        sequence: u64,
        observations: Vec<Observation>,
        enumeration_complete: bool,
    ) -> Result<Batch, ImportError> {
        if observations.is_empty() && !enumeration_complete {
            self.check_generation(generation)?;
            if self.state != ScanState::Running {
                return Err(ImportError::NotRunning);
            }
            return Err(ImportError::InvalidInput);
        }
        self.prepare_directory(generation, sequence, observations, enumeration_complete)
    }

    /// A bounded directory cursor may advance through only non-media entries.
    /// This acknowledges progress, never successful enumeration or missing assets.
    pub fn prepare_directory(
        &mut self,
        generation: u64,
        sequence: u64,
        observations: Vec<Observation>,
        enumeration_complete: bool,
    ) -> Result<Batch, ImportError> {
        self.check_generation(generation)?;
        if self.state != ScanState::Running {
            return Err(ImportError::NotRunning);
        }
        let batch = Batch {
            source_id: self.source_id.clone(),
            generation,
            sequence,
            observations,
            enumeration_complete,
        };
        if let Some(pending) = &self.pending {
            return if *pending == batch {
                Ok(pending.clone())
            } else {
                Err(ImportError::BatchPending)
            };
        }
        if sequence != self.sequence {
            return Err(ImportError::CursorMismatch);
        }
        if batch.observations.len() > MAX_BATCH_SIZE {
            return Err(ImportError::InvalidInput);
        }
        let mut locators = HashSet::new();
        for item in &batch.observations {
            if item.locator.trim().is_empty() || !locators.insert(&item.locator) {
                return Err(ImportError::InvalidInput);
            }
        }
        self.sequence
            .checked_add(1)
            .ok_or(ImportError::CounterExhausted)?;
        self.committed
            .checked_add(batch.observations.len() as u64)
            .ok_or(ImportError::CounterExhausted)?;
        self.pending = Some(batch.clone());
        Ok(batch)
    }

    /// Revalidate immediately before the storage transaction. The writer must
    /// serialize this check, commit and acknowledgement with pause/cancel.
    pub fn validate(&self, batch: &Batch) -> Result<(), ImportError> {
        self.check_generation(batch.generation)?;
        if self.state != ScanState::Running {
            return Err(ImportError::NotRunning);
        }
        if self.pending.as_ref() != Some(batch) {
            return Err(ImportError::CursorMismatch);
        }
        Ok(())
    }
    pub fn acknowledge(&mut self, batch: &Batch) -> Result<(), ImportError> {
        self.validate(batch)?;
        self.sequence += 1;
        self.committed += batch.observations.len() as u64;
        self.pending = None;
        if batch.enumeration_complete {
            self.state = ScanState::Complete;
        }
        Ok(())
    }
    pub fn pause(&mut self) -> Result<(), ImportError> {
        if self.state != ScanState::Running {
            return Err(ImportError::NotRunning);
        }
        self.state = ScanState::Paused;
        Ok(())
    }
    pub fn resume(&mut self) -> Result<(), ImportError> {
        if self.state != ScanState::Paused {
            return Err(ImportError::NotRunning);
        }
        self.state = ScanState::Running;
        Ok(())
    }
    pub fn cancel(&mut self) {
        if matches!(self.state, ScanState::Running | ScanState::Paused) {
            self.pending = None;
            self.state = ScanState::Cancelled;
        }
    }
    pub fn fail(&mut self) {
        if matches!(self.state, ScanState::Running | ScanState::Paused) {
            self.pending = None;
            self.state = ScanState::Failed;
        }
    }
    fn check_generation(&self, generation: u64) -> Result<(), ImportError> {
        if generation != self.generation {
            Err(ImportError::StaleGeneration)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn observation(locator: &str) -> Observation {
        Observation {
            locator: locator.into(),
            size: 42,
            modified_ms: Some(100),
        }
    }
    fn asset() -> Asset {
        Asset {
            id: "asset-a".into(),
            track_id: "track-a".into(),
            source_id: "source-a".into(),
            observed: observation("content://provider/document/A%2FB"),
            available: true,
            metadata_revision: 12,
        }
    }
    fn scan() -> Scan {
        Scan::start("source-a".into(), 1).unwrap()
    }

    #[test]
    fn restored_checkpoint_continues_at_next_batch_without_pending_work() {
        let mut scan = Scan::from_checkpoint("source-a".into(), 7, 3, 42).unwrap();
        assert_eq!(scan.committed(), 42);
        assert!(scan.pending().is_none());
        assert_eq!(
            scan.prepare(7, 2, vec![observation("a")], false),
            Err(ImportError::CursorMismatch)
        );
        let batch = scan.prepare(7, 3, vec![observation("a")], true).unwrap();
        scan.acknowledge(&batch).unwrap();
        assert_eq!(scan.committed(), 43);
        assert_eq!(scan.state(), ScanState::Complete);
        assert!(Scan::from_checkpoint("source-a".into(), 7, 0, 1).is_err());
    }

    #[test]
    fn change_contract_serializes_field_names_consistently() {
        let change = AssetChange::Refresh {
            asset_id: "a".into(),
            observed: observation("content://opaque"),
            metadata_stale: true,
        };
        let value = serde_json::to_value(&change).unwrap();
        assert_eq!(value["kind"], "refresh");
        assert_eq!(value["assetId"], "a");
        assert_eq!(value["metadataStale"], true);
        assert_eq!(value["observed"]["modifiedMs"], 100);
        assert_eq!(
            serde_json::from_value::<AssetChange>(value).unwrap(),
            change
        );
    }

    #[test]
    fn repeated_scan_keeps_asset_and_track_identity() {
        let old = asset();
        assert_eq!(
            reconcile(
                "source-a",
                old.observed.clone(),
                Some(&old),
                "new",
                "new-track"
            )
            .unwrap(),
            AssetChange::Seen {
                asset_id: old.id.clone()
            }
        );
        assert_eq!(old.track_id, "track-a");
        assert_eq!(old.metadata_revision, 12);
    }

    #[test]
    fn changed_file_refreshes_observations_without_replacing_identity_or_tags() {
        let old = asset();
        let mut changed = old.observed.clone();
        changed.size += 1;
        assert_eq!(
            reconcile("source-a", changed.clone(), Some(&old), "", "").unwrap(),
            AssetChange::Refresh {
                asset_id: old.id.clone(),
                observed: changed,
                metadata_stale: true
            }
        );
        assert_eq!(old.metadata_revision, 12);
    }

    #[test]
    fn returning_asset_is_available_again_and_unknown_mtime_is_not_proof() {
        let mut old = asset();
        old.available = false;
        assert!(matches!(
            reconcile("source-a", old.observed.clone(), Some(&old), "", "").unwrap(),
            AssetChange::Refresh {
                metadata_stale: false,
                ..
            }
        ));
        old.available = true;
        old.observed.modified_ms = None;
        assert!(matches!(
            reconcile("source-a", old.observed.clone(), Some(&old), "", "").unwrap(),
            AssetChange::Refresh {
                metadata_stale: true,
                ..
            }
        ));
    }

    #[test]
    fn sources_and_opaque_locators_never_cross_match() {
        let old = asset();
        assert_eq!(
            reconcile("source-b", old.observed.clone(), Some(&old), "", ""),
            Err(ImportError::IdentityMismatch)
        );
        for locator in [
            "content://provider/document/A/B",
            "content://provider/document/a%2Fb",
        ] {
            assert_eq!(
                reconcile("source-a", observation(locator), Some(&old), "", ""),
                Err(ImportError::IdentityMismatch)
            );
        }
    }

    #[test]
    fn new_files_keep_separate_ids_even_when_observations_match() {
        let first = reconcile("source-a", observation("one.flac"), None, "a", "t1").unwrap();
        let second = reconcile("source-a", observation("two.flac"), None, "b", "t2").unwrap();
        let AssetChange::Insert { asset: a } = first else {
            panic!()
        };
        let AssetChange::Insert { asset: b } = second else {
            panic!()
        };
        assert_ne!(a.id, b.id);
        assert_ne!(a.track_id, b.track_id);
        assert_eq!(a.metadata_revision, 0);
        assert!(a.available);
        assert_eq!(
            reconcile("source-a", observation("x"), None, "same", "same"),
            Err(ImportError::InvalidInput)
        );
    }

    #[test]
    fn prepare_is_not_commit_and_storage_failure_can_retry_exact_batch() {
        let mut scan = scan();
        let batch = scan.prepare(1, 0, vec![observation("a")], false).unwrap();
        assert_eq!(scan.committed(), 0);
        assert_eq!(
            scan.prepare(1, 0, vec![observation("a")], false).unwrap(),
            batch
        );
        assert_eq!(
            scan.prepare(1, 0, vec![observation("b")], false),
            Err(ImportError::BatchPending)
        );
        scan.acknowledge(&batch).unwrap();
        assert_eq!(scan.committed(), 1);
        assert_eq!(scan.acknowledge(&batch), Err(ImportError::CursorMismatch));
        assert_eq!(scan.committed(), 1);
        assert_eq!(
            scan.prepare(1, 0, vec![observation("a")], false),
            Err(ImportError::CursorMismatch)
        );
    }

    #[test]
    fn pause_blocks_commits_and_resume_retains_pending_batch() {
        let mut scan = scan();
        let batch = scan.prepare(1, 0, vec![observation("a")], false).unwrap();
        scan.pause().unwrap();
        assert_eq!(scan.acknowledge(&batch), Err(ImportError::NotRunning));
        scan.resume().unwrap();
        scan.acknowledge(&batch).unwrap();
        assert_eq!(scan.committed(), 1);
    }

    #[test]
    fn cancellation_keeps_committed_batches_and_rejects_late_results() {
        let mut scan = scan();
        let first = scan.prepare(1, 0, vec![observation("a")], false).unwrap();
        scan.acknowledge(&first).unwrap();
        let late = scan.prepare(1, 1, vec![observation("b")], true).unwrap();
        scan.cancel();
        scan.cancel();
        assert_eq!(scan.state(), ScanState::Cancelled);
        assert_eq!(scan.committed(), 1);
        assert_eq!(scan.validate(&late), Err(ImportError::NotRunning));
        assert!(scan.pending().is_none());
        assert_eq!(scan.resume(), Err(ImportError::NotRunning));
    }

    #[test]
    fn generation_and_source_barriers_reject_old_work() {
        let mut first = scan();
        let old = first.prepare(1, 0, vec![observation("a")], true).unwrap();
        let mut newer = Scan::start("source-a".into(), 2).unwrap();
        assert_eq!(
            newer.prepare(1, 0, vec![], true),
            Err(ImportError::StaleGeneration)
        );
        assert_eq!(newer.validate(&old), Err(ImportError::StaleGeneration));
        let mut other = Scan::start("source-b".into(), 1).unwrap();
        other.prepare(1, 0, vec![observation("a")], true).unwrap();
        assert_eq!(other.validate(&old), Err(ImportError::CursorMismatch));
    }

    #[test]
    fn only_successful_full_enumeration_can_mark_unseen_missing() {
        let mut scan = scan();
        let first = scan.prepare(1, 0, vec![observation("a")], false).unwrap();
        assert!(!first.marks_unseen_missing());
        scan.acknowledge(&first).unwrap();
        let final_batch = scan.prepare(1, 1, vec![], true).unwrap();
        assert!(final_batch.marks_unseen_missing());
        scan.validate(&final_batch).unwrap();
        scan.acknowledge(&final_batch).unwrap();
        assert_eq!(scan.state(), ScanState::Complete);
        scan.cancel();
        scan.fail();
        assert_eq!(scan.state(), ScanState::Complete);
        assert_eq!(
            scan.prepare(1, 2, vec![], true),
            Err(ImportError::NotRunning)
        );
    }

    #[test]
    fn permission_or_enumeration_failure_is_not_empty_success() {
        let mut scan = scan();
        let batch = scan.prepare(1, 0, vec![], true).unwrap();
        scan.fail();
        assert_eq!(scan.state(), ScanState::Failed);
        assert_eq!(scan.validate(&batch), Err(ImportError::NotRunning));
        assert_eq!(scan.committed(), 0);
    }

    #[test]
    fn batch_validation_is_atomic_bounded_and_does_not_exclude_small_files() {
        let mut scan = scan();
        for items in [
            vec![],
            vec![observation(" ")],
            vec![observation("a"), observation("a")],
            (0..=MAX_BATCH_SIZE)
                .map(|i| observation(&i.to_string()))
                .collect(),
        ] {
            assert_eq!(
                scan.prepare(1, 0, items, false),
                Err(ImportError::InvalidInput)
            );
            assert!(scan.pending().is_none());
        }
        let mut short = observation("intro.flac");
        short.size = 0;
        let batch = scan.prepare(1, 0, vec![short], true).unwrap();
        assert_eq!(batch.source_id(), "source-a");
        assert_eq!(batch.generation(), 1);
        assert_eq!(batch.sequence(), 0);
        assert_eq!(batch.observations().len(), 1);
        scan.acknowledge(&batch).unwrap();
    }

    #[test]
    fn exhausted_counters_fail_without_preparing_or_mutating_state() {
        let mut scan = scan();
        scan.sequence = u64::MAX;
        assert_eq!(
            scan.prepare(1, u64::MAX, vec![], true),
            Err(ImportError::CounterExhausted)
        );
        assert!(scan.pending().is_none());
        scan.sequence = 0;
        scan.committed = u64::MAX;
        assert_eq!(
            scan.prepare(1, 0, vec![observation("a")], false),
            Err(ImportError::CounterExhausted)
        );
        assert_eq!(scan.committed(), u64::MAX);
        assert!(scan.pending().is_none());
    }

    #[test]
    fn empty_directory_progress_advances_without_completing_or_creating_assets() {
        let mut scan = scan();
        let batch = scan.prepare_directory(1, 0, vec![], false).unwrap();
        assert!(!batch.marks_unseen_missing());
        assert_eq!(scan.prepare_directory(1, 0, vec![], false).unwrap(), batch);
        scan.acknowledge(&batch).unwrap();
        assert_eq!(scan.committed(), 0);
        assert_eq!(scan.state(), ScanState::Running);
        assert_eq!(
            scan.prepare(1, 1, vec![], false),
            Err(ImportError::InvalidInput)
        );
        let final_batch = scan.prepare_directory(1, 1, vec![], true).unwrap();
        scan.cancel();
        assert_eq!(scan.validate(&final_batch), Err(ImportError::NotRunning));
    }
}
