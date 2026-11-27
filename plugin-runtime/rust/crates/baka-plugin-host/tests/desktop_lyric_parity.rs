use baka_plugin_host::lyric_native::{parse, parse_desktop};

#[test]
fn desktop_corpus() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("desktop_lyric_parity.json")).unwrap();
    let mut failures = Vec::new();
    for case in cases.as_array().unwrap() {
        let mut actual = parse_desktop(
            case["rawLrc"].as_str().unwrap(),
            case["translation"].as_str(),
            case["romanization"].as_str(),
            case["artist"].as_str(),
        )
        .unwrap();
        let offset = case["timeOffset"].as_f64().unwrap_or(0.);
        for l in &mut actual {
            l.time += offset;
            l.end_time += offset;
        }
        let expected = case["expected"].as_array().unwrap();
        let mut differences = Vec::new();
        if actual.len() != expected.len() {
            differences.push(format!("count {} != {}", actual.len(), expected.len()));
        }
        for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
            for (field, words, timed) in [
                ("words", &a.words, a.has_word_timeline),
                (
                    "romanizationWords",
                    &a.romanization_words,
                    a.has_romanization_word_timeline,
                ),
            ] {
                if !timed {
                    continue;
                }
                let expected_words = e[field].as_array().cloned().unwrap_or_default();
                if words.len() != expected_words.len() {
                    differences.push(format!(
                        "row {i} {field} count {} != {}",
                        words.len(),
                        expected_words.len()
                    ));
                }
                for (j, (w, v)) in words.iter().zip(&expected_words).enumerate() {
                    if w.text != v["text"].as_str().unwrap_or("")
                        || (w.start_time + offset - v["startTime"].as_f64().unwrap_or(0.)).abs()
                            > 0.001
                        || (w.end_time + offset - v["endTime"].as_f64().unwrap_or(0.)).abs() > 0.001
                    {
                        differences.push(format!(
                            "row {i} {field}[{j}] {:?} {}..{} != {}",
                            w.text, w.start_time, w.end_time, v
                        ));
                    }
                }
            }
            for (field, actual) in [
                ("lrc", Some(a.lrc.as_str())),
                ("translation", a.translation.as_deref()),
                ("romanization", a.romanization.as_deref()),
            ] {
                if actual.map(str::trim).filter(|s| !s.is_empty())
                    != e[field].as_str().map(str::trim).filter(|s| !s.is_empty())
                {
                    differences.push(format!("row {i} {field}: {actual:?} != {}", e[field]));
                }
            }
            for (field, actual) in [
                ("isBG", a.is_bg),
                ("isDuet", a.is_duet),
                ("isDuetPartner", a.is_duet_partner),
                ("hasWordTimeline", a.has_word_timeline),
            ] {
                if actual != e[field].as_bool().unwrap_or(false) {
                    differences.push(format!("row {i} {field}: {actual} != {}", e[field]));
                }
            }
            for (field, actual) in [("time", a.time), ("endTime", a.end_time)] {
                if (actual - e[field].as_f64().unwrap_or(0.)).abs() > 0.001 {
                    differences.push(format!("row {i} {field}: {actual} != {}", e[field]));
                }
            }
        }
        if !differences.is_empty() {
            failures.push(format!(
                "{}: {}",
                case["name"],
                differences
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("; ")
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn qq_online_and_flattened_import_attach_first_romanization_to_vocal() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("desktop_lyric_parity.json")).unwrap();
    for c in cases
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["name"].as_str().unwrap().starts_with("qq-579704844"))
    {
        let lines = parse(
            c["rawLrc"].as_str().unwrap(),
            c["translation"].as_str(),
            c["romanization"].as_str(),
            c["artist"].as_str(),
        )
        .unwrap();
        let first = lines.iter().find(|l| l.lrc == "私の居ない将来に").unwrap();
        assert_eq!(
            first.romanization.as_deref().map(str::trim),
            Some("wa ta shi no i na i sho u ra i ni")
        );
        assert_eq!(first.translation.as_deref(), Some("请代替我"));
        assert!(
            lines
                .iter()
                .filter(|l| l.lrc.starts_with("词：") || l.lrc.starts_with("曲："))
                .all(|l| l.romanization.is_none())
        );
        assert!(
            lines
                .iter()
                .all(|l| l.lrc != "//" && l.translation.as_deref() != Some("//"))
        );
    }
}
