use super::*;
use base64::Engine;

static KRC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<(\d+),(\d+),\d+>").unwrap());
static LYS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[([0-8])\]").unwrap());
static INLINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[((?:\d+:)*\d+(?:\.\d+)?)\]").unwrap());

pub(super) fn time(s: &str) -> Option<i64> {
    let s = s.trim();
    let value = if let Some(v) = s.strip_suffix("ms") {
        v.parse::<f64>().ok()?
    } else if let Some(v) = s.strip_suffix('s') {
        v.parse::<f64>().ok()? * 1000.
    } else {
        let mut n = 0.;
        for part in s.split(':') {
            n = n * 60. + part.parse::<f64>().ok()?;
        }
        n * 1000.
    };
    value
        .is_finite()
        .then_some(value.clamp(-3_600_000., 86_400_000.).round() as i64)
}
pub(super) fn inline_square(s: &str, offset: i64) -> Result<Line, String> {
    let tags: Vec<_> = INLINE.captures_iter(s).collect();
    let mut words = Vec::new();
    for (i, t) in tags.iter().enumerate() {
        let m = t.get(0).unwrap();
        let text = &s[m.end()
            ..tags
                .get(i + 1)
                .map_or(s.len(), |x| x.get(0).unwrap().start())];
        if text.is_empty() {
            continue;
        }
        let start = time(&t[1]).ok_or("invalid inline lyric time")? - offset;
        let end = tags
            .get(i + 1)
            .and_then(|n| time(&n[1]))
            .map_or(start + 3000, |n| n - offset);
        words.push(word(text, start, end, words.len()));
    }
    let start = words
        .first()
        .map_or(0, |w| (w.start_time * 1000.).round() as i64);
    let end = words
        .last()
        .map_or(start + 3000, |w| (w.end_time * 1000.).round() as i64);
    let text = words.iter().map(|w| w.text.as_str()).collect();
    Ok(line(text, start, end, words))
}
pub(super) fn netease_json(s: &str, offset: i64) -> Option<Line> {
    let v: serde_json::Value = serde_json::from_str(s).ok()?;
    let text = v
        .get("c")?
        .as_array()?
        .iter()
        .filter_map(|x| x["tx"].as_str())
        .collect::<String>();
    let start = v["t"].as_i64().unwrap_or(0) - offset;
    Some(line(text, start, start + 3000, vec![]))
}
fn krc(s: &str) -> Option<Line> {
    let h = HEADER.captures(s)?;
    let start = integer(&h[1]);
    let end = start + integer(&h[2]);
    let body = &s[h.get(0)?.end()..];
    let tags: Vec<_> = KRC.captures_iter(body).collect();
    let mut words = Vec::new();
    for (i, t) in tags.iter().enumerate() {
        let a = start + integer(&t[1]);
        let text = &body[t.get(0)?.end()
            ..tags
                .get(i + 1)
                .map_or(body.len(), |n| n.get(0).unwrap().start())];
        words.push(word(text, a, a + integer(&t[2]), i));
    }
    let text = words.iter().map(|w| w.text.as_str()).collect();
    let mut l = line(text, start, end, words);
    l.explicit_end = true;
    Some(l)
}
fn lys(s: &str) -> Option<Line> {
    let p = LYS.captures(s)?;
    let prop: usize = p[1].parse().ok()?;
    let body = &s[p.get(0)?.end()..];
    let mut words = Vec::new();
    let mut cursor = 0;
    for t in WORD.captures_iter(body) {
        let m = t.get(0)?;
        let start = integer(&t[1]);
        words.push(word(
            &body[cursor..m.start()],
            start,
            start + integer(&t[2]),
            words.len(),
        ));
        cursor = m.end();
    }
    if words.is_empty() {
        return None;
    }
    if cursor < body.len() {
        words.last_mut()?.text.push_str(&body[cursor..]);
    }
    let start = (words[0].start_time * 1000.).round() as i64;
    let end = (words.last()?.end_time * 1000.).round() as i64;
    let mut l = line(
        words.iter().map(|w| w.text.as_str()).collect(),
        start,
        end,
        words,
    );
    l.is_duet = prop % 3 == 2;
    l.is_bg = prop >= 6;
    l.structured = true;
    l.explicit_end = true;
    if prop < 3 && wraps(&l.lrc) {
        l.is_bg = true;
    }
    if l.is_bg && wraps(&l.lrc) {
        strip_edges(&mut l);
    }
    Some(l)
}
pub(super) fn wraps(s: &str) -> bool {
    let s = s.trim();
    s.starts_with(['(', '（']) && s.ends_with([')', '）'])
}
pub(super) fn strip_edges(l: &mut Line) {
    l.lrc = l
        .lrc
        .trim()
        .trim_start_matches(['(', '（'])
        .trim_end_matches([')', '）'])
        .to_owned();
    if let Some(w) = l.words.first_mut() {
        w.text = w
            .text
            .trim_start()
            .trim_start_matches(['(', '（'])
            .to_owned();
    }
    if let Some(w) = l.words.last_mut() {
        w.text = w.text.trim_end().trim_end_matches([')', '）']).to_owned();
    }
    l.words.retain(|w| !w.text.is_empty());
}
pub(super) fn compact_words(words: &mut Vec<Word>) {
    let mut out: Vec<Word> = Vec::new();
    let mut leading = String::new();
    for mut w in words.drain(..) {
        if w.text.trim().is_empty() {
            if let Some(last) = out.last_mut() {
                last.text.push_str(&w.text);
            } else {
                leading.push_str(&w.text);
            }
        } else {
            w.text = format!("{leading}{}", w.text);
            leading.clear();
            out.push(w);
        }
    }
    *words = out;
}
fn lqe(raw: &str) -> Result<Vec<Line>, String> {
    let mut primary = String::new();
    let mut trans = String::new();
    let mut roman = String::new();
    let mut section = "";
    for s in raw.lines() {
        if s.starts_with("[lyrics:") {
            section = "lyric";
            continue;
        }
        if s.starts_with("[translation:") {
            section = "trans";
            continue;
        }
        if s.starts_with("[pronunciation:") {
            section = "roman";
            continue;
        }
        let dest = match section {
            "lyric" => &mut primary,
            "trans" => &mut trans,
            "roman" => &mut roman,
            _ => continue,
        };
        dest.push_str(s);
        dest.push('\n');
    }
    let mut lines = parse(&primary)?;
    super::rules::merge(&mut lines, &parse(&trans)?, false);
    super::rules::merge(&mut lines, &parse(&roman)?, true);
    Ok(lines)
}
pub(super) fn parse(raw: &str) -> Result<Vec<Line>, String> {
    if raw.len() > 2 * 1024 * 1024 {
        return Err("lyric input limit exceeded".into());
    }
    let raw = raw
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let raw = raw
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n");
    if raw.trim().is_empty() {
        return Ok(vec![]);
    }
    if raw.trim_start().starts_with('<') && (raw.contains("<tt") || raw.contains(":tt")) {
        return super::ttml::parse(&raw);
    }
    if raw.contains("[Lyricify Quick Export]") {
        return lqe(&raw);
    }
    let lyl = raw.contains("[type:LyricifyLines]");
    let offset = OFFSET
        .captures(&raw)
        .and_then(|c| c[1].parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(-3_600_000, 3_600_000);
    let mut out = Vec::new();
    let mut language = None;
    for source in raw.lines() {
        let s = source.trim();
        if s.is_empty() {
            continue;
        }
        let body = HEADER
            .find(s)
            .or_else(|| STAMP.find(s))
            .map(|m| &s[m.end()..]);
        if body.is_some_and(|s| s.starts_with("//")) {
            continue;
        }
        if let Some(s) = s
            .strip_prefix("[language:")
            .and_then(|s| s.strip_suffix(']'))
        {
            language = Some(s.to_owned());
            continue;
        }
        let s = OFFSET.replace_all(s, "");
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        let mut parsed = if lyl {
            if let Some(h) = HEADER.captures(s) {
                let mut l = line(
                    s[h.get(0).unwrap().end()..].to_owned(),
                    integer(&h[1]),
                    integer(&h[2]),
                    vec![],
                );
                l.explicit_end = true;
                if wraps(&l.lrc) {
                    l.is_bg = true;
                    strip_edges(&mut l);
                }
                vec![l]
            } else {
                vec![]
            }
        } else if KRC.is_match(s) {
            krc(s).into_iter().collect()
        } else if LYS.is_match(s) {
            lys(s).into_iter().collect()
        } else if s.starts_with('{') {
            netease_json(s, 0).into_iter().collect()
        } else if s.starts_with('[') && INLINE.is_match(s) && !STAMP.is_match(s) {
            vec![inline_square(s, 0)?]
        } else if STAMP.is_match(s) && WORD.is_match(s) && !HEADER.is_match(s) {
            let st = STAMP.captures(s).unwrap();
            let start = stamp(&st);
            let body = &s[st.get(0).unwrap().end()..];
            let end = WORD
                .captures_iter(body)
                .map(|t| integer(&t[1]) + integer(&t[2]))
                .max()
                .unwrap_or(start + 3000);
            parse_basic(&format!("[{start},{}]{body}", (end - start).max(0)))?
        } else {
            parse_basic(s)?
        };
        for l in &mut parsed {
            shift(l, (offset as f64) / 1000.);
        }
        out.extend(parsed);
        if out.len() > 20_000 {
            return Err("lyric line limit exceeded".into());
        }
    }
    let has_timestamps = STAMP.is_match(&raw)
        || HEADER.is_match(raw.lines().find(|s| HEADER.is_match(s)).unwrap_or(""))
        || LYS.is_match(raw.lines().find(|s| LYS.is_match(s)).unwrap_or(""));
    if !has_timestamps && !raw.lines().any(|s| s.trim().starts_with('{')) {
        for (i, l) in out.iter_mut().enumerate() {
            l.time = i as f64 * 3.;
            l.end_time = l.time + 3.;
            l.explicit_end = true;
        }
    }
    out.sort_by(|a, b| a.time.total_cmp(&b.time));
    for l in &mut out {
        if let Some(json) = netease_json(&l.lrc, 0) {
            l.lrc = json.lrc;
        }
    }
    prune_blank_rows(&mut out);
    for i in 0..out.len() {
        if !out[i].explicit_end && !out[i].has_word_timeline {
            out[i].end_time = out
                .iter()
                .skip(i + 1)
                .find(|l| l.time > out[i].time + 0.03)
                .map_or(out[i].time + 3., |l| l.time);
        }
        out[i].index = i;
        out[i].duration = (out[i].end_time - out[i].time).max(0.);
    }
    if let Some(language) = language
        && let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(language)
        && let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes)
        && let Some(types) = v["content"].as_array()
    {
        for t in types {
            if let Some(rows) = t["lyricContent"].as_array() {
                for (i, row) in rows.iter().enumerate() {
                    if let Some(l) = out.get_mut(i) {
                        let strings: Vec<_> = row
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|x| x.as_str())
                            .collect();
                        if t["type"] == 1 {
                            l.translation = Some(strings.join(""));
                        } else {
                            l.romanization = Some(strings.join(" "));
                        }
                    }
                }
            }
        }
    }
    Ok(out)
}
fn prune_blank_rows(out: &mut Vec<Line>) {
    // Blank rows only terminate untimed vocals before a >=4s interlude.
    let Some(mut previous) = out.iter().position(|row| !row.lrc.trim().is_empty()) else {
        return;
    };
    let mut next = previous + 1;
    for index in previous + 1..out.len() {
        if !out[index].lrc.trim().is_empty() {
            previous = index;
            continue;
        }
        if out[previous].explicit_end
            || out[previous].has_word_timeline
            || !(out[index].time > out[previous].time)
        {
            continue;
        }
        if next <= index {
            next = index + 1;
            while next < out.len() && out[next].lrc.trim().is_empty() {
                next += 1;
            }
        }
        if out
            .get(next)
            .is_none_or(|row| row.time - out[index].time >= 4.)
        {
            out[previous].end_time = out[index].time;
            out[previous].explicit_end = true;
        }
    }
    out.retain(|row| !row.lrc.trim().is_empty());
}

