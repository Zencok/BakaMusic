//! Native QQ custom DES. Ported from BakaMusic lyric-decrypt.ts (see licenses/lyrics).
//! This is not standard DES: preserve the reference S-boxes and key schedule.
use std::io::Read;
use std::sync::LazyLock;

const MAX_INPUT: usize = 2 * 1024 * 1024;
const MAX_OUTPUT: u64 = 5 * 1024 * 1024;
const S1: [u32; 64] = [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11,
    9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5,
    11, 3, 14, 10, 0, 6, 13,
];
const S2: [u32; 64] = [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10,
    6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2,
    11, 6, 7, 12, 0, 5, 14, 9,
];
const S3: [u32; 64] = [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14,
    12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7,
    4, 15, 14, 3, 11, 5, 2, 12,
];
const S4: [u32; 64] = [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12,
    1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8,
    9, 4, 5, 11, 12, 7, 2, 14,
];
const S5: [u32; 64] = [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10,
    3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13,
    6, 15, 0, 9, 10, 4, 5, 3,
];
const S6: [u32; 64] = [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14,
    0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10,
    11, 14, 1, 7, 6, 0, 8, 13,
];
const S7: [u32; 64] = [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12,
    2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7,
    9, 5, 0, 15, 14, 2, 3, 12,
];
const S8: [u32; 64] = [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11,
    0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13,
    15, 12, 9, 0, 3, 5, 6, 11,
];
const BOXES: [[u32; 64]; 8] = [S1, S2, S3, S4, S5, S6, S7, S8];
const SHIFTS: [usize; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const PC: [usize; 28] = [
    56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59,
    51, 43, 35,
];
const PD: [usize; 28] = [
    62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4,
    27, 19, 11, 3,
];
const COMP: [usize; 48] = [
    13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51,
    30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];
const IP: [usize; 64] = [
    57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63,
    55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52,
    44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6,
];
const P: [usize; 32] = [
    15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12,
    29, 5, 21, 10, 3, 24,
];

fn byte_bit(bytes: &[u8], bit: usize) -> u32 {
    let byte = bit / 32 * 4 + 3 - (bit % 32 / 8);
    u32::from((bytes[byte] >> (7 - bit % 8)) & 1)
}
fn int_bit(value: u32, bit: usize) -> u32 {
    (value >> (31 - bit)) & 1
}
fn schedule(key: &[u8], decrypt: bool) -> [[u8; 6]; 16] {
    let (mut c, mut d) = (0u32, 0u32);
    for i in 0..28 {
        c |= byte_bit(key, PC[i]) << (31 - i);
        d |= byte_bit(key, PD[i]) << (31 - i);
    }
    let mut keys = [[0u8; 6]; 16];
    for i in 0..16 {
        let shift = SHIFTS[i];
        c = ((c << shift) | (c >> (28 - shift))) & 0xfffffff0;
        d = ((d << shift) | (d >> (28 - shift))) & 0xfffffff0;
        let k = if decrypt { 15 - i } else { i };
        for j in 0..48 {
            let bit = if j < 24 {
                int_bit(c, COMP[j])
            } else {
                int_bit(d, COMP[j] - 27)
            };
            keys[k][j / 8] |= (bit as u8) << (7 - j % 8);
        }
    }
    keys
}
fn feistel(state: u32, key: &[u8; 6]) -> u32 {
    let mut substituted = 0u32;
    for (group, table) in BOXES.iter().enumerate() {
        let mut six = 0usize;
        for j in 0..6 {
            let source = (group * 4 + j + 31) % 32;
            let key_pos = group * 6 + j;
            let bit = int_bit(state, source) as usize
                ^ ((key[key_pos / 8] >> (7 - key_pos % 8)) & 1) as usize;
            six = (six << 1) | bit;
        }
        let slot = (six & 0x20) | ((six & 0x1f) >> 1) | ((six & 1) << 4);
        substituted |= table[slot] << (28 - group * 4);
    }
    let mut out = 0;
    for (i, bit) in P.iter().enumerate() {
        out |= int_bit(substituted, *bit) << (31 - i);
    }
    out
}
fn crypt(block: &mut [u8], keys: &[[u8; 6]; 16]) {
    let mut state = [0u32; 2];
    for (i, source) in IP.iter().enumerate() {
        state[i / 32] |= byte_bit(block, *source) << (31 - i % 32);
    }
    for key in keys.iter().take(15) {
        state = [state[1], feistel(state[1], key) ^ state[0]];
    }
    state[0] ^= feistel(state[1], &keys[15]);
    block.fill(0);
    for (i, dest) in IP.iter().enumerate() {
        let byte = dest / 32 * 4 + 3 - (dest % 32 / 8);
        block[byte] |= (int_bit(state[i / 32], i % 32) as u8) << (7 - dest % 8);
    }
}
static KEYS: LazyLock<[[[u8; 6]; 16]; 3]> = LazyLock::new(|| {
    [
        schedule(b"!@#)(NHLiuy*$%^&", true),
        schedule(b"123ZXC!@#)(*$%^&", false),
        schedule(b"!@#)(*$%^&abcDEF", true),
    ]
});

// QQ can put literal quotes inside LyricContent (e.g. NEON, 733159779).
// Only a quote followed by the rest of the opening tag closes the content.
// Accept following attributes too, without consuming another lyric element.
static ATTRIBUTE_TAIL: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"^(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*/?>"#)
        .unwrap()
});

