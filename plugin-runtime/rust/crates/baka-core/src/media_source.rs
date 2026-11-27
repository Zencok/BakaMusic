use serde::{Deserialize, Serialize};

/// 音质档位。取值与洛雪脚本 `musicUrl` 的 `quality` 参数对齐。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    #[serde(rename = "128k")]
    Low,
    #[serde(rename = "320k")]
    Standard,
    /// FLAC 无损。
    Flac,
    /// Hi-Res / 24bit。
    #[serde(rename = "flac24bit")]
    Flac24Bit,
}

impl Quality {
    /// 洛雪脚本 `musicUrl(source, musicInfo, type)` 里 `type` 的字面量。
    pub fn as_lx_type(self) -> &'static str {
        match self {
            Self::Low => "128k",
            Self::Standard => "320k",
            Self::Flac => "flac",
            Self::Flac24Bit => "flac24bit",
        }
    }

    /// 降级顺序：高音质拿不到就退一档，而不是直接失败。
    pub fn fallback(self) -> Option<Self> {
        match self {
            Self::Flac24Bit => Some(Self::Flac),
            Self::Flac => Some(Self::Standard),
            Self::Standard => Some(Self::Low),
            Self::Low => None,
        }
    }
}

/// 可播放地址。**这是 M0 的唯一验收产物** —— 两个废案都死在拿不到它。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSource {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<Quality>,
    /// 播放该地址所需的请求头。部分源（bilibili）缺 Referer 直接 403，
    /// 所以这些头必须一路传到播放器层，不能在 host 里丢掉。
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub headers: std::collections::BTreeMap<String, String>,
    /// 地址有效期（Unix 秒）。多数源的 url 带签名会过期，UI 层据此决定是否重取。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

impl MediaSource {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            quality: None,
            headers: Default::default(),
            expires_at: None,
        }
    }

    /// 粗判是否像个真能播的地址。M0 验收用：防止把脚本返回的空串、
    /// `"null"`、或那种写死的测试 mp3 当成成功。
    pub fn looks_playable(&self) -> bool {
        let u = self.url.trim();
        (u.starts_with("http://") || u.starts_with("https://"))
            && !u.contains("exoplayer-test-media")
    }
}
