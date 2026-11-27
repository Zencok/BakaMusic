//! Baka desktop text classification, parallel rows and secondary-field alignment.
use super::*;
use std::collections::HashSet;

static CREDIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:(?:作)?词|(?:作)?詞|曲|作曲|编曲|編曲|词曲|詞曲|原唱|演唱|歌手|制作(?:人)?|製作(?:人)?|出品|发行|發行|策划|策劃|统筹|統籌|监制|監製|导演|導演|混音|母带|母帶|录音|錄音|和声|和聲|翻唱|原曲|歌名|歌曲|专辑|專輯|标题|標題|调教|調教|调声|調聲|曲绘|曲繪|曲絵|绘图|繪圖|画师|畫師|视频|視頻|映像|动画|動畫|written\s+by|vocal|lyrics?|lyricist|composer|music|arrange(?:r|ment)?|producer|produced\s+by|mix|master(?:ing)?|recording|staff|pv|mv|movie|video|animation|illustration|illustrator)\s*[:：]").unwrap()
});
static LATIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[a-z\u{00c0}-\u{024f}]+").unwrap());
static HINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:shi|chi|tsu|kyo|kyu|kya|ryo|ryu|rya|sho|shu|sha|cho|chu|cha|jyo|jyu|jya|dzu|desu|boku|kimi|kono|sono|ano|yume|sora|kokoro|namida|hikari|kaze|hana|machi|sekai|mirai|hoshi|koe|uta|sarang|hae)").unwrap()
});
pub(super) fn scripts(s: &str) -> (usize, usize, usize) {
    let (mut han, mut kana, mut latin) = (0, 0, 0);
    for c in s.chars() {
        match c {
            '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}' => han += 1,
            '\u{3040}'..='\u{30ff}' | '\u{31f0}'..='\u{31ff}' | '\u{ac00}'..='\u{d7af}' => {
                kana += 1
            }
            'A'..='Z' | 'a'..='z' | '\u{00c0}'..='\u{024f}' => latin += 1,
            _ => (),
        }
    }
    (han, kana, latin)
}
pub(super) fn east(s: &str) -> bool {
    let (h, k, _) = scripts(s);
    h + k > 0
}
pub(super) fn mostly_latin(s: &str) -> bool {
    let (h, k, l) = scripts(s);
    l > 0 && l as f64 / (h + k + l) as f64 >= 0.65
}
fn latin_words(s: &str) -> Vec<String> {
    LATIN
        .find_iter(&s.to_lowercase())
        .map(|m| m.as_str().to_owned())
        .collect()
}
pub(super) fn credit_roman(s: &str) -> bool {
    let Some((prefix, _)) = s.split_once([':', '：']) else {
        return false;
    };
    if CREDIT.is_match(s.trim()) {
        return false;
    }
    [
        "shi",
        "ci",
        "zuo ci",
        "saku shi",
        "sakushi",
        "kyo ku",
        "kyoku",
        "qu",
        "zuo qu",
        "sa kyo ku",
        "sa k kyo ku",
        "sa kkyoku",
        "sakkyoku",
        "he n kyo ku",
        "he n kyoku",
        "hen kyo ku",
        "henkyoku",
        "bian qu",
    ]
    .contains(&latin_words(prefix).join(" ").as_str())
}
pub(super) fn credit(s: &str) -> bool {
    CREDIT.is_match(s.trim()) || credit_roman(s)
}
pub(super) fn roman(s: &str) -> bool {
    let words = latin_words(s);
    if words.is_empty() {
        return false;
    }
    let english = [
        "a", "an", "and", "are", "be", "but", "for", "from", "hello", "i", "in", "is", "it",
        "love", "me", "my", "of", "on", "that", "the", "this", "to", "we", "with", "world", "you",
        "your",
    ];
    if words
        .iter()
        .filter(|w| english.contains(&w.as_str()))
        .count()
        >= (words.len() as f64 * 0.35).ceil().max(1.) as usize
    {
        return false;
    }
    let specials = [
        "zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "yin", "ying", "wu", "yu", "yue",
        "yuan", "yun", "ye", "yao", "you", "yang", "yong", "wa", "wo", "wai", "wei", "wan", "wen",
        "wang", "weng",
    ];
    let finals = [
        "a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "i", "ia", "ie",
        "iao", "iu", "ian", "in", "iang", "ing", "iong", "u", "ua", "uo", "uai", "ui", "uan", "un",
        "uang", "ue", "ve", "er",
    ];
    let count = words
        .iter()
        .filter(|w| {
            if specials.contains(&w.as_str()) {
                return true;
            }
            let rest = [
                "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch",
                "sh", "r", "z", "c", "s",
            ]
            .iter()
            .find_map(|p| w.strip_prefix(p))
            .unwrap_or(w);
            finals.contains(&rest)
        })
        .count();
    count as f64 / words.len() as f64 >= 0.75 || HINT.is_match(s)
}
fn receive(l: &Line) -> bool {
    !l.lrc.trim().is_empty() && !l.is_bg && !l.is_duet_partner && !credit(&l.lrc)
}
fn meaningful(l: &Line) -> bool {
    !l.lrc.trim().is_empty() && l.lrc.trim() != "//"
}
fn append(dst: &mut Option<String>, s: &str) {
    let s = s.trim();
    if s.is_empty() {
        return;
    }
    if let Some(v) = dst {
        if v != s {
            v.push('\n');
            v.push_str(s);
        }
    } else {
        *dst = Some(s.to_owned());
    }
}
fn suffix(l: &mut Line, translation: &str) {
    let text = l.lrc.trim();
    let translation = translation.trim();
    if !translation.is_empty()
        && text.len() > translation.len()
        && let Some(main) = text.strip_suffix(translation)
        && scripts(main).1 > 0
        && scripts(translation).0 > 0
    {
        l.lrc = main.trim().into();
    }
}
fn assign(l: &mut Line, s: &Line, roman: bool, overwrite: bool) {
    let mut text = s.lrc.trim().to_owned();
    if overwrite && !formats::wraps(&l.lrc) && formats::wraps(&text) {
        text = text
            .chars()
            .skip(1)
            .take(text.chars().count() - 2)
            .collect::<String>()
            .trim()
            .into();
    }
    if !roman {
        suffix(l, &text);
    }
    let field = if roman {
        &mut l.romanization
    } else {
        &mut l.translation
    };
    if overwrite {
        *field = Some(text);
    } else {
        append(field, &text);
    }
    if roman && (overwrite || !s.words.is_empty()) {
        l.romanization_words = s.words.clone();
        l.has_romanization_word_timeline = s.has_word_timeline;
    }
}
fn main_index(group: &[Line]) -> usize {
    if group.len() >= 3
        && mostly_latin(&group[0].lrc)
        && group[0].words.len() > 1
        && let Some(i) = group
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, l)| scripts(&l.lrc).1 > 0 && l.words.len() > 1)
            .map(|(i, _)| i)
    {
        return i;
    }
    if group.len() >= 3 && roman(&group[0].lrc) && east(&group[1].lrc) {
        return 1;
    }
    0
}
fn collapse_content(group: &[Line]) -> Line {
    let index = main_index(group);
    let mut main = group[index].clone();
    for (i, l) in group.iter().enumerate() {
        if i == index {
            continue;
        }
        let is_roman =
            east(&main.lrc) && mostly_latin(&l.lrc) && (l.has_word_timeline || roman(&l.lrc));
        assign(&mut main, l, is_roman, false);
    }
    main
}
pub(super) fn collapse(lines: &mut Vec<Line>) {
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let mut end = i + 1;
        while end < lines.len() && (lines[end].time - lines[i].time).abs() <= 0.03 {
            end += 1;
        }
        let mut group = lines[i..end].to_vec();
        speakers::parallel_markers(&mut group);
        let group = group.as_slice();
        if group.iter().any(|l| l.structured) {
            out.extend_from_slice(group);
            i = end;
            continue;
        }
        let mut credits = Vec::new();
        let mut content = Vec::new();
        let mut j = 0;
        for l in group {
            if meaningful(l) && !credit(&l.lrc) {
                content.push(l.clone());
            }
        }
        let selected = if content.is_empty() {
            None
        } else {
            Some(content[main_index(&content)].index)
        };
        let merged = if content.is_empty() {
            None
        } else {
            Some(collapse_content(&content))
        };
        let mut inserted = false;
        while j < group.len() {
            let l = &group[j];
            if credit(&l.lrc) {
                if j + 1 < group.len()
                    && credit(&group[j + 1].lrc)
                    && credit_roman(&l.lrc) != credit_roman(&group[j + 1].lrc)
                {
                    let (base, r) = if credit_roman(&l.lrc) {
                        (&group[j + 1], l)
                    } else {
                        (l, &group[j + 1])
                    };
                    let mut base = base.clone();
                    assign(&mut base, r, true, false);
                    credits.push(base);
                    j += 2;
                    continue;
                }
                credits.push(l.clone());
            } else if !inserted && Some(l.index) == selected {
                credits.push(merged.clone().unwrap());
                inserted = true;
            }
            j += 1;
        }
        out.extend(credits);
        i = end;
    }
    *lines = out;
    // A translation sharing a credit timestamp belongs to the following English row.
    let mut i = 0;
    while i < lines.len() {
        if !lines[i].has_word_timeline
            && !credit(&lines[i].lrc)
            && east(&lines[i].lrc)
            && lines
                .iter()
                .any(|l| credit(&l.lrc) && (l.time - lines[i].time).abs() <= 0.03)
            && let Some(j) = (i + 1..lines.len()).find(|j| receive(&lines[*j]))
        {
            let diff = lines[j].time - lines[i].time;
            let next = (j + 1..lines.len()).find(|k| receive(&lines[*k]));
            if diff > 0.03
                && diff <= 1.
                && mostly_latin(&lines[j].lrc)
                && lines[j].translation.is_none()
                && next.is_some_and(|k| mostly_latin(&lines[k].lrc))
            {
                lines[j].translation = Some(lines[i].lrc.trim().into());
                lines.remove(i);
                continue;
            }
        }
        i += 1;
    }
}
pub(super) fn merge(base: &mut [Line], source: &[Line], roman: bool) {
    let source: Vec<_> = source
        .iter()
        .filter(|l| meaningful(l) && !credit(&l.lrc))
        .collect();
    let (mut bi, mut si) = (0, 0);
    let mut mb = HashSet::new();
    let mut ms = HashSet::new();
    let mut anchor = None;
    while bi < base.len() && si < source.len() {
        if !receive(&base[bi]) {
            bi += 1;
            continue;
        }
        let diff = source[si].time - base[bi].time;
        if diff.abs() <= 0.3 {
            assign(&mut base[bi], source[si], roman, true);
            mb.insert(bi);
            ms.insert(si);
            anchor.get_or_insert((bi, si));
            bi += 1;
            si += 1;
        } else if diff < 0. {
            si += 1;
        } else {
            bi += 1;
        }
    }
    if anchor.is_none() {
        let mut best = f64::INFINITY;
        for (i, l) in base.iter().take(5).enumerate().filter(|(_, l)| receive(l)) {
            let tolerance = if l.duration > 0. {
                (l.duration * 0.4).clamp(0.3, 1.)
            } else {
                1.
            };
            for (j, s) in source.iter().take(5).enumerate() {
                let diff = (l.time - s.time).abs();
                if diff <= tolerance && diff < best {
                    best = diff;
                    anchor = Some((i, j));
                }
            }
        }
    }
    if let Some((a, b)) = anchor {
        for direction in [-1isize, 1] {
            let (mut i, mut j) = if direction < 0 {
                (a as isize - 1, b as isize - 1)
            } else {
                (a as isize, b as isize)
            };
            while i >= 0 && j >= 0 && (i as usize) < base.len() && (j as usize) < source.len() {
                let (x, y) = (i as usize, j as usize);
                if !receive(&base[x]) {
                    i += direction;
                    continue;
                }
                let empty = if roman {
                    base[x].romanization.as_deref()
                } else {
                    base[x].translation.as_deref()
                }
                .is_none_or(|s| s.trim().is_empty());
                if !mb.contains(&x) && !ms.contains(&y) && empty {
                    assign(&mut base[x], source[y], roman, true);
                    mb.insert(x);
                    ms.insert(y);
                }
                i += direction;
                j += direction;
            }
        }
    }
}

