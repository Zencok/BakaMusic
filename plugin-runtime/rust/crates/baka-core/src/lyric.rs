use serde::{Deserialize, Serialize};

/// 逐字歌词的单个字/词。
///
/// 与 Dart 侧 `lib/core/lyric/lyric_line.dart` 一一对应（那份是从 CyreneMusic
/// `lib/models/lyric_line.dart` 直接搬来的，88 行）。两边字段名保持一致，
/// FFI 序列化就不需要额外映射。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricWord {
    /// 相对歌曲起点的毫秒。
    pub start_ms: u64,
    pub duration_ms: u64,
    pub text: String,
}

impl LyricWord {
    pub fn end_ms(&self) -> u64 {
        self.start_ms + self.duration_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub start_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation: Option<String>,
    /// 逐字数据。为空表示只有整行时间戳（普通 LRC）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<LyricWord>,
    /// 整行时长。YRC/QRC 给得出，普通 LRC 靠下一行起点推。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

impl LyricLine {
    pub fn has_word_by_word(&self) -> bool {
        !self.words.is_empty()
    }

    /// 行尾时间。优先用 `duration_ms`，否则用最后一个字的结束时间。
    ///
    /// 注意：CyreneMusic 的卡拉OK面板在拿不到时长时硬编码
    /// `startTime + Duration(seconds: 3)`（`player_karaoke_lyrics_panel.dart:541`），
    /// 我们不复制这个 magic number —— 返回 `None`，由调用方用下一行起点补。
    pub fn end_ms(&self) -> Option<u64> {
        self.duration_ms
            .map(|d| self.start_ms + d)
            .or_else(|| self.words.last().map(LyricWord::end_ms))
    }
}