pub(super) fn shift(l: &mut Line, delta: f64) {
    l.time += delta;
    l.end_time += delta;
    fn words(ws: &mut [Word], d: f64) {
        for w in ws {
            w.start_time += d;
            w.end_time += d;
            words(&mut w.ruby, d);
        }
    }
    words(&mut l.words, delta);
    words(&mut l.romanization_words, delta);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_prune_blank_rows(out: &mut Vec<Line>) {
        // Blank rows only terminate untimed vocals before a >=4s interlude.
        if out.iter().any(|l| !l.lrc.trim().is_empty()) {
            let mut meaningful: Vec<Line> = Vec::new();
            for (i, l) in out.iter().enumerate() {
                if !l.lrc.trim().is_empty() {
                    meaningful.push(l.clone());
                    continue;
                }
                if let Some(previous) = meaningful.last_mut() {
                    let next = out.iter().skip(i + 1).find(|l| !l.lrc.trim().is_empty());
                    if !previous.explicit_end
                        && !previous.has_word_timeline
                        && l.time > previous.time
                        && next.is_none_or(|n| n.time - l.time >= 4.)
                    {
                        previous.end_time = l.time;
                        previous.explicit_end = true;
                    }
                }
            }
            *out = meaningful;
        }
    }

    fn sample_row(time: f64, kind: usize) -> Line {
        let mut row = Line {
            time,
            end_time: time + 3.,
            duration: 3.,
            lrc: match kind % 5 {
                0 => String::new(),
                1 => " \t\u{3000}".into(),
                _ => "主唱 café 🎵".into(),
            },
            explicit_end: kind == 3,
            ..Default::default()
        };
        if kind == 4 {
            row.words = vec![word("主唱 café 🎵", 1000, 2000, 0)];
            row.words[0].ruby = vec![word("かな", 1000, 2000, 0)];
            row.words[0].roman_word = Some("kana".into());
            row.has_word_timeline = true;
            row.translation = Some("translation".into());
            row.romanization = Some("kana".into());
            row.is_bg = true;
        }
        row
    }

    #[test]
    fn blank_rows_preserve_empty_inputs_and_first_eligible_interlude() {
        for rows in [vec![], vec![sample_row(1., 0), sample_row(2., 1)]] {
            let mut actual = rows.clone();
            prune_blank_rows(&mut actual);
            assert_eq!(actual, rows);
        }
        for next_time in [5.999, 6., 6.001] {
            let rows = vec![
                sample_row(0., 1),
                sample_row(1., 2),
                sample_row(1., 0),
                sample_row(2., 1),
                sample_row(3., 0),
                sample_row(next_time, 2),
            ];
            let mut expected = rows.clone();
            reference_prune_blank_rows(&mut expected);
            let mut actual = rows;
            prune_blank_rows(&mut actual);
            assert_eq!(actual, expected);
            assert_eq!(actual.len(), 2);
            assert_eq!(actual[0].explicit_end, next_time >= 6.);
            assert_eq!(actual[0].end_time, if next_time >= 6. { 2. } else { 4. });
        }
        let mut trailing = vec![sample_row(1., 2), sample_row(2., 0), sample_row(3., 0)];
        prune_blank_rows(&mut trailing);
        assert_eq!(trailing.len(), 1);
        assert_eq!(trailing[0].end_time, 2.);
    }

    #[test]
    fn blank_row_compaction_matches_frozen_flow_with_rich_metadata() {
        for seed in 0..512usize {
            let mut state = seed + 1;
            let mut time = -3.;
            let rows: Vec<_> = (0..128)
                .map(|index| {
                    state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                    time += [0., 0.001, 0.03, 1., 4., 4.001][state % 6];
                    let mut row = sample_row(time, (state >> 8) % 5);
                    row.index = index;
                    row.structured = state % 3 == 0;
                    row.is_duet = state % 7 == 0;
                    row
                })
                .collect();
            let mut expected = rows.clone();
            reference_prune_blank_rows(&mut expected);
            let mut actual = rows;
            prune_blank_rows(&mut actual);
            assert_eq!(actual, expected, "seed={seed}");
        }
    }

    #[test]
    fn blank_row_compaction_reuses_owned_text_and_word_buffers() {
        let mut rows = vec![sample_row(0., 0), sample_row(1., 4), sample_row(2., 1)];
        let rows_buffer = rows.as_ptr();
        let text_buffer = rows[1].lrc.as_ptr();
        let words_buffer = rows[1].words.as_ptr();
        let ruby_buffer = rows[1].words[0].ruby.as_ptr();
        prune_blank_rows(&mut rows);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows.as_ptr(), rows_buffer);
        assert_eq!(rows[0].lrc.as_ptr(), text_buffer);
        assert_eq!(rows[0].words.as_ptr(), words_buffer);
        assert_eq!(rows[0].words[0].ruby.as_ptr(), ruby_buffer);
    }

    #[test]
    fn blank_rows_keep_parsed_timing_and_explicit_word_ends() {
        let rows = parse(
            "[00:00.00]\n[00:01.00]first\n[00:02.00]\n[00:03.00]\n[00:06.00]next\n[00:07.00]",
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].time, rows[0].end_time, rows[0].duration),
            (1., 2., 1.)
        );
        assert_eq!(
            (rows[1].time, rows[1].end_time, rows[1].duration),
            (6., 7., 1.)
        );
        assert_eq!((rows[0].index, rows[1].index), (0, 1));
        for raw in [
            "[1000,5000]explicit\n[00:02.00]\n[00:08.00]next",
            "[1000,5000]<0,5000,0>word\n[00:02.00]\n[00:08.00]next",
        ] {
            let rows = parse(raw).unwrap();
            assert_eq!(rows[0].end_time, 6.);
            assert_eq!(rows[0].duration, 5.);
        }
        assert_eq!(parse("[00:01.00]\n[00:02.00]").unwrap().len(), 2);
    }

    #[test]
    #[ignore = "manual host timing; no wall-clock assertions"]
    fn blank_row_compaction_measurement() {
        use std::hint::black_box;
        use std::time::{Duration, Instant};
        fn median(mut samples: Vec<Duration>) -> Duration {
            samples.sort_unstable();
            samples[samples.len() / 2]
        }
        for (count, rich) in [(1000, false), (10000, false), (10000, true)] {
            let mut rows = vec![sample_row(0., 2)];
            rows.extend((0..count).map(|index| {
                sample_row(
                    if rich { index as f64 } else { 1. },
                    if rich { 4 } else { 0 },
                )
            }));
            rows.push(sample_row(if rich { count as f64 } else { 2. }, 2));
            let mut expected = rows.clone();
            reference_prune_blank_rows(&mut expected);
            let mut actual = rows.clone();
            prune_blank_rows(&mut actual);
            assert_eq!(actual, expected);
            let mut reference_samples = Vec::new();
            let mut production_samples = Vec::new();
            for sample in 0..10 {
                for production in if sample % 2 == 0 {
                    [false, true]
                } else {
                    [true, false]
                } {
                    let mut input = rows.clone();
                    let started = Instant::now();
                    if production {
                        prune_blank_rows(&mut input);
                    } else {
                        reference_prune_blank_rows(&mut input);
                    }
                    let elapsed = started.elapsed();
                    black_box(&input);
                    if sample >= 3 {
                        if production {
                            production_samples.push(elapsed);
                        } else {
                            reference_samples.push(elapsed);
                        }
                    }
                }
            }
            eprintln!(
                "blank stage count={count} rich={rich}: reference={:?} production={:?}",
                median(reference_samples),
                median(production_samples)
            );
        }
        let raw = format!(
            "[00:00.00]first\n{}[00:02.00]next",
            "[00:01.00]\n".repeat(10000)
        );
        let mut samples = Vec::new();
        for sample in 0..10 {
            let started = Instant::now();
            let rows = parse(black_box(&raw)).unwrap();
            let elapsed = started.elapsed();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].end_time, 2.);
            black_box(rows);
            if sample >= 3 {
                samples.push(elapsed);
            }
        }
        eprintln!(
            "full text parser bytes={}: {:?}",
            raw.len(),
            median(samples)
        );
    }
}
