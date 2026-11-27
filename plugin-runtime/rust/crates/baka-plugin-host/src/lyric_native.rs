//! Native lyric parsing. Format tags decode in milliseconds; the model uses seconds at the legacy wire boundary.
//! Kept separate from plugin execution so format/timing tests need no JS runtime.
use regex::Regex;
use serde::{Deserialize, Serialize};
pub mod export;
mod formats;
mod rules;
mod secondary;
mod speakers;
pub mod timeline;
mod ttml;
use std::sync::LazyLock;

static STAMP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(\d+):(\d+)(?:[.:](\d+))?\]").unwrap());
static HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[(\d+),(\d+)\]").unwrap());
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\((\d+),(\d+)(?:,(\d+))?\)").unwrap());
static ANGLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(\d+):(\d+)(?:[.:](\d+))?>").unwrap());
static OFFSET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\[offset:([+-]?\d+)\]").unwrap());

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
    pub index: usize,
    pub space: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ruby: Vec<Word>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roman_word: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Line {
    pub time: f64,
    pub end_time: f64,
    pub duration: f64,
    pub lrc: String,
    pub index: usize,
    pub words: Vec<Word>,
    pub has_word_timeline: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub romanization: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub romanization_words: Vec<Word>,
    pub has_romanization_word_timeline: bool,
    #[serde(rename = "isBG")]
    pub is_bg: bool,
    pub is_duet: bool,
    pub is_duet_partner: bool,
    pub has_singer_label: bool,
    #[serde(skip)]
    pub structured: bool,
    #[serde(skip)]
    pub explicit_end: bool,
}
fn integer(s: &str) -> i64 {
    s.parse::<i64>().unwrap_or(0).clamp(0, 86_400_000)
}
fn stamp(c: &regex::Captures<'_>) -> i64 {
    let millis = c
        .get(3)
        .map(|m| {
            let s = format!("{}000", m.as_str());
            integer(&s[..3])
        })
        .unwrap_or(0);
    integer(&c[1]) * 60_000 + integer(&c[2]) * 1000 + millis
}
fn word(text: &str, start: i64, end: i64, index: usize) -> Word {
    Word {
        text: text.to_owned(),
        start_time: start as f64 / 1000.,
        end_time: end.max(start) as f64 / 1000.,
        duration: (end - start).max(0) as f64 / 1000.,
        index,
        space: text.trim().is_empty(),
        ..Default::default()
    }
}
fn line(text: String, start: i64, end: i64, words: Vec<Word>) -> Line {
    Line {
        time: start as f64 / 1000.,
        end_time: end.max(start) as f64 / 1000.,
        duration: (end - start).max(0) as f64 / 1000.,
        lrc: text,
        index: 0,
        has_word_timeline: !words.is_empty(),
        words,
        ..Default::default()
    }
}

