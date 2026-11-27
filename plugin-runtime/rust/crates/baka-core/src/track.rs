use serde::{Deserialize, Serialize};

pub fn duration_ms_from_metadata(track: &serde_json::Value) -> Option<u64> {
    for candidate in [
        &track["duration"],
        &track["interval"],
        &track["DURATION"],
        &track["_gitcodeData"]["duration"],
    ] {
        if let Some(milliseconds) =
            parse_duration(candidate).and_then(|seconds| valid_milliseconds(seconds * 1000.))
        {
            return Some(milliseconds);
        }
    }
    for candidate in [&track["dt"], &track["durationMs"], &track["duration_ms"]] {
        if let Some(milliseconds) = parse_duration(candidate).and_then(valid_milliseconds) {
            return Some(milliseconds);
        }
    }
    None
}

fn valid_milliseconds(value: f64) -> Option<u64> {
    (value.is_finite() && (0. ..=9_007_199_254_740_991.).contains(&value)).then_some(value as u64)
}

fn parse_duration(value: &serde_json::Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return (number.is_finite() && number >= 0.).then_some(number);
    }
    let text = value.as_str()?.trim();
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    let number = if digits(text)
        || text
            .split_once('.')
            .is_some_and(|(whole, fraction)| digits(whole) && digits(fraction))
    {
        text.parse::<f64>().ok()?
    } else {
        let parts: Vec<_> = text.split(':').collect();
        if !(2..=3).contains(&parts.len()) || !parts.iter().all(|part| digits(part)) {
            return None;
        }
        let mut seconds = 0.;
        for part in parts {
            seconds = seconds * 60. + part.parse::<f64>().ok()?;
        }
        seconds
    };
    number.is_finite().then_some(number)
}

#[cfg(test)]
mod duration_tests {
    use super::*;

    #[test]
    fn desktop_duration_contract() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../test/fixtures/track_duration.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                duration_ms_from_metadata(&case["metadata"]),
                case["expectedMs"].as_u64(),
                "{}",
                case["name"]
            );
        }
    }
}

/// 插件返回的原始 id，**保留 JSON 标量类型**。
///
/// 这不是洁癖。备份格式 `bakamusic.music-sheet-backup` v3 要求还原后的 id 与
/// 备份时逐字节一致：网易云 id 是 number（`33894312`），QQ 是 string
/// (`"003OUlho2HcRHC"`）。若统一成字符串，还原后再去请求逐字歌词会 404 ——
/// 这正是 Electron 版早期踩过的坑。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RawId {
    Num(i64),
    Str(String),
}

impl RawId {
    /// 用于内部索引/去重的字符串形式。**不要**把它写回备份或请求参数。
    pub fn as_key(&self) -> String {
        match self {
            Self::Num(n) => n.to_string(),
            Self::Str(s) => s.clone(),
        }
    }
}

impl std::fmt::Display for RawId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Num(n) => write!(f, "{n}"),
            Self::Str(s) => write!(f, "{s}"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Artist {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<RawId>,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Album {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<RawId>,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "artwork", skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
}

/// 一首歌。字段集合按洛雪 / MusicFree 两边的交集取，缺失一律容忍。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: RawId,
    /// 来源插件的 name（不是 hash）。用于二次请求时路由回同一个插件。
    pub platform: String,
    pub title: String,
    #[serde(default)]
    pub artists: Vec<Artist>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<Album>,
    /// 毫秒。洛雪部分脚本给的是秒，归一化在 host 层做。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
    /// 插件原样返回的其余字段。二次请求（取播放地址、取歌词）时要原封不动带回去，
    /// 因为部分脚本把私有 token 藏在这里。
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}
