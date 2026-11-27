use thiserror::Error;

pub type Result<T> = std::result::Result<T, BakaError>;

/// 全局错误类型。
///
/// 刻意保留 `NotImplemented`：M0 阶段大量 shim 尚未落地，返回一个可识别的错误
/// 比 `todo!()` panic 有用得多 —— 插件跑到未实现的能力时，我们要能看到是哪个
/// 能力缺失，而不是整个 QuickJS 上下文一起炸掉。
#[derive(Debug, Error)]
pub enum BakaError {
    #[error("plugin `{plugin}` not found")]
    PluginNotFound { plugin: String },

    /// JS 侧抛出的异常，或 QuickJS 自身的求值错误。
    #[error("javascript error in `{plugin}`: {message}")]
    Js { plugin: String, message: String },

    /// Validated V2 failure code; source messages and credentials are not transported.
    #[error("plugin_failure:{code}")]
    PluginFailure { code: String },

    /// 插件返回了合法 JSON，但形状不是我们期望的。
    #[error("plugin `{plugin}` returned unexpected shape: {detail}")]
    BadPluginResponse { plugin: String, detail: String },

    #[error("network error: {0}")]
    Network(String),

    #[error("decode error: {0}")]
    Decode(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    /// shim 层尚未实现的能力。`capability` 用 JS 侧可见的名字，例如
    /// `"crypto.rsaEncrypt"`、`"pako.inflateRaw"`。
    #[error("capability `{capability}` is not implemented yet")]
    NotImplemented { capability: &'static str },

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl BakaError {
    pub fn js(plugin: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Js {
            plugin: plugin.into(),
            message: message.into(),
        }
    }

    pub fn bad_response(plugin: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::BadPluginResponse {
            plugin: plugin.into(),
            detail: detail.into(),
        }
    }
}
