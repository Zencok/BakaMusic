use std::collections::HashMap;
use std::sync::OnceLock;

pub fn fold(text: &str) -> String {
    if text.is_ascii() {
        return text.to_ascii_lowercase();
    }
    simplified(text).to_lowercase()
}

pub fn simplified(text: &str) -> String {
    if text.is_ascii() {
        return text.to_owned();
    }
    static CHARACTERS: OnceLock<HashMap<char, char>> = OnceLock::new();
    let characters = CHARACTERS.get_or_init(|| {
        let characters: HashMap<char, char> = include_str!("../data/TSCharacters.txt")
            .lines()
            .filter_map(|line| {
                let (traditional, simplified) = line.split_once('\t')?;
                Some((traditional.chars().next()?, simplified.chars().next()?))
            })
            .collect();
        characters
            .keys()
            .map(|&character| {
                let mut normalized = character;
                for _ in 0..characters.len() {
                    let Some(&target) = characters.get(&normalized) else {
                        break;
                    };
                    if target == normalized {
                        break;
                    }
                    normalized = target;
                }
                (character, normalized)
            })
            .collect()
    });
    text.chars()
        .map(|character| {
            if character.is_ascii() {
                character
            } else {
                characters.get(&character).copied().unwrap_or(character)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_simplified(text: &str) -> String {
        static CHARACTERS: OnceLock<HashMap<char, char>> = OnceLock::new();
        let characters = CHARACTERS.get_or_init(|| {
            include_str!("../data/TSCharacters.txt")
                .lines()
                .filter_map(|line| {
                    let (traditional, simplified) = line.split_once('\t')?;
                    Some((traditional.chars().next()?, simplified.chars().next()?))
                })
                .collect()
        });
        text.chars()
            .map(|character| {
                let mut normalized = character;
                for _ in 0..characters.len() {
                    let Some(&target) = characters.get(&normalized) else {
                        break;
                    };
                    if target == normalized {
                        break;
                    }
                    normalized = target;
                }
                normalized
            })
            .collect()
    }

    #[test]
    fn dictionary_does_not_transform_ascii() {
        for line in include_str!("../data/TSCharacters.txt").lines() {
            let (traditional, _) = line.split_once('\t').unwrap();
            assert!(!traditional.chars().next().unwrap().is_ascii(), "{line}");
        }
        for byte in 0..=127 {
            let text = char::from(byte).to_string();
            assert_eq!(simplified(&text), text);
            assert_eq!(fold(&text), text.to_ascii_lowercase());
        }
    }

    #[test]
    fn all_unicode_scalars_match_original_normalization() {
        let mut text = String::new();
        for codepoint in 0..=0x10ffff {
            if let Some(character) = char::from_u32(codepoint) {
                text.push(character);
            }
            if codepoint % 4096 == 4095 {
                let expected = reference_simplified(&text);
                assert_eq!(simplified(&text), expected, "chunk ending {codepoint:x}");
                assert_eq!(fold(&text), expected.to_lowercase(), "{codepoint:x}");
                text.clear();
            }
        }
        assert!(text.is_empty());
    }

    #[test]
    fn contextual_case_and_literal_characters_match_original() {
        for text in [
            "",
            "LIVE 100%_\\\0",
            "ΣΟΣ ΟΣ ΟΣΑ",
            "İ I ı i",
            "Cafe\u{301}",
            "愛樂 LIVE ΣΟΣ İ 🎵 𠮷 薴苧苎",
        ] {
            let expected = reference_simplified(text);
            assert_eq!(simplified(text), expected);
            assert_eq!(fold(text), expected.to_lowercase());
        }
        assert_eq!(fold("ΣΟΣ"), "σος");
    }

    #[test]
    #[ignore = "manual host timing; not a device benchmark"]
    fn search_normalization_measurement() {
        use std::hint::black_box;
        use std::time::{Duration, Instant};

        fn measure(text: &str, normalize: impl Fn(&str) -> String) -> Duration {
            let started = Instant::now();
            for _ in 0..10000 {
                black_box(normalize(black_box(text)));
            }
            started.elapsed()
        }

        for (name, text) in [
            (
                "ascii",
                "Somewhere Only We Know KEANE Hopes and Fears LIVE 100%_",
            ),
            (
                "traditional",
                "愛樂之城 周杰倫 葉惠美 後來 頭髮 發現 臺灣 鬱悶 薴苧苎",
            ),
            ("mixed", "愛樂 LIVE 100%_ Cafe\u{301} ΣΟΣ İ 🎵 𠮷"),
        ] {
            let reference = |text: &str| reference_simplified(text).to_lowercase();
            assert_eq!(fold(text), reference(text));
            for _ in 0..3 {
                measure(text, reference);
                measure(text, fold);
            }
            let mut original = Vec::new();
            let mut production = Vec::new();
            for sample in 0..7 {
                if sample % 2 == 0 {
                    original.push(measure(text, reference));
                    production.push(measure(text, fold));
                } else {
                    production.push(measure(text, fold));
                    original.push(measure(text, reference));
                }
            }
            original.sort_unstable();
            production.sort_unstable();
            eprintln!(
                "{name}: 10000 folds median reference={:?}, production={:?}",
                original[3], production[3]
            );
        }
    }

    #[test]
    fn every_dictionary_character_has_an_idempotent_key() {
        for line in include_str!("../data/TSCharacters.txt").lines() {
            let (traditional, targets) = line.split_once('\t').unwrap();
            let target = targets.split_whitespace().next().unwrap();
            assert_eq!(fold(traditional), fold(target), "{line}");
            assert_eq!(fold(&fold(traditional)), fold(traditional), "{line}");
        }
        assert_eq!(fold("薴苧苎"), "苎苎苎");
    }

    #[test]
    fn scripts_and_mixed_input_share_search_keys() {
        for (traditional, simplified) in [
            ("愛樂之城 周杰倫 葉惠美", "爱乐之城 周杰伦 叶惠美"),
            ("後來 頭髮 發現 臺灣 鬱悶", "后来 头发 发现 台湾 郁闷"),
            ("愛乐之城 LIVE 100%_", "爱乐之城 live 100%_"),
        ] {
            assert_eq!(fold(traditional), fold(simplified));
            assert_eq!(fold(&fold(traditional)), fold(traditional));
        }
    }

    #[test]
    fn partial_terms_match_without_changing_display_text() {
        let title = "頭髮裡的愛與樂";
        for query in ["髮", "发", "爱与乐", "愛与樂"] {
            assert!(fold(title).contains(&fold(query)));
        }
        assert_eq!(title, "頭髮裡的愛與樂");
        assert_eq!(fold("🎵 カタカナ Café"), "🎵 カタカナ café");
    }

    #[test]
    fn ascii_inside_mixed_text_preserves_every_byte_and_contextual_case() {
        for byte in 0..=127 {
            let text = format!(
                "愛{}樂 Σ{}Σ İ{}🎵",
                char::from(byte),
                char::from(byte),
                char::from(byte)
            );
            let expected = reference_simplified(&text);
            assert_eq!(simplified(&text), expected, "{byte}");
            assert_eq!(fold(&text), expected.to_lowercase(), "{byte}");
        }
    }

    #[test]
    #[ignore = "manual host timing; not a device benchmark"]
    fn mixed_ascii_lookup_measurement() {
        use std::hint::black_box;
        use std::time::{Duration, Instant};

        static RESOLVED: OnceLock<HashMap<char, char>> = OnceLock::new();
        let characters = RESOLVED.get_or_init(|| {
            let characters: HashMap<char, char> = include_str!("../data/TSCharacters.txt")
                .lines()
                .filter_map(|line| {
                    let (traditional, simplified) = line.split_once('\t')?;
                    Some((traditional.chars().next()?, simplified.chars().next()?))
                })
                .collect();
            characters
                .keys()
                .map(|&character| {
                    let mut normalized = character;
                    for _ in 0..characters.len() {
                        let Some(&target) = characters.get(&normalized) else {
                            break;
                        };
                        if target == normalized {
                            break;
                        }
                        normalized = target;
                    }
                    (character, normalized)
                })
                .collect()
        });
        let reference = |text: &str| {
            if text.is_ascii() {
                return text.to_ascii_lowercase();
            }
            text.chars()
                .map(|character| characters.get(&character).copied().unwrap_or(character))
                .collect::<String>()
                .to_lowercase()
        };
        fn measure(text: &str, normalize: impl Fn(&str) -> String) -> Duration {
            let started = Instant::now();
            for _ in 0..10000 {
                black_box(normalize(black_box(text)));
            }
            started.elapsed()
        }
        for (name, text) in [
            (
                "ascii",
                "Somewhere Only We Know KEANE Hopes and Fears LIVE 100%_",
            ),
            (
                "traditional",
                "愛樂之城周杰倫葉惠美後來頭髮發現臺灣鬱悶薴苧苎",
            ),
            ("mixed", "愛樂 LIVE 100%_ Cafe\u{301} ΣΟΣ İ 🎵 𠮷"),
            (
                "ascii_dominant",
                "愛樂 Somewhere Only We Know KEANE Hopes and Fears LIVE 2026 REMASTERED 100%_",
            ),
        ] {
            assert_eq!(fold(text), reference(text));
            for _ in 0..3 {
                measure(text, reference);
                measure(text, fold);
            }
            let mut original = Vec::new();
            let mut production = Vec::new();
            for sample in 0..7 {
                if sample % 2 == 0 {
                    original.push(measure(text, reference));
                    production.push(measure(text, fold));
                } else {
                    production.push(measure(text, fold));
                    original.push(measure(text, reference));
                }
            }
            original.sort_unstable();
            production.sort_unstable();
            eprintln!(
                "{name}: 10000 folds median previous={:?}, production={:?}",
                original[3], production[3]
            );
        }
    }
}
