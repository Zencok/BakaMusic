//! QuickJS host for externally installed BakaMusic plugins.
//!
//! Each package has an isolated runtime and context. Only canonical V2 manifests
//! and declared named capabilities are executable. Generic HTTP, storage, crypto
//! and byte primitives support independently updatable provider protocols.

mod call_scope;
mod host;
mod http_client;
mod lifecycle;
pub mod plugin_network;
pub mod shim;
mod v2;
pub mod workspace_transport;

pub use host::{PluginHost, ScriptId};
pub use http_client::http_client_builder;

pub mod lyric_native;
