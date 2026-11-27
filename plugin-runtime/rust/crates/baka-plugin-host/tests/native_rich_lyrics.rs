use baka_plugin_host::lyric_native::{parse, parse_core};

#[test]
fn duet_keeps_secondary_kana_annotations_on_primary() {
    let lines = parse(
        "[1000,2000]Main (1000,800)(reply)(1800,1200)",
        Some("[00:01.00]主唱(かな)"),
        None,
        Some("A / B"),
    )
    .unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].translation.as_deref(), Some("主唱(かな)"));
    assert!(lines[1].translation.is_none());
}

#[test]
fn local_lrc_background_inference_does_not_steal_a2_translation() {
    let plain = parse(
        "[00:01.00](Reply)\n[00:03.00]Next",
        None,
        None,
        Some("Solo"),
    )
    .unwrap();
    assert!(plain[0].is_bg);
    assert_eq!(plain[0].lrc, "Reply");
    let rich = parse(
        "[00:01.00]<00:01.00>Hello<00:02.00>\n[00:01.00](你好)",
        None,
        None,
        Some("Solo"),
    )
    .unwrap();
    assert_eq!(rich.len(), 1);
    assert!(rich[0].has_word_timeline);
    assert_eq!(rich[0].translation.as_deref(), Some("(你好)"));
    assert!(!rich[0].is_bg);
}
#[test]
fn unlabeled_dialogue_requires_multiple_questions() {
    let lines = parse(
        "[00:01.00]Are you there?\n[00:03.00]Why?\n[00:05.00]Yes",
        None,
        None,
        Some("A / B"),
    )
    .unwrap();
    assert_eq!(
        lines.iter().map(|l| l.is_duet).collect::<Vec<_>>(),
        vec![false, true, false]
    );
    let lines = parse(
        "[00:01.00]Hello\n[00:03.00]World",
        None,
        None,
        Some("A / B"),
    )
    .unwrap();
    assert!(lines.iter().all(|l| !l.is_duet));
}
#[test]
fn rich_formats() {
    for raw in [
        "[1000,2000]<0,1000,0>hello<1000,1000,0> world",
        "[00:01.00]hello[00:02.00] world[00:03.00]",
        "[2]hello(1000,1000) world(2000,1000)",
        "[type:LyricifyLines]\n[1000,3000]hello",
        "[Lyricify Quick Export]\n[lyrics: format@Lyricify Syllable]\n[2]hello(1000,1000)\n[translation: format@LRC]\n[00:01.00]你好",
    ] {
        let lines = parse_core(raw).unwrap();
        assert!(!lines.is_empty(), "{raw}");
        assert!(lines[0].lrc.starts_with("hello"), "{lines:?}");
        assert_eq!(lines[0].time, 1.);
    }
}
#[test]
fn ttml_ruby_background_and_secondary() {
    let raw = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div><p begin="1s" end="4s" ttm:agent="v1"><span tts:ruby="container"><span tts:ruby="base">空</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="1s" end="2s">そら</span></span></span><span ttm:role="x-translation">天空</span><span ttm:role="x-roman">sora</span><span ttm:role="x-bg" begin="2s" end="3s">(oh)</span></p><p begin="3s" end="5s" ttm:agent="v2">reply</p></div></body></tt>"#;
    let lines = parse(raw, None, None, None).unwrap();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0].lrc, "空");
    assert_eq!(lines[0].words[0].ruby[0].text, "そら");
    assert_eq!(lines[0].translation.as_deref(), Some("天空"));
    assert!(lines[1].is_bg);
    assert_eq!(lines[1].lrc, "oh");
    assert!(lines[2].is_duet);
}
#[test]
fn secondary_and_speaker() {
    let lines = parse(
        "[00:01.00]v1:Hello\n[00:03.00]v2:World",
        Some("[00:01.02]你好\n[00:03.00]世界"),
        None,
        None,
    )
    .unwrap();
    assert_eq!(lines[0].lrc, "Hello");
    assert!(!lines[0].is_duet);
    assert!(lines[1].is_duet);
    assert_eq!(lines[1].translation.as_deref(), Some("世界"));
}
#[test]
fn malformed_ttml_reports_error() {
    assert!(parse_core("<tt><body>").is_err());
}

#[test]
fn desktop_differential() {
    let cases: serde_json::Value = serde_json::from_str(include_str!("lyric_parity.json")).unwrap();
    for c in cases.as_array().unwrap() {
        let actual = parse(
            c["rawLrc"].as_str().unwrap(),
            c["translation"].as_str(),
            c["romanization"].as_str(),
            c["artist"].as_str(),
        )
        .unwrap();
        let expected = c["expected"].as_array().unwrap();
        assert_eq!(actual.len(), expected.len(), "{}", c["name"]);
        for (a, e) in actual.iter().zip(expected) {
            assert_eq!(
                a.lrc.trim(),
                e["lrc"].as_str().unwrap().trim(),
                "{}",
                c["name"]
            );
            assert_eq!(a.time, e["time"].as_f64().unwrap(), "{}", c["name"]);
            assert_eq!(
                a.is_duet,
                e["isDuet"].as_bool().unwrap_or(false),
                "{}",
                c["name"]
            );
            assert_eq!(
                a.translation.as_deref(),
                e["translation"].as_str(),
                "{}",
                c["name"]
            );
            if a.has_word_timeline {
                let ew = e["words"].as_array().unwrap();
                assert_eq!(a.words.len(), ew.len(), "{}", c["name"]);
                for (w, v) in a.words.iter().zip(ew) {
                    assert_eq!(
                        w.start_time,
                        v["startTime"].as_f64().unwrap(),
                        "{}",
                        c["name"]
                    );
                    assert!(
                        (w.end_time - v["endTime"].as_f64().unwrap()).abs() < 1e-9,
                        "{}",
                        c["name"]
                    );
                }
            }
        }
    }
}