/// Core parser supports mixed LRC/QRC/YRC/A2. Unsupported rich syntax is explicit.
fn parse_basic(raw: &str) -> Result<Vec<Line>, String> {
    if raw.len() > 2 * 1024 * 1024 {
        return Err("lyric input limit exceeded".into());
    }
    let offset = OFFSET
        .captures(raw)
        .and_then(|c| c[1].parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(-3_600_000, 3_600_000);
    let mut out = Vec::new();
    for raw_line in raw.lines() {
        let s = raw_line.trim().trim_start_matches('\u{feff}');
        let without_offset = OFFSET.replace_all(s, "");
        let s = without_offset.trim();
        if s.is_empty() {
            continue;
        }
        if let Some(h) = HEADER.captures(s) {
            let start = integer(&h[1]) - offset;
            let end = start + integer(&h[2]);
            let body = &s[h.get(0).unwrap().end()..];
            let tags: Vec<_> = WORD.captures_iter(body).collect();
            let prefix = tags
                .first()
                .is_some_and(|t| body[..t.get(0).unwrap().start()].trim().is_empty());
            let relative = tags
                .first()
                .is_some_and(|t| integer(&t[1]) < start + offset);
            let mut words = Vec::new();
            let mut cursor = 0;
            let mut text = String::new();
            for (i, t) in tags.iter().enumerate() {
                let span = t.get(0).unwrap();
                let segment = if prefix {
                    &body[span.end()
                        ..tags
                            .get(i + 1)
                            .map_or(body.len(), |n| n.get(0).unwrap().start())]
                } else {
                    &body[cursor..span.start()]
                };
                let begin = integer(&t[1]) - offset + if relative { start + offset } else { 0 };
                words.push(word(segment, begin, begin + integer(&t[2]), words.len()));
                text.push_str(segment);
                cursor = span.end();
            }
            if tags.is_empty() || !prefix {
                text.push_str(&body[cursor..]);
            }
            if !text.trim().is_empty() {
                let mut l = line(text, start, end, words);
                l.explicit_end = true;
                out.push(l);
            }
        } else if STAMP.is_match(s) {
            let stamps: Vec<_> = STAMP.captures_iter(s).collect();
            let body = &s[stamps.last().unwrap().get(0).unwrap().end()..];
            // Inline square-word syntax is distinct from repeated leading timestamps.
            if stamps
                .iter()
                .skip(1)
                .any(|t| !s[..t.get(0).unwrap().start()].ends_with(']'))
            {
                out.push(formats::inline_square(s, offset)?);
                continue;
            }
            let angles: Vec<_> = ANGLE.captures_iter(body).collect();
            for st in &stamps {
                let start = stamp(st) - offset;
                let mut words = Vec::new();
                let mut text = String::new();
                if angles.is_empty() {
                    text.push_str(body);
                } else {
                    text.push_str(&body[..angles[0].get(0).unwrap().start()]);
                    let relative = stamp(&angles[0]) < start + offset - 500;
                    for (i, t) in angles.iter().enumerate() {
                        let tag = t.get(0).unwrap();
                        let segment = &body[tag.end()
                            ..angles
                                .get(i + 1)
                                .map_or(body.len(), |n| n.get(0).unwrap().start())];
                        let begin = stamp(t) - offset + if relative { start + offset } else { 0 };
                        let end = angles.get(i + 1).map_or(begin + 3000, |n| {
                            stamp(n) - offset + if relative { start + offset } else { 0 }
                        });
                        if !segment.is_empty() {
                            if segment.starts_with(' ')
                                && words.last().is_some_and(|w: &Word| !w.text.ends_with(' '))
                            {
                                words.last_mut().unwrap().text.push(' ');
                            }
                            if !segment.trim().is_empty() {
                                words.push(word(segment.trim(), begin, end, words.len()));
                            }
                            if segment.ends_with(' ')
                                && let Some(w) = words.last_mut()
                            {
                                w.text.push(' ');
                            }
                        }
                    }
                    text = words.iter().map(|w| w.text.as_str()).collect();
                }
                // Empty timestamp lines delimit preceding vocals/interludes.
                let end = words
                    .last()
                    .map_or(start + 3000, |w| (w.end_time * 1000.).round() as i64);
                out.push(line(text, start, end, words));
            }
        } else if s.starts_with('[') && s.contains(':') {
            continue;
        } else {
            if let Some(json_line) = formats::netease_json(s, offset) {
                out.push(json_line);
            } else {
                out.push(line(s.to_owned(), 0, 3000, Vec::new()));
            }
        }
    }
    out.sort_by(|a, b| a.time.total_cmp(&b.time));
    for i in 0..out.len() {
        out[i].index = i;
        if !out[i].has_word_timeline
            && !out[i].explicit_end
            && let Some(next) = out.get(i + 1)
        {
            out[i].end_time = next.time.max(out[i].time);
        }
        out[i].duration = out[i].end_time - out[i].time;
    }
    Ok(out)
}

pub fn parse_core(raw: &str) -> Result<Vec<Line>, String> {
    formats::parse(raw)
}

/// Same bounded QRC/XML decoder used by online lyrics, without a JS runtime.
pub fn decode_text(raw: &str) -> Result<String, String> {
    crate::shim::qrc::decode(raw)
}

/// Attach explicit local companion tracks to an already parsed rich document.
/// Never flatten/reparse the primary: TTML ruby and vocal roles must survive.
pub fn attach_secondary(
    lines: &mut [Line],
    translation: Option<&str>,
    romanization: Option<&str>,
    artist: Option<&str>,
) -> Result<(), String> {
    let mut tracks = Vec::new();
    for (raw, roman) in [(translation, false), (romanization, true)] {
        if let Some(raw) = raw {
            let mut source = parse_core(raw)?;
            for l in &mut source {
                formats::compact_words(&mut l.words);
            }
            speakers::apply(&mut source, artist, false);
            tracks.push((source, roman));
        }
    }
    for (source, roman) in tracks {
        rules::merge(lines, &source, roman);
    }
    Ok(())
}

/// Native production entry. All application-side lyric work stays in Rust.
pub fn parse(
    raw: &str,
    translation: Option<&str>,
    romanization: Option<&str>,
    artist: Option<&str>,
) -> Result<Vec<Line>, String> {
    let mut lines = parse_desktop(raw, translation, romanization, artist)?;
    secondary::repair_exported_romanization(&mut lines);
    Ok(lines)
}

/// Desktop behavior before repairs specific to flattened imported documents.
pub fn parse_desktop(
    raw: &str,
    translation: Option<&str>,
    romanization: Option<&str>,
    artist: Option<&str>,
) -> Result<Vec<Line>, String> {
    let primary = if raw.trim().is_empty() {
        translation
            .filter(|v| !v.trim().is_empty())
            .or(romanization)
            .unwrap_or("")
    } else {
        raw
    };
    let mut lines = parse_core(primary)?;
    for l in &mut lines {
        formats::compact_words(&mut l.words);
    }
    if artist.is_none_or(|a| !a.contains([',', '，', '、', '/', '&', ';', '；']))
        && (HEADER.is_match(primary.lines().find(|l| HEADER.is_match(l)).unwrap_or(""))
            || (STAMP.is_match(primary) && !ANGLE.is_match(primary)))
    {
        for l in &mut lines {
            if !l.structured && formats::wraps(&l.lrc) {
                formats::strip_edges(l);
                l.is_bg = true;
                l.structured = true;
            }
        }
    }
    if primary.contains("\"c\"") {
        secondary::alternating(&mut lines);
    }
    rules::normalize(&mut lines, artist);
    if primary != translation.unwrap_or("")
        && let Some(text) = translation
    {
        let mut source = parse_core(text)?;
        for l in &mut source {
            formats::compact_words(&mut l.words);
        }
        speakers::apply(&mut source, artist, false);
        rules::merge(&mut lines, &source, false);
    }
    if primary != romanization.unwrap_or("")
        && let Some(text) = romanization
    {
        let mut source = parse_core(text)?;
        for l in &mut source {
            formats::compact_words(&mut l.words);
        }
        speakers::apply(&mut source, artist, false);
        rules::merge(&mut lines, &source, true);
    }
    rules::finish(&mut lines, artist);
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_and_repeated() {
        let lines = parse_core(
            "[00:01.00][00:03.00]repeat\n[4000,1000]Q(4000,1000)\n[5000,1000](5000,1000,0)Y",
        )
        .unwrap();
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[1].time, 3.);
        assert_eq!(lines[2].words[0].start_time, 4.);
    }
    #[test]
    fn punctuation_and_tail() {
        let lines = parse_core("[1000,1000]hello (world)(1000,1000)tail").unwrap();
        assert_eq!(lines[0].lrc, "hello (world)tail");
    }
    #[test]
    fn offsets_shift_words() {
        let lines = parse_core("[offset:500]\n[1000,1000](1000,1000,0)word").unwrap();
        assert_eq!(lines[0].time, 1.5);
        assert_eq!(lines[0].words[0].start_time, 1.5);
    }
    #[test]
    fn enhanced_keeps_zero_duration_text() {
        let lines = parse_core("[00:01.00]<00:01.00>a<00:01.00>b<00:02.00>").unwrap();
        assert_eq!(lines[0].lrc, "ab");
        assert_eq!(lines[0].words[0].duration, 0.);
    }
    #[test]
    fn rich_rules_stay_explicit() {
        assert_eq!(
            parse("[00:01.00]A：hello", None, None, None).unwrap()[0].lrc,
            "A：hello"
        );
        assert_eq!(
            parse("[00:01.00]hello", Some("[00:01.00]translation"), None, None).unwrap()[0]
                .translation
                .as_deref(),
            Some("translation")
        );
    }
}