pub(super) fn alternating(lines: &mut Vec<Line>) {
    fn direction(a: &Line, b: &Line) -> Option<bool> {
        if a.lrc.trim().is_empty() || b.lrc.trim().is_empty() || credit(&a.lrc) || credit(&b.lrc) {
            return None;
        }
        let (ah, ak, _) = scripts(&a.lrc);
        let (bh, bk, _) = scripts(&b.lrc);
        if ak > 0 && bh > 0 && bk == 0 {
            Some(false)
        } else if bk > 0 && ah > 0 && ak == 0 {
            Some(true)
        } else if mostly_latin(&a.lrc) && east(&b.lrc) && !mostly_latin(&b.lrc) {
            Some(false)
        } else if mostly_latin(&b.lrc) && east(&a.lrc) && !mostly_latin(&a.lrc) {
            Some(true)
        } else {
            None
        }
    }
    fn regular(a: &Line, b: &Line, c: &Line) -> bool {
        let x = b.time - a.time;
        let y = c.time - b.time;
        x > 0.03 && y > 0.03 && (x - y).abs() <= 0.25f64.max(x.min(y) * 0.15)
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let d = if i + 3 < lines.len() {
            direction(&lines[i], &lines[i + 1])
        } else {
            None
        };
        if d.is_some()
            && d == direction(&lines[i + 2], &lines[i + 3])
            && regular(&lines[i], &lines[i + 1], &lines[i + 2])
        {
            let start = i;
            while i + 1 < lines.len()
                && direction(&lines[i], &lines[i + 1]) == d
                && (i == start || regular(&lines[i - 2], &lines[i - 1], &lines[i]))
            {
                let (a, b) = if d == Some(true) {
                    (i + 1, i)
                } else {
                    (i, i + 1)
                };
                let mut l = lines[a].clone();
                l.translation = Some(lines[b].lrc.trim().into());
                out.push(l);
                i += 2;
            }
        } else {
            out.push(lines[i].clone());
            i += 1;
        }
    }
    *lines = out;
}

