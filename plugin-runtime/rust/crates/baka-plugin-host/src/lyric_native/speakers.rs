use super::*;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

fn key(s: &str) -> String {
    s.nfkc()
        .filter(|c| !c.is_whitespace() && !"._·・'\"“”‘’-".contains(*c))
        .flat_map(char::to_lowercase)
        .collect()
}
fn artists(s: Option<&str>) -> Vec<String> {
    static SPLIT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\s*(?:,|，|、|/|&|;|；|\bfeat\.?\b|\bwith\b)\s*").unwrap()
    });
    SPLIT
        .split(s.unwrap_or(""))
        .map(key)
        .filter(|s| !s.is_empty())
        .collect()
}
fn artist_side(name: &str, artists: &[String]) -> Option<bool> {
    let name = key(name);
    if name.is_empty() {
        return None;
    }
    artists
        .iter()
        .position(|a| a.contains(&name) || name.contains(a))
        .map(|i| i > 0)
}
fn prefix(s: &str) -> Option<(&str, &str)> {
    if secondary::credit(s) {
        return None;
    }
    let (name, body) = s.split_once([':', '：'])?;
    if name.trim().is_empty()
        || name.trim().chars().count() > 24
        || name.chars().any(|c| "，,。.!！?？;；()[]（）".contains(c))
    {
        return None;
    }
    Some((name, body))
}
fn strip_words(words: &mut Vec<Word>, mut bytes: usize) {
    for w in words.iter_mut() {
        let cut = bytes.min(w.text.len());
        if !w.text.is_char_boundary(cut) {
            break;
        }
        w.text = w.text[cut..].into();
        bytes -= cut;
    }
    words.retain(|w| !w.text.is_empty());
}
fn strip_fields(l: &mut Line, name: &str) {
    for (field, words) in [
        (&mut l.translation, None),
        (&mut l.romanization, Some(&mut l.romanization_words)),
    ] {
        if let Some(s) = field
            && let Some((n, b)) = s.split_once([':', '：'])
            && key(n) == key(name)
        {
            let cut = s.len() - b.trim_start().len();
            if let Some(words) = words {
                strip_words(words, cut);
            }
            *s = b.trim_start().into();
        }
    }
}
fn prepend(l: &mut Line, marker: &Line) {
    let text = marker.lrc.trim();
    l.lrc = format!("{text}{}", l.lrc);
    if !marker.words.is_empty() {
        let mut words = marker.words.clone();
        words.append(&mut l.words);
        l.words = words;
    } else if let Some(first) = l.words.first() {
        l.words.insert(
            0,
            word(
                text,
                (marker.time * 1000.).round() as i64,
                (first.start_time.max(marker.time) * 1000.).round() as i64,
                0,
            ),
        );
    }
    if !l.explicit_end && !l.has_word_timeline && (l.end_time - l.time - 3.).abs() < 0.001 {
        l.end_time = marker.time + 3.;
    }
    l.time = marker.time;
    l.has_singer_label = true;
    l.has_word_timeline |= marker.has_word_timeline;
    if let Some(s) = &marker.translation {
        l.translation = Some(format!("{s}{}", l.translation.as_deref().unwrap_or("")));
    }
    if let Some(s) = &marker.romanization {
        l.romanization = Some(format!("{s}{}", l.romanization.as_deref().unwrap_or("")));
    }
    l.duration = (l.end_time - l.time).max(0.);
}
pub(super) fn repair_markers(lines: &mut Vec<Line>, artist: Option<&str>) {
    let artists = artists(artist);
    if artists.is_empty() {
        return;
    }
    let mut i = 0;
    while i < lines.len() {
        let marker = &lines[i];
        if marker.structured
            || marker.lrc.contains([':', '：'])
            || !artists.contains(&key(&marker.lrc))
        {
            i += 1;
            continue;
        }
        let next = (i + 1..lines.len()).find(|j| {
            lines[*j].time > marker.time + 0.03
                && !lines[*j].lrc.trim().is_empty()
                && !secondary::credit(&lines[*j].lrc)
                && !artists.contains(&key(&lines[*j].lrc))
        });
        let Some(next) = next else {
            i += 1;
            continue;
        };
        if marker.time <= 30. && lines[next].time - marker.time < 0.8 {
            i += 1;
            continue;
        }
        let same: Vec<_> = (i + 1..lines.len())
            .filter(|j| {
                (lines[*j].time - marker.time).abs() <= 0.03
                    && !artists.contains(&key(&lines[*j].lrc))
            })
            .collect();
        let translations: Vec<_> = same
            .iter()
            .copied()
            .filter(|j| secondary::east(&lines[*j].lrc) && !secondary::mostly_latin(&lines[*j].lrc))
            .collect();
        let target = same
            .iter()
            .copied()
            .find(|j| secondary::mostly_latin(&lines[*j].lrc))
            .unwrap_or(next);
        lines[i].lrc = format!("{}：", lines[i].lrc.trim());
        if translations.len() == 1 {
            let j = translations[0];
            lines[target].translation = Some(lines[j].lrc.trim().into());
            lines.remove(j);
        }
        i += 1;
    }
}
pub(super) fn parallel_markers(group: &mut Vec<Line>) {
    let mut i = 0;
    while i < group.len() {
        if prefix(&group[i].lrc).is_some_and(|(_, b)| b.trim().is_empty())
            && let Some(j) = (i + 1..group.len()).find(|j| {
                !group[*j].lrc.trim().is_empty()
                    && !secondary::credit(&group[*j].lrc)
                    && prefix(&group[*j].lrc).is_none()
            })
        {
            let marker = group[i].clone();
            prepend(&mut group[j], &marker);
            group.remove(i);
            continue;
        }
        i += 1;
    }
}
pub(super) fn apply(lines: &mut Vec<Line>, artist: Option<&str>, preserve: bool) {
    let artists = artists(artist);
    let mut counts = HashMap::new();
    let mut has_artist = false;
    for l in lines.iter() {
        if let Some((name, _)) = prefix(&l.lrc) {
            *counts.entry(key(name)).or_insert(0usize) += 1;
            has_artist |= artist_side(name, &artists).is_some();
        }
    }
    let (mut side, mut last) = (false, String::new());
    let mut sides: HashMap<String, bool> = HashMap::new();
    let mut pending = None;
    let mut out = Vec::new();
    for mut l in lines.drain(..) {
        if l.structured {
            out.push(l);
            continue;
        }
        let p = prefix(&l.lrc).map(|(a, b)| (a.to_owned(), b.to_owned()));
        if let Some((name, body)) = p {
            let k = key(&name);
            let explicit = k
                .strip_prefix('v')
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|v| *v > 0);
            let group = [
                "合", "合唱", "齐唱", "齊唱", "all", "chorus", "duet", "together",
            ]
            .contains(&k.as_str());
            let artist_side = artist_side(&name, &artists);
            if explicit.is_some()
                || artist_side.is_some()
                || has_artist && (group || counts.get(&k).copied().unwrap_or(0) >= 2)
            {
                side = if let Some(v) = explicit {
                    v > 1
                } else if group {
                    false
                } else {
                    let fallback = sides.values().any(|v| !*v);
                    *sides
                        .entry(k.clone())
                        .or_insert_with(|| artist_side.unwrap_or(fallback))
                };
                l.is_duet = side;
                l.has_singer_label = explicit.is_none();
                let keep = preserve && explicit.is_none() && last != k;
                last = if explicit.is_none() {
                    k.clone()
                } else {
                    String::new()
                };
                strip_fields(&mut l, &name);
                if keep && body.trim().is_empty() {
                    pending = Some(l);
                    continue;
                }
                if !keep {
                    let cut = l.lrc.len() - body.trim_start().len();
                    strip_words(&mut l.words, cut);
                    l.lrc = body.trim_start().into();
                }
                if explicit.is_none() && !group && artist_side.is_none() {
                    side = false;
                    last.clear();
                }
            } else {
                l.is_duet = false;
            }
        } else {
            l.is_duet = if secondary::credit(&l.lrc) {
                false
            } else {
                side
            };
            if !secondary::credit(&l.lrc)
                && let Some(marker) = pending.take()
            {
                prepend(&mut l, &marker);
            }
        }
        out.push(l);
    }
    *lines = out;
}
