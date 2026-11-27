//! Download serializer ported from BakaMusic common/download-postprocess.ts.
//! Input is the decoded, repaired native model, never plugin ciphertext.
use super::{Line, Word};

/// Plain original-line LRC for system players, without word tags or duplicate
/// secondary-language timestamps. The repaired native model is the authority.
pub fn system_lrc(lines: &[Line]) -> String {
    // Origin Player treats any fractional integer <= 99 as hundredths, even
    // when the source has three digits (".013" becomes 130 ms). Emit exactly
    // two digits, rounding before splitting so minute carries stay valid.
    lines
        .iter()
        .map(|line| {
            let cs = if line.time.is_finite() {
                (line.time.max(0.) * 100.).round() as u64
            } else {
                0
            };
            format!(
                "[{:02}:{:02}.{:02}]{}",
                cs / 6000,
                cs / 100 % 60,
                cs % 100,
                line.lrc
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Original,
    Translation,
    Romanization,
}

pub struct Options {
    pub order: Vec<Part>,
    pub word_by_word: bool,
    pub with_timestamp: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            order: vec![Part::Romanization, Part::Original, Part::Translation],
            word_by_word: true,
            with_timestamp: true,
        }
    }
}

fn timestamp(seconds: f64) -> String {
    // Round before splitting so 59.9996 becomes 01:00.000, not 00:59.1000.
    let ms = if seconds.is_finite() {
        (seconds.max(0.) * 1000.).round() as u64
    } else {
        0
    };
    format!("{:02}:{:02}.{:03}", ms / 60_000, ms / 1000 % 60, ms % 1000)
}
fn words_line(time: f64, words: &[Word], end: f64, text: &str) -> String {
    let mut out = format!("[{}]", timestamp(time));
    let timed_text: String = words.iter().map(|word| word.text.as_str()).collect();
    // QRC may contain an untimed prefix/tail. Keep it instead of silently
    // dropping punctuation or words absent from the provider's word list.
    let Some(start) = (!timed_text.is_empty())
        .then(|| text.find(&timed_text))
        .flatten()
    else {
        return format!("[{}]{}", timestamp(time), text);
    };
    let prefix = &text[..start];
    let suffix = &text[start + timed_text.len()..];
    if !prefix.is_empty() {
        out.push_str(&format!("<{}>{prefix}", timestamp(time)));
    }
    let mut last_end = end.max(time);
    for word in words {
        out.push_str(&format!("<{}>{}", timestamp(word.start_time), word.text));
        last_end = last_end.max(word.end_time).max(word.start_time);
    }
    if !suffix.is_empty() {
        out.push_str(&format!("<{}>{suffix}", timestamp(last_end)));
    }
    out.push_str(&format!("<{}>", timestamp(last_end)));
    out
}

pub fn format(lines: &[Line], raw: &str, options: &Options) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut output = Vec::new();
    if options.with_timestamp {
        for key in ["ti", "ar", "al", "by"] {
            let prefix = format!("[{key}:");
            if let Some(value) = raw
                .lines()
                .map(str::trim)
                .find(|s| s.starts_with(&prefix) && s.ends_with(']'))
            {
                output.push(value.to_owned());
            }
        }
        // Native parsing already applies offset to line AND word times. Exporting
        // the source offset again would shift lyrics twice when read by a player.
        if !output.is_empty() {
            output.push(String::new());
        }
    }
    let mut order = Vec::new();
    for part in &options.order {
        if !order.contains(part) {
            order.push(*part);
        }
    }
    for line in lines {
        for part in &order {
            let (text, words, timed) = match part {
                Part::Original => (line.lrc.as_str(), &line.words, line.has_word_timeline),
                Part::Translation => (
                    line.translation.as_deref().unwrap_or(""),
                    &line.words,
                    false,
                ),
                Part::Romanization => (
                    line.romanization.as_deref().unwrap_or(""),
                    &line.romanization_words,
                    line.has_romanization_word_timeline,
                ),
            };
            if text.trim().is_empty() {
                if *part == Part::Original && options.with_timestamp {
                    output.push(format!("[{}]", timestamp(line.time)));
                }
                continue;
            }
            let enhanced = options.word_by_word && timed && !words.is_empty();
            output.push(if !options.with_timestamp {
                text.to_owned()
            } else if enhanced {
                words_line(line.time, words, line.end_time, text)
            } else {
                format!("[{}]{}", timestamp(line.time), text)
            });
        }
    }
    output.join("\n").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyric_native::{parse, parse_core};

    #[test]
    fn system_lrc_uses_hundredths_and_carries_to_next_minute() {
        let lines = parse_core("[00:01.013]<00:01.013>A<00:02.000>\n[00:59.999]B").unwrap();
        assert_eq!(system_lrc(&lines), "[00:01.01]A\n[01:00.00]B");
    }

    #[test]
    fn untimed_qrc_tail_is_not_lost() {
        let raw = "[1000,1000]A&B(1000,1000)tail";
        let lines = parse_core(raw).unwrap();
        let output = format(&lines, raw, &Options::default());
        assert_eq!(
            output,
            "[00:01.000]<00:01.000>A&B<00:02.000>tail<00:02.000>"
        );
        assert_eq!(parse_core(&output).unwrap()[0].lrc, "A&Btail");
    }
    #[test]
    fn rich_formats_export_standard_enhanced_lrc() {
        for raw in [
            "[1000,2000]Hello(1000,1000) world(2000,1000)",
            "[1000,2000](1000,1000,0)Hello(2000,1000,0) world",
            "[1000,2000]<0,1000,0>Hello<1000,1000,0> world",
            "[00:01.000]<00:01.000>Hello<00:02.000> world<00:03.000>",
        ] {
            let lines = parse_core(raw).unwrap();
            assert_eq!(
                format(&lines, raw, &Options::default()),
                if raw.contains("<00:") {
                    "[00:01.000]<00:01.000>Hello <00:02.000>world<00:03.000>"
                } else {
                    "[00:01.000]<00:01.000>Hello<00:02.000> world<00:03.000>"
                },
                "{raw}"
            );
        }
    }
    #[test]
    fn translation_and_romanization_are_interleaved_not_appended_blocks() {
        let raw = "[00:01.00]Hello\n[00:03.00]World";
        let lines = parse(
            raw,
            Some("[00:01.00]你好\n[00:03.00]世界"),
            Some("[00:01.00]hello\n[00:03.00]world"),
            None,
        )
        .unwrap();
        assert_eq!(
            format(&lines, raw, &Options::default()),
            "[00:01.000]hello\n[00:01.000]Hello\n[00:01.000]你好\n[00:03.000]world\n[00:03.000]World\n[00:03.000]世界"
        );
    }
    #[test]
    fn metadata_offset_rounding_and_modes() {
        assert_eq!(timestamp(59.9996), "01:00.000");
        assert_eq!(timestamp(-1.), "00:00.000");
        assert_eq!(timestamp(f64::NAN), "00:00.000");
        let raw = "[ti:Song]\n[offset:500]\n[1000,1000]Hi(1000,1000)";
        let lines = parse_core(raw).unwrap();
        assert_eq!(
            format(&lines, raw, &Options::default()),
            "[ti:Song]\n\n[00:01.500]<00:01.500>Hi<00:02.500>"
        );
        let mut options = Options::default();
        options.word_by_word = false;
        assert_eq!(format(&lines, "", &options), "[00:01.500]Hi");
        options.with_timestamp = false;
        assert_eq!(format(&lines, raw, &options), "Hi");
        options.order.clear();
        assert_eq!(format(&lines, raw, &options), "");
    }
    #[test]
    fn roman_words_and_vocals_preserved_redundant_blank_removed() {
        let mut lines = parse_core("[00:01.00]<00:01.00>hi<00:02.00>\n[00:03.00]").unwrap();
        lines[0].is_bg = true;
        lines[0].is_duet = true;
        lines[0].romanization = Some("hai".into());
        lines[0].romanization_words = vec![Word {
            text: "hai".into(),
            start_time: 1.,
            end_time: 2.,
            ..Default::default()
        }];
        lines[0].has_romanization_word_timeline = true;
        let output = format(&lines, "", &Options::default());
        assert_eq!(
            output,
            "[00:01.000]<00:01.000>hai<00:02.000>\n[00:01.000]<00:01.000>hi<00:02.000>"
        );
    }
}
