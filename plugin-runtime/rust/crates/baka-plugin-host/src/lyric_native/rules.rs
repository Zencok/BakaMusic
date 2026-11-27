use super::*;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;
fn key(s: &str) -> String {
    s.nfkc()
        .filter(|c| !c.is_whitespace() && !"._·・'\"“”‘’-—–/:：,，、()[]（）《》「」".contains(*c))
        .flat_map(char::to_lowercase)
        .collect()
}
fn credit(s: &str) -> bool {
    secondary::credit(s)
}
pub(super) fn normalize(lines: &mut Vec<Line>, artist: Option<&str>) {
    speakers::repair_markers(lines, artist);
    secondary::collapse(lines);
    speakers::apply(lines, artist, true);
}
fn strip_prefix(words: &mut Vec<Word>, mut bytes: usize) {
    for w in words.iter_mut() {
        let cut = bytes.min(w.text.len());
        if w.text.is_char_boundary(cut) {
            w.text = w.text[cut..].to_owned();
            bytes -= cut;
        } else {
            break;
        }
    }
    words.retain(|w| !w.text.is_empty());
}
pub(super) fn merge(lines: &mut [Line], source: &[Line], roman: bool) {
    secondary::merge(lines, source, roman);
}
pub(super) fn finish(lines: &mut Vec<Line>, artist: Option<&str>) {
    let duet = artist
        .unwrap_or("")
        .split([',', '，', '、', '/', '&', ';', '；'])
        .filter(|s| !s.trim().is_empty())
        .count()
        > 1;
    if duet {
        // Match Baka's conservative opening-dialogue inference: multiple artists
        // alone are insufficient evidence to alternate every lyric line.
        let has_layout = lines.iter().any(|l| {
            l.structured
                || l.has_singer_label
                || l.is_duet
                || l.lrc.contains(['(', ')', '（', '）'])
        });
        let opening_questions = lines
            .iter()
            .filter(|l| !credit(&l.lrc) && !l.lrc.contains([':', '：']))
            .take(10)
            .filter(|l| l.lrc.contains(['?', '？']))
            .count();
        if !has_layout && opening_questions >= 2 {
            let mut previous: Option<(f64, bool)> = None;
            let mut side = false;
            for l in lines.iter_mut() {
                if credit(&l.lrc) || l.lrc.trim().is_empty() || l.lrc.contains([':', '：']) {
                    continue;
                }
                if let Some((end, timed)) = previous
                    && (!timed || !l.has_word_timeline || l.time - end > 0.12)
                {
                    side = !side;
                }
                l.is_duet = side;
                previous = Some((l.end_time, l.has_word_timeline));
            }
        }
        // Recognize bounded cross-line parentheses before considering inline pairs.
        let mut i = 0;
        while i < lines.len() {
            let text = lines[i].lrc.trim();
            let open = text.chars().filter(|c| matches!(c, '(' | '（')).count();
            let close = text.chars().filter(|c| matches!(c, ')' | '）')).count();
            if !lines[i].structured && text.starts_with(['(', '（']) && open > close {
                let mut depth = 0i32;
                let mut end = None;
                for (j, l) in lines.iter().enumerate().skip(i).take(8) {
                    if credit(&l.lrc) {
                        break;
                    }
                    for c in l.lrc.chars() {
                        if c == '(' || c == '（' {
                            depth += 1;
                        }
                        if c == ')' || c == '）' {
                            depth -= 1;
                        }
                    }
                    if depth <= 0 && l.lrc.trim().ends_with([')', '）']) {
                        end = Some(j);
                        break;
                    }
                }
                if let Some(j) = end {
                    for l in &mut lines[i..=j] {
                        l.is_duet = true;
                        l.is_bg = false;
                    }
                    let old = lines[i].lrc.clone();
                    let new = old.trim_start().trim_start_matches(['(', '（']).to_owned();
                    strip_prefix(&mut lines[i].words, old.len() - new.len());
                    lines[i].lrc = new;
                    lines[j].lrc = lines[j]
                        .lrc
                        .trim_end()
                        .trim_end_matches([')', '）'])
                        .to_owned();
                    if let Some(w) = lines[j].words.last_mut() {
                        w.text = w.text.trim_end().trim_end_matches([')', '）']).to_owned();
                    }
                    i = j;
                }
            }
            i += 1;
        }
        let pair = Regex::new(r"[（(]([^()（）]+)[)）]").unwrap();
        let has_speaker_layout = lines.iter().any(|l| l.has_singer_label);
        let mut expanded = Vec::new();
        for mut l in lines.drain(..) {
            if l.structured || credit(&l.lrc) || (has_speaker_layout && !l.has_singer_label) {
                expanded.push(l);
                continue;
            }
            if formats::wraps(&l.lrc) {
                formats::strip_edges(&mut l);
                l.is_duet = !l.is_duet;
                l.is_bg = false;
                if l.romanization.as_deref().is_some_and(formats::wraps) {
                    if let Some(w) = l.romanization_words.first_mut() {
                        w.text = w.text.trim_start_matches(['(', '（']).into();
                    }
                    if let Some(w) = l.romanization_words.last_mut() {
                        w.text = w.text.trim_end().trim_end_matches([')', '）']).into();
                    }
                    formats::compact_words(&mut l.romanization_words);
                }
                for field in [&mut l.translation, &mut l.romanization] {
                    if let Some(v) = field
                        && formats::wraps(v)
                    {
                        *v = v
                            .trim()
                            .trim_start_matches(['(', '（'])
                            .trim_end_matches([')', '）'])
                            .to_owned();
                    }
                }
                expanded.push(l);
                continue;
            }
            let matches: Vec<_> = pair
                .captures_iter(&l.lrc)
                .filter(|c| {
                    !c[1]
                        .chars()
                        .any(|c| matches!(c,'\u{3040}'..='\u{30ff}'|'\u{ac00}'..='\u{d7af}'))
                })
                .collect();
            if matches.is_empty() {
                expanded.push(l);
                continue;
            }
            let synthesized = l.words.is_empty();
            if synthesized {
                let count = l.lrc.chars().count();
                let duration = (l.end_time - l.time).max(0.1) / count as f64;
                l.words = l
                    .lrc
                    .chars()
                    .enumerate()
                    .map(|(i, c)| Word {
                        text: c.to_string(),
                        start_time: l.time + i as f64 * duration,
                        end_time: l.time + (i + 1) as f64 * duration,
                        duration,
                        index: i,
                        ..Default::default()
                    })
                    .collect();
            }
            let ranges: Vec<_> = matches
                .iter()
                .map(|c| (c.get(0).unwrap().range(), c.get(1).unwrap().range()))
                .collect();
            let mut partner = l.clone();
            partner.is_duet = !l.is_duet;
            partner.is_duet_partner = true;
            partner.is_bg = false;
            partner.lrc = matches
                .iter()
                .map(|c| c[1].trim())
                .collect::<Vec<_>>()
                .join(" ");
            let mut main = String::new();
            let mut cursor = 0;
            for (full, _) in &ranges {
                main.push_str(&l.lrc[cursor..full.start]);
                cursor = full.end;
            }
            main.push_str(&l.lrc[cursor..]);
            let mut main_words = Vec::new();
            let mut duet_words = Vec::new();
            let mut pos = 0;
            for w in &l.words {
                let start = l.lrc[pos..].find(&w.text).map(|n| pos + n);
                if let Some(start) = start {
                    let mut a = String::new();
                    let mut b = String::new();
                    let (mut ar, mut br) = (Vec::new(), Vec::new());
                    for (char_index, (off, c)) in w.text.char_indices().enumerate() {
                        let at = start + off;
                        if ranges.iter().any(|(_, r)| r.contains(&at)) {
                            b.push(c);
                            br.push(char_index);
                        } else if !ranges.iter().any(|(r, _)| r.contains(&at)) {
                            a.push(c);
                            ar.push(char_index);
                        }
                    }
                    if !a.is_empty() {
                        let mut n = w.clone();
                        n.text = a;
                        let unit = (w.end_time - w.start_time) / w.text.chars().count() as f64;
                        n.start_time = w.start_time + ar[0] as f64 * unit;
                        n.end_time = w.start_time + (ar.last().unwrap() + 1) as f64 * unit;
                        main_words.push(n);
                    }
                    if !b.is_empty() {
                        let mut n = w.clone();
                        n.text = b;
                        let unit = (w.end_time - w.start_time) / w.text.chars().count() as f64;
                        n.start_time = w.start_time + br[0] as f64 * unit;
                        n.end_time = w.start_time + (br.last().unwrap() + 1) as f64 * unit;
                        duet_words.push(n);
                    }
                    pos = start + w.text.len();
                }
            }
            if synthesized {
                for words in [&mut main_words, &mut duet_words] {
                    let mut merged: Vec<Word> = Vec::new();
                    for w in words.drain(..) {
                        if let Some(previous) = merged.last_mut()
                            && (previous.end_time - w.start_time).abs() < 0.000001
                        {
                            previous.text.push_str(&w.text);
                            previous.end_time = w.end_time;
                            previous.duration = previous.end_time - previous.start_time;
                            continue;
                        }
                        merged.push(w);
                    }
                    *words = merged;
                }
            }
            l.lrc = main.split_whitespace().collect::<Vec<_>>().join(" ");
            l.words = main_words;
            l.has_word_timeline = !l.words.is_empty();
            partner.words = duet_words;
            partner.has_word_timeline = !partner.words.is_empty();
            for (own, other) in [
                (&mut l.translation, &mut partner.translation),
                (&mut l.romanization, &mut partner.romanization),
            ] {
                if let Some(text) = own.clone() {
                    let captures: Vec<_> = pair
                        .captures_iter(&text)
                        .filter(|c| {
                            !c[1].trim().is_empty()
                                && (c.get(0).unwrap().as_str().trim() == text.trim()
                                    || !c[1].chars().any(|ch| {
                                        matches!(
                                            ch,
                                            '\u{3040}'..='\u{30ff}' | '\u{ac00}'..='\u{d7af}'
                                        )
                                    }))
                        })
                        .collect();
                    if captures.is_empty() {
                        *other = None;
                    } else {
                        *other = Some(
                            captures
                                .iter()
                                .map(|c| c[1].trim())
                                .collect::<Vec<_>>()
                                .join(" "),
                        );
                        let mut main = String::new();
                        let mut cursor = 0;
                        for capture in &captures {
                            let range = capture.get(0).unwrap();
                            main.push_str(&text[cursor..range.start()]);
                            cursor = range.end();
                        }
                        main.push_str(&text[cursor..]);
                        *own = Some(main.split_whitespace().collect::<Vec<_>>().join(" "));
                    }
                }
            }
            expanded.push(l);
            expanded.push(partner);
        }
        *lines = expanded;
    }
    // Repair a repeated translated English anchor accidentally attached to a Chinese row.
    for i in 0..lines.len() {
        let Some(t) = lines[i].translation.clone() else {
            continue;
        };
        let source_text = lines[i]
            .lrc
            .split_once([':', '：'])
            .map_or(lines[i].lrc.as_str(), |(_, b)| b);
        let (han, kana, _) = secondary::scripts(source_text);
        if han == 0
            || kana > 0
            || secondary::mostly_latin(source_text)
            || secondary::scripts(&t).0 == 0
            || secondary::mostly_latin(&t)
        {
            continue;
        }
        let previous = (i.saturating_sub(8)..i).rev().find(|j| {
            secondary::mostly_latin(&lines[*j].lrc)
                && lines[*j]
                    .translation
                    .as_ref()
                    .is_some_and(|s| key(s) == key(&t))
                && lines[i].time - lines[*j].time <= 6.
        });
        if let Some(j) = previous {
            let original = key(lines[j]
                .lrc
                .split_once([':', '：'])
                .map_or(lines[j].lrc.as_str(), |(_, b)| b));
            if let Some(k) = (i + 1..lines.len()).find(|k| {
                lines[*k].translation.is_none()
                    && key(lines[*k]
                        .lrc
                        .split_once([':', '：'])
                        .map_or(lines[*k].lrc.as_str(), |(_, b)| b))
                        == original
            }) {
                lines[k].translation = Some(t);
                lines[i].translation = None;
            }
        }
    }
    let mut repeated = HashMap::new();
    for l in lines.iter() {
        if let Some(r) = l.romanization.as_deref().filter(|r| !r.trim().is_empty()) {
            let k = key(&l.lrc);
            if !k.is_empty() {
                repeated.entry(k).or_insert_with(|| r.trim().to_owned());
            }
        }
    }
    for (i, l) in lines.iter_mut().enumerate() {
        l.index = i;
        l.duration = (l.end_time - l.time).max(0.);
        if l.romanization.is_none() {
            l.romanization = repeated.get(&key(&l.lrc)).cloned();
        }
        if l.is_duet || l.is_bg || l.is_duet_partner {
            if let Some(old) = l.romanization.clone() {
                let leading = !l.lrc.trim().starts_with(['(', '（'])
                    && old.trim_start().starts_with(['(', '（']);
                let trailing =
                    !l.lrc.trim().ends_with([')', '）']) && old.trim_end().ends_with([')', '）']);
                if leading {
                    let new = old
                        .trim_start()
                        .trim_start_matches(['(', '（'])
                        .trim_start();
                    strip_prefix(&mut l.romanization_words, old.len() - new.len());
                }
                if trailing {
                    let mut bytes = old.len()
                        - old
                            .trim_end()
                            .trim_end_matches([')', '）'])
                            .trim_end()
                            .len();
                    for w in l.romanization_words.iter_mut().rev() {
                        let cut = bytes.min(w.text.len());
                        if !w.text.is_char_boundary(w.text.len() - cut) {
                            break;
                        }
                        w.text.truncate(w.text.len() - cut);
                        bytes -= cut;
                    }
                }
            }
            for s in [&mut l.translation, &mut l.romanization]
                .into_iter()
                .flatten()
            {
                if !l.lrc.trim().starts_with(['(', '（']) {
                    *s = s
                        .trim_start()
                        .trim_start_matches(['(', '（'])
                        .trim_start()
                        .into();
                }
                if !l.lrc.trim().ends_with([')', '）']) {
                    *s = s.trim_end().trim_end_matches([')', '）']).trim_end().into();
                }
            }
        }
        l.words.retain(|w| !w.text.is_empty());
        l.romanization_words.retain(|w| !w.text.is_empty());
        for (j, w) in l.words.iter_mut().enumerate() {
            w.index = j;
            w.duration = (w.end_time - w.start_time).max(0.);
        }
    }
}