/// Hex ciphertext detection is deliberately narrow; ordinary LRC passes through.
pub fn decode(raw: &str) -> Result<String, String> {
    let input = raw.trim();
    let encrypted = input.len() >= 32
        && input.len().is_multiple_of(16)
        && input.bytes().all(|b| b.is_ascii_hexdigit());
    let text = if encrypted {
        if input.len() / 2 > MAX_INPUT {
            return Err("QRC input limit exceeded".into());
        }
        let mut data = hex::decode(input).map_err(|e| e.to_string())?;
        for keys in KEYS.iter() {
            for block in data.as_chunks_mut::<8>().0 {
                crypt(block, keys);
            }
        }
        let mut output = Vec::new();
        flate2::read::ZlibDecoder::new(data.as_slice())
            .take(MAX_OUTPUT + 1)
            .read_to_end(&mut output)
            .map_err(|e| format!("QRC inflate: {e}"))?;
        if output.len() as u64 > MAX_OUTPUT {
            return Err("QRC output limit exceeded".into());
        }
        String::from_utf8(output).map_err(|e| format!("QRC UTF-8: {e}"))?
    } else {
        raw.to_owned()
    };
    // Extract the attribute, not a word regex: preserve punctuation and untimed tails.
    if let Some((_, rest)) = text.split_once("LyricContent=") {
        let rest = rest.trim_start();
        if let Some(quote @ ('\'' | '"')) = rest.chars().next()
            && let Some(end) = rest[1..].char_indices().find_map(|(index, ch)| {
                (ch == quote && ATTRIBUTE_TAIL.is_match(&rest[1 + index + ch.len_utf8()..]))
                    .then_some(index)
            })
        {
            return Ok(html_escape::decode_html_entities(&rest[1..1 + end])
                .replace("\r\n", "\n")
                .replace('\r', "\n"));
        }
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn qrc_literal_quotes_do_not_close_lyric_content() {
        let content = "[22013,3111]the(25124,200) \"LITE\"(25324,500)\r\n[27380,1655]next(27380,1655) untimed &amp; tail";
        for quote in ['\'', '"'] {
            for tail in ["/>", " />", " LyricType=\"1\" Other='value'>"] {
                let xml = format!(
                    "<?xml version=\"1.0\"?><QrcInfos><Lyric_1 LyricType=\"1\" LyricContent={quote}{content}{quote}{tail}</QrcInfos>"
                );
                assert_eq!(
                    decode(&xml).unwrap(),
                    content.replace("\r\n", "\n").replace("&amp;", "&")
                );
            }
        }
        let xml = "<?xml?><Lyric_1 LyricContent='[1000,1000]it's(1000,500) 'quoted'(1500,500)\r[2000,1000]end(2000,1000)'/><Other Value=\"ignored\"/>";
        assert_eq!(
            decode(xml).unwrap(),
            "[1000,1000]it's(1000,500) 'quoted'(1500,500)\n[2000,1000]end(2000,1000)"
        );
    }
    #[test]
    fn desktop_des_golden_vectors() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/qrc_vectors.json")).unwrap();
        for vector in vectors.as_array().unwrap() {
            let plain = vector["text"].as_str().unwrap();
            assert_eq!(
                decode(vector["encrypted"].as_str().unwrap()).unwrap(),
                decode(plain).unwrap()
            );
        }
    }
    #[test]
    fn passthrough_and_malformed_cipher() {
        assert_eq!(decode("[00:01.00]hello").unwrap(), "[00:01.00]hello");
        assert!(decode(&"0".repeat(32)).is_err());
        assert!(decode(&"0".repeat(MAX_INPUT * 2 + 16)).is_err());
    }
}
