use super::*;
use std::collections::{BTreeMap, HashMap};
use xml::reader::{EventReader, XmlEvent};
#[derive(Default)]
struct Node {
    name: String,
    attrs: BTreeMap<String, String>,
    children: Vec<Node>,
    text: String,
}
impl Node {
    fn attr(&self, k: &str) -> Option<&str> {
        self.attrs.get(k).map(String::as_str)
    }
    fn all_text(&self) -> String {
        if self.name == "#text" {
            return self.text.clone();
        }
        self.children.iter().map(Node::all_text).collect()
    }
    fn descendants<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        for n in &self.children {
            if n.name == name {
                out.push(n);
            }
            n.descendants(name, out);
        }
    }
}
fn document(raw: &str) -> Result<Node, String> {
    // No external entity fetching; reject DTDs rather than expand untrusted entities.
    if raw.contains("<!DOCTYPE") || raw.contains("<!ENTITY") {
        return Err("TTML DTD is not supported".into());
    }
    let mut stack = vec![Node::default()];
    let mut count = 0;
    for event in EventReader::from_str(raw) {
        match event.map_err(|e| format!("TTML: {e}"))? {
            XmlEvent::StartElement {
                name, attributes, ..
            } => {
                count += 1;
                if count > 100_000 || stack.len() > 128 {
                    return Err("TTML structure limit exceeded".into());
                }
                stack.push(Node {
                    name: name.local_name,
                    attrs: attributes
                        .into_iter()
                        .map(|a| (a.name.local_name, a.value))
                        .collect(),
                    ..Default::default()
                });
            }
            XmlEvent::Characters(text) | XmlEvent::CData(text) | XmlEvent::Whitespace(text) => {
                stack.last_mut().unwrap().children.push(Node {
                    name: "#text".into(),
                    text,
                    ..Default::default()
                });
            }
            XmlEvent::EndElement { .. } => {
                let n = stack.pop().ok_or("TTML unbalanced tree")?;
                stack
                    .last_mut()
                    .ok_or("TTML missing root")?
                    .children
                    .push(n);
            }
            _ => {}
        }
    }
    stack.pop().ok_or("TTML missing document".into())
}
fn clean(s: &str) -> String {
    if s.contains(['\n', '\r', '\t']) {
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        s.to_owned()
    }
}
fn interval(n: &Node, parent: (i64, i64)) -> (i64, i64) {
    let a = n.attr("begin").and_then(formats::time).unwrap_or(parent.0);
    let b = n
        .attr("end")
        .and_then(formats::time)
        .or_else(|| n.attr("dur").and_then(formats::time).map(|d| a + d))
        .unwrap_or(parent.1);
    (a, b.max(a))
}
fn contents(n: &Node, l: &mut Line, bg: &mut Vec<Line>, range: (i64, i64)) {
    for child in &n.children {
        if child.name == "#text" {
            if child.text.contains('\n') && child.text.trim().is_empty() {
                continue;
            }
            let text = clean(&child.text);
            l.lrc.push_str(&text);
            if text.trim().is_empty()
                && let Some(w) = l.words.last_mut()
            {
                w.text.push_str(&text);
            }
            continue;
        }
        let role = child.attr("role").unwrap_or("");
        if role == "x-bg" {
            let mut b = parse_line(child, range).0;
            b.is_bg = true;
            b.is_duet = l.is_duet;
            formats::strip_edges(&mut b);
            bg.push(b);
            continue;
        }
        if role == "x-translation" || role == "x-roman" || role == "x-romanization" {
            let (sub, _) = parse_line(child, range);
            if role == "x-translation" {
                l.translation = Some(sub.lrc);
            } else {
                l.romanization = Some(sub.lrc);
                l.romanization_words = sub.words;
                l.has_romanization_word_timeline = !l.romanization_words.is_empty();
            }
            continue;
        }
        if child.attr("ruby") == Some("container") {
            let mut spans = Vec::new();
            child.descendants("span", &mut spans);
            let base = spans
                .iter()
                .find(|n| n.attr("ruby") == Some("base"))
                .map(|n| clean(&n.all_text()))
                .unwrap_or_default();
            let mut ruby = Vec::new();
            for node in &spans {
                if node.attr("ruby") == Some("text") {
                    let (a, b) = interval(node, range);
                    ruby.push(word(&clean(&node.all_text()), a, b, ruby.len()));
                }
            }
            let (a, b) = if ruby.is_empty() {
                interval(child, range)
            } else {
                (
                    (ruby[0].start_time * 1000.) as i64,
                    (ruby.last().unwrap().end_time * 1000.) as i64,
                )
            };
            let mut w = word(&base, a, b, l.words.len());
            w.ruby = ruby;
            l.lrc.push_str(&base);
            l.words.push(w);
            continue;
        }
        if child.attr("begin").is_some() {
            let (a, b) = interval(child, range);
            let text = clean(&child.all_text());
            l.lrc.push_str(&text);
            l.words.push(word(&text, a, b, l.words.len()));
        } else {
            contents(child, l, bg, range);
        }
    }
}
fn parse_line(n: &Node, parent: (i64, i64)) -> (Line, Vec<Line>) {
    let range = interval(n, parent);
    let mut l = line(String::new(), range.0, range.1, vec![]);
    l.structured = true;
    l.explicit_end = n.attr("end").is_some() || n.attr("dur").is_some();
    let mut bg = Vec::new();
    contents(n, &mut l, &mut bg, range);
    l.lrc = l.lrc.trim().to_owned();
    if l.words.is_empty() && !l.lrc.is_empty() && n.attr("begin").is_some() {
        l.words.push(word(&l.lrc, range.0, range.1, 0));
    }
    l.has_word_timeline = !l.words.is_empty();
    if n.attr("begin").is_none()
        && let Some(w) = l.words.first()
    {
        l.time = w.start_time;
    }
    if !l.explicit_end
        && let Some(w) = l.words.last()
    {
        l.end_time = w.end_time;
    }
    l.duration = (l.end_time - l.time).max(0.);
    (l, bg)
}
pub(super) fn parse(raw: &str) -> Result<Vec<Line>, String> {
    let doc = document(raw)?;
    let mut bodies = Vec::new();
    doc.descendants("body", &mut bodies);
    let mut out = Vec::new();
    let mut ids = HashMap::new();
    let mut first_agent = None;
    for body in bodies {
        let mut paragraphs = Vec::new();
        body.descendants("p", &mut paragraphs);
        for p in paragraphs {
            let (mut l, mut bg) = parse_line(p, (0, 3000));
            if let Some(agent) = p.attr("agent") {
                if first_agent.is_none() {
                    first_agent = Some(agent.to_owned());
                }
                l.is_duet = agent != "v1" && first_agent.as_deref() != Some(agent);
            }
            for b in &mut bg {
                b.is_duet = l.is_duet;
            }
            ids.entry(p.attr("key").unwrap_or("")).or_insert(out.len());
            if !l.lrc.is_empty() {
                out.push(l);
            }
            out.extend(bg);
        }
    }
    // Apple/iTunes sidecar secondary fields, matched by key rather than list order.
    for (name, roman) in [("translation", false), ("transliteration", true)] {
        let mut containers = Vec::new();
        doc.descendants(name, &mut containers);
        for container in containers {
            let mut texts = Vec::new();
            container.descendants("text", &mut texts);
            for text in texts {
                if let Some(key) = text.attr("for")
                    && let Some(index) = ids.get(key)
                    && let Some(l) = out.get_mut(*index)
                {
                    let (sub, _) =
                        parse_line(text, ((l.time * 1000.) as i64, (l.end_time * 1000.) as i64));
                    if roman {
                        l.romanization =
                            Some(sub.lrc.split_whitespace().collect::<Vec<_>>().join(" "));
                        l.romanization_words = sub.words;
                        l.has_romanization_word_timeline = !l.romanization_words.is_empty();
                    } else {
                        l.translation = Some(sub.lrc);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.time.total_cmp(&b.time));
    let mut roots = Vec::new();
    doc.descendants("tt", &mut roots);
    let word_mode = roots.iter().any(|n| n.attr("timing") == Some("Word"))
        || out.iter().any(|l| l.words.len() > 1);
    for (i, l) in out.iter_mut().enumerate() {
        l.index = i;
        l.has_word_timeline = word_mode && l.words.iter().any(|w| w.end_time > w.start_time);
        for (word, roman) in l.words.iter_mut().zip(&l.romanization_words) {
            word.roman_word = Some(roman.text.trim().into());
        }
        l.romanization_words.clear();
        l.has_romanization_word_timeline = false;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference_parse(raw: &str) -> Result<Vec<Line>, String> {
        let doc = document(raw)?;
        let mut bodies = Vec::new();
        doc.descendants("body", &mut bodies);
        let mut out = Vec::new();
        let mut ids = Vec::new();
        let mut first_agent = None;
        for body in bodies {
            let mut paragraphs = Vec::new();
            body.descendants("p", &mut paragraphs);
            for p in paragraphs {
                let (mut l, mut bg) = parse_line(p, (0, 3000));
                if let Some(agent) = p.attr("agent") {
                    if first_agent.is_none() {
                        first_agent = Some(agent.to_owned());
                    }
                    l.is_duet = agent != "v1" && first_agent.as_deref() != Some(agent);
                }
                for b in &mut bg {
                    b.is_duet = l.is_duet;
                }
                ids.push((p.attr("key").unwrap_or("").to_owned(), out.len()));
                if !l.lrc.is_empty() {
                    out.push(l);
                }
                out.extend(bg);
            }
        }
        // Apple/iTunes sidecar secondary fields, matched by key rather than list order.
        for (name, roman) in [("translation", false), ("transliteration", true)] {
            let mut containers = Vec::new();
            doc.descendants(name, &mut containers);
            for container in containers {
                let mut texts = Vec::new();
                container.descendants("text", &mut texts);
                for text in texts {
                    if let Some(key) = text.attr("for")
                        && let Some((_, index)) = ids.iter().find(|(id, _)| id == key)
                        && let Some(l) = out.get_mut(*index)
                    {
                        let (sub, _) = parse_line(
                            text,
                            ((l.time * 1000.) as i64, (l.end_time * 1000.) as i64),
                        );
                        if roman {
                            l.romanization =
                                Some(sub.lrc.split_whitespace().collect::<Vec<_>>().join(" "));
                            l.romanization_words = sub.words;
                            l.has_romanization_word_timeline = !l.romanization_words.is_empty();
                        } else {
                            l.translation = Some(sub.lrc);
                        }
                    }
                }
            }
        }
        out.sort_by(|a, b| a.time.total_cmp(&b.time));
        let mut roots = Vec::new();
        doc.descendants("tt", &mut roots);
        let word_mode = roots.iter().any(|n| n.attr("timing") == Some("Word"))
            || out.iter().any(|l| l.words.len() > 1);
        for (i, l) in out.iter_mut().enumerate() {
            l.index = i;
            l.has_word_timeline = word_mode && l.words.iter().any(|w| w.end_time > w.start_time);
            for (word, roman) in l.words.iter_mut().zip(&l.romanization_words) {
                word.roman_word = Some(roman.text.trim().into());
            }
            l.romanization_words.clear();
            l.has_romanization_word_timeline = false;
        }
        Ok(out)
    }

    fn sidecar_document(count: usize) -> String {
        use std::fmt::Write;
        let mut raw = String::from("<tt timing=\"Word\"><head><metadata><translation>");
        for index in (0..count).rev() {
            write!(raw, "<text for=\"line-{index}\">Translation {index}</text>").unwrap();
        }
        raw.push_str("</translation><transliteration>");
        for index in (0..count).rev() {
            let start = index * 1000;
            let middle = start + 500;
            let end = start + 1000;
            write!(raw, "<text for=\"line-{index}\"><span begin=\"{start}ms\" end=\"{middle}ms\">ai</span><span begin=\"{middle}ms\" end=\"{end}ms\">yue</span></text>").unwrap();
        }
        raw.push_str("</transliteration></metadata></head><body><div>");
        for index in 0..count {
            let start = index * 1000;
            let middle = start + 500;
            let end = start + 1000;
            write!(raw, "<p key=\"line-{index}\" begin=\"{start}ms\" end=\"{end}ms\"><span begin=\"{start}ms\" end=\"{middle}ms\">爱</span><span begin=\"{middle}ms\" end=\"{end}ms\">乐</span></p>").unwrap();
        }
        raw.push_str("</div></body></tt>");
        raw
    }

    #[test]
    fn sidecar_lookup_preserves_first_duplicate_and_empty_key_behavior() {
        let raw = r#"<tt><head><metadata><translation>
            <text for="duplicate">overwritten</text><text for="duplicate">final translation</text>
            <text for="">empty key translation</text><text for="missing">ignored</text>
            <text>no target</text><text for="tail">out of bounds</text>
            </translation><transliteration><text for="duplicate">first roman</text></transliteration>
            </metadata></head><body><div>
            <p key="duplicate" begin="2s" end="3s">first</p>
            <p key="duplicate" begin="1s" end="2s">second</p>
            <p/><p begin="4s" end="5s">after empty</p><p key="tail"/>
            </div></body></tt>"#;
        let actual = parse(raw).unwrap();
        assert_eq!(actual, reference_parse(raw).unwrap());
        let first = actual.iter().find(|line| line.lrc == "first").unwrap();
        assert_eq!(first.translation.as_deref(), Some("final translation"));
        assert_eq!(first.romanization.as_deref(), Some("first roman"));
        assert!(
            actual
                .iter()
                .find(|line| line.lrc == "second")
                .unwrap()
                .translation
                .is_none()
        );
        assert_eq!(
            actual
                .iter()
                .find(|line| line.lrc == "after empty")
                .unwrap()
                .translation
                .as_deref(),
            Some("empty key translation")
        );
    }

    #[test]
    fn sidecars_preserve_word_timing_background_offsets_and_body_order() {
        let raw = r#"<tt timing="Word"><head><metadata>
            <translation><text for="two">second</text><text for="one">first</text></translation>
            <transliteration><text for="one"><span begin="2s" end="2.5s">ai</span><span begin="2.5s" end="3s">yue</span></text></transliteration>
            </metadata></head><body><div><p key="one" begin="2s" end="3s" agent="v1">
            <span begin="2s" end="2.5s">爱</span><span begin="2.5s" end="3s">乐</span><span role="x-bg" begin="2s" end="3s">(backing)</span></p></div></body>
            <body><div><p key="two" begin="1s" end="2s" agent="v2">前行</p></div></body></tt>"#;
        let actual = parse(raw).unwrap();
        assert_eq!(actual, reference_parse(raw).unwrap());
        assert!(actual.iter().any(|line| line.is_bg));
        let main = actual.iter().find(|line| line.lrc == "爱乐").unwrap();
        assert_eq!(main.translation.as_deref(), Some("first"));
        assert_eq!(main.words[0].roman_word.as_deref(), Some("ai"));
        assert_eq!(main.words[1].roman_word.as_deref(), Some("yue"));
        let raw = sidecar_document(200);
        assert_eq!(parse(&raw).unwrap(), reference_parse(&raw).unwrap());
        for raw in ["<tt>", "<!DOCTYPE tt><tt/>", "<tt/>"] {
            assert_eq!(parse(raw), reference_parse(raw));
        }
    }

    #[test]
    fn sidecar_keys_remain_case_sensitive_and_unicode_exact() {
        let raw = r#"<tt><head><translation>
            <text for="A">upper</text><text for="a">lower</text>
            <text for="é">composed</text><text for="e&#x301;">combining</text>
            </translation></head><body><div>
            <p key="A" begin="0s" end="1s">one</p><p key="a" begin="1s" end="2s">two</p>
            <p key="é" begin="2s" end="3s">three</p><p key="e&#x301;" begin="3s" end="4s">four</p>
            </div></body></tt>"#;
        let actual = parse(raw).unwrap();
        assert_eq!(actual, reference_parse(raw).unwrap());
        assert_eq!(
            actual
                .iter()
                .map(|line| line.translation.as_deref())
                .collect::<Vec<_>>(),
            vec![
                Some("upper"),
                Some("lower"),
                Some("composed"),
                Some("combining")
            ]
        );
    }

    #[test]
    #[ignore = "manual host timing; not a device benchmark"]
    fn ttml_sidecar_lookup_measurement() {
        use std::hint::black_box;
        use std::time::Instant;
        for (count, sidecars) in [(100, true), (1000, true), (4000, true), (4000, false)] {
            let full = sidecar_document(count);
            let raw = if sidecars {
                full
            } else {
                format!(
                    "<tt timing=\"Word\"><body>{}",
                    full.split_once("<body>").unwrap().1
                )
            };
            assert!(raw.len() < 2 * 1024 * 1024);
            assert_eq!(parse(&raw).unwrap(), reference_parse(&raw).unwrap());
            let mut samples = [Vec::new(), Vec::new()];
            for sample in 0..10 {
                for slot in 0..2 {
                    let variant = (sample + slot) % 2;
                    let parser = if variant == 0 { reference_parse } else { parse };
                    let started = Instant::now();
                    black_box(parser(black_box(&raw)).unwrap());
                    if sample >= 3 {
                        samples[variant].push(started.elapsed());
                    }
                }
            }
            for durations in &mut samples {
                durations.sort_unstable();
            }
            eprintln!(
                "TTML lines={count} sidecars={sidecars} bytes={}: reference={:?} production={:?}",
                raw.len(),
                samples[0][3],
                samples[1][3]
            );
        }
    }
}
