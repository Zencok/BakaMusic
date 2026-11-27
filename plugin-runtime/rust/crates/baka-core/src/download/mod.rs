//! Pure canonical download identities and coordinator policy. No platform I/O.

mod identity;
mod policy;

pub use identity::{DownloadIdentityError, DownloadRequestKind, JobId, ResourceIdentity, Sequence};
pub use policy::{DownloadPhase, EventFence, RetryBudget, RetryKind};

#[cfg(test)]
mod tests;