/// Exported A2 files can retain a romanization's original (credit-colliding)
/// timestamp after the three source streams have been flattened into one.
pub(super) fn repair_exported_romanization(lines: &mut Vec<Line>) {
    let mut i = 0;
    while i < lines.len() {
        let l = &lines[i];
        if l.has_word_timeline
            || !mostly_latin(&l.lrc)
            || !roman(&l.lrc)
            || credit(&l.lrc)
            || l.translation.is_some()
            || l.romanization.is_some()
            || !lines
                .iter()
                .any(|c| credit(&c.lrc) && (c.time - l.time).abs() <= 0.03)
        {
            i += 1;
            continue;
        }
        let target =
            (i + 1..lines.len()).find(|j| receive(&lines[*j]) && !mostly_latin(&lines[*j].lrc));
        let Some(j) = target else {
            i += 1;
            continue;
        };
        let next = (j + 1..lines.len()).find(|k| receive(&lines[*k]));
        let dt = lines[j].time - l.time;
        if dt > 0.03
            && dt <= 0.3
            && scripts(&lines[j].lrc).1 > 0
            && lines[j].has_word_timeline
            && lines[j].romanization.is_none()
            && next.is_some_and(|k| lines[k].romanization.is_some())
        {
            lines[j].romanization = Some(l.lrc.trim().into());
            lines.remove(i);
            continue;
        }
        i += 1;
    }
    for (i, l) in lines.iter_mut().enumerate() {
        l.index = i;
    }
}
