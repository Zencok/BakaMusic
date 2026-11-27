use super::{JobId, Sequence};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadPhase {
    Queued,
    Admitting,
    Resolving,
    Transferring,
    Postprocessing,
    WaitingRetry,
    Blocked,
    Suspended,
    WaitingForForeground,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadPhase {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// Worker progress can only affect phases with authorized running work.
    /// The coordinator must additionally validate the registered operation and
    /// executor, and persist event deduplication before accepting an event.
    pub fn accepts_progress(self) -> bool {
        matches!(
            self,
            Self::Resolving | Self::Transferring | Self::Postprocessing
        )
    }

    /// Ordinary execution edges. Explicit retry/resume commands have separate
    /// admission rules and are deliberately not represented by this method.
    pub fn can_transition_to(self, next: Self) -> bool {
        use DownloadPhase::*;
        matches!(
            (self, next),
            (Queued, Admitting | Cancelled)
                | (
                    Admitting,
                    Resolving | Blocked | Suspended | WaitingForForeground | Failed | Cancelled
                )
                | (
                    Resolving,
                    Transferring | WaitingRetry | Blocked | Suspended | Failed | Cancelled
                )
                | (
                    Transferring,
                    Postprocessing | WaitingRetry | Blocked | Suspended | Failed | Cancelled
                )
                | (Postprocessing, Completed | Suspended | Failed | Cancelled)
                | (WaitingRetry, Admitting | Cancelled)
                | (Blocked | Suspended | WaitingForForeground, Cancelled)
        )
    }
}

/// Necessary event fence, never a substitute for operation authorization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFence {
    pub task_id: JobId,
    pub generation: Sequence,
    pub operation_seq: Sequence,
}

impl EventFence {
    pub fn matches(&self, current: &Self) -> bool {
        self == current
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryKind {
    Transient,
    SignatureRefresh,
    IntegrityRestart,
    QualityFallback,
}

/// Persist this together with the decision before dispatching an automatic
/// retry. Only explicit user retry may create a new budget epoch externally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryBudget {
    automatic_remaining: u8,
    refresh_remaining: u8,
    integrity_remaining: u8,
    quality_remaining: u32,
}

impl RetryBudget {
    pub fn new(quality_candidate_count: u32) -> Self {
        Self {
            automatic_remaining: 2,
            refresh_remaining: 1,
            integrity_remaining: 1,
            quality_remaining: quality_candidate_count.saturating_sub(1),
        }
    }

    /// Denied attempts leave every budget unchanged. Refresh/integrity consume
    /// both the shared automatic budget and their narrower cap.
    pub fn consume(&mut self, kind: RetryKind) -> bool {
        match kind {
            RetryKind::QualityFallback if self.quality_remaining > 0 => {
                self.quality_remaining -= 1;
            }
            RetryKind::Transient if self.automatic_remaining > 0 => {
                self.automatic_remaining -= 1;
            }
            RetryKind::SignatureRefresh
                if self.automatic_remaining > 0 && self.refresh_remaining > 0 =>
            {
                self.automatic_remaining -= 1;
                self.refresh_remaining -= 1;
            }
            RetryKind::IntegrityRestart
                if self.automatic_remaining > 0 && self.integrity_remaining > 0 =>
            {
                self.automatic_remaining -= 1;
                self.integrity_remaining -= 1;
            }
            _ => return false,
        }
        true
    }
}
