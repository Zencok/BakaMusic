//! BakaMusic 的共享领域类型。
//!
//! 这个 crate 刻意不含任何 I/O、异步运行时或平台代码，只放跨层共用的数据形状
//! 与错误类型，方便 `baka-plugin-host`、`baka-ffi` 以及后续的协议实现共用。
//!
//! 设计约束：
//!
//! - **插件返回的 id 必须保留 JSON 原始标量类型**。网易云的 id 是 number，
//!   QQ 的是 string；一旦在往返过程中被统一成字符串，备份 v3 还原后逐字歌词会
//!   对不上。因此 [`RawId`] 区分 `Num` 与 `Str`，序列化后与原 JSON 一致。
//! - 所有面向插件的结构都允许「字段缺失」，不要用 `#[serde(deny_unknown_fields)]`：
//!   洛雪脚本各家返回的字段集合并不一致。

mod error;
mod lyric;
mod media_source;
mod track;

pub use error::{BakaError, Result};
pub use lyric::{LyricLine, LyricWord};
pub use media_source::{MediaSource, Quality};
pub use track::{Album, Artist, RawId, Track, duration_ms_from_metadata};

pub mod download;
pub mod playlist_sync;
pub mod plugin_contract;
pub mod workspace;

pub mod local_library;

pub mod local_album;

pub mod natural_order;
pub mod search_text;
