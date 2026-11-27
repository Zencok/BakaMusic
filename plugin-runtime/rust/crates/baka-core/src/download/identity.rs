use crate::plugin_contract::{EntityKind, EntityRef};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fmt, str::FromStr};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DownloadIdentityError {
    #[error("invalid_task_id")]
    InvalidJobId,
    #[error("invalid_sequence")]
    InvalidSequence,
    #[error("counter_exhausted")]
    CounterExhausted,
    #[error("download entity must have kind music")]
    InvalidEntityKind,
}

/// Opaque job identity. The FFI supplies cryptographic entropy and enforces
/// uniqueness across deletion; resource identity must never supply these bytes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct JobId(String);

impl JobId {
    pub fn from_entropy(entropy: [u8; 16]) -> Self {
        Self(format!("dl2_{}", hex(&entropy)))
    }

    pub fn parse(value: &str) -> Result<Self, DownloadIdentityError> {
        if value.len() != 36
            || !value.starts_with("dl2_")
            || !value.as_bytes()[4..]
                .iter()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c))
        {
            return Err(DownloadIdentityError::InvalidJobId);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for JobId {
    type Error = DownloadIdentityError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}
impl From<JobId> for String {
    fn from(value: JobId) -> Self {
        value.0
    }
}
impl FromStr for JobId {
    type Err = DownloadIdentityError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}
impl fmt::Display for JobId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// All sequence fields cross JSON/SQLite/platform boundaries as canonical text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Sequence(u64);

impl Sequence {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
    pub fn parse(value: &str) -> Result<Self, DownloadIdentityError> {
        if value.is_empty()
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(DownloadIdentityError::InvalidSequence);
        }
        value
            .parse()
            .map(Self)
            .map_err(|_| DownloadIdentityError::InvalidSequence)
    }
    pub fn checked_next(self) -> Result<Self, DownloadIdentityError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(DownloadIdentityError::CounterExhausted)
    }
}
impl TryFrom<String> for Sequence {
    type Error = DownloadIdentityError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}
impl From<Sequence> for String {
    fn from(value: Sequence) -> Self {
        value.0.to_string()
    }
}
impl FromStr for Sequence {
    type Err = DownloadIdentityError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}
impl fmt::Display for Sequence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DownloadRequestKind {
    Audio,
    Video { quality: String },
}

/// Retains canonical data so a ledger can reject a digest collision explicitly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceIdentity {
    entity: EntityRef,
    canonical_json: String,
    resource_key: String,
}

impl ResourceIdentity {
    pub fn new(entity: EntityRef) -> Result<Self, DownloadIdentityError> {
        if entity.kind() != EntityKind::Music {
            return Err(DownloadIdentityError::InvalidEntityKind);
        }
        // EntityId already normalizes safe integral JSON numbers. Reuse that
        // contract rather than introducing a second numeric normalization rule.
        let id = Value::from(entity.id().clone());
        let tagged_id = if id.is_string() {
            json!(["s", id])
        } else {
            json!(["n", id])
        };
        let canonical_json = json!([
            "baka.download.resource",
            2,
            entity.provider_id(),
            "music",
            tagged_id
        ])
        .to_string();
        let resource_key = format!("res2_{}", digest(&canonical_json));
        Ok(Self {
            entity,
            canonical_json,
            resource_key,
        })
    }
    pub fn entity(&self) -> &EntityRef {
        &self.entity
    }
    pub fn canonical_json(&self) -> &str {
        &self.canonical_json
    }
    pub fn resource_key(&self) -> &str {
        &self.resource_key
    }
    /// Audio ignores quality by construction; video keeps the selected quality.
    pub fn request_key(&self, kind: &DownloadRequestKind) -> String {
        let canonical = match kind {
            DownloadRequestKind::Audio => {
                json!(["baka.download.request", 2, self.resource_key, "audio"])
            }
            DownloadRequestKind::Video { quality } => json!([
                "baka.download.request",
                2,
                self.resource_key,
                "video",
                quality
            ]),
        };
        format!("req2_{}", digest(&canonical.to_string()))
    }
}

fn digest(value: &str) -> String {
    hex(&Sha256::digest(value.as_bytes()))
}
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize] as char);
        result.push(DIGITS[(byte & 15) as usize] as char);
    }
    result
}
