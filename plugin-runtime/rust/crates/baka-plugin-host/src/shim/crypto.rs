//! crypto-js primitives, implemented in Rust and exposed to JS as `__baka`
//! natives operating on hex strings.
//!
//! The scripts never touch crypto-js `WordArray.words`/`sigBytes` directly;
//! they parse, encrypt/decrypt and stringify. So the JS-side shim keeps
//! WordArrays as plain `Uint8Array`s and hands hex across the boundary. That
//! keeps every actual cipher in Rust, where it is tested.

use aes::cipher::{
    Block, BlockCipherDecrypt, BlockCipherEncrypt, BlockModeDecrypt, BlockModeEncrypt, KeyInit,
    KeyIvInit,
};
use baka_core::{BakaError, Result};
use hmac::{Hmac, KeyInit as HmacKeyInit, Mac};
use md5::{Digest as _, Md5};
use sha1::Sha1;
use sha2::Sha256;

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
type Aes192CbcEnc = cbc::Encryptor<aes::Aes192>;
type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;
type Aes192CbcDec = cbc::Decryptor<aes::Aes192>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

fn unhex(data_hex: &str) -> Result<Vec<u8>> {
    hex::decode(data_hex.trim()).map_err(|e| BakaError::Crypto(format!("bad hex input: {e}")))
}

fn pkcs7_pad(data: &[u8], block: usize) -> Vec<u8> {
    let pad = (block - (data.len() % block)) as u8;
    let mut out = data.to_vec();
    out.extend(std::iter::repeat_n(pad, pad as usize));
    out
}

/// MD5 of the bytes at `data_hex`, hex-encoded output.
pub fn md5_hex(data_hex: &str) -> Result<String> {
    let data = unhex(data_hex)?;
    Ok(hex::encode(Md5::digest(&data)))
}

pub fn sha1_hex(data_hex: &str) -> Result<String> {
    let data = unhex(data_hex)?;
    Ok(hex::encode(Sha1::digest(&data)))
}

pub fn sha256_hex(data_hex: &str) -> Result<String> {
    let data = unhex(data_hex)?;
    Ok(hex::encode(Sha256::digest(&data)))
}

/// HMAC-SHA256 over `data_hex` keyed by `key_hex`.
pub fn hmac_sha256_hex(key_hex: &str, data_hex: &str) -> Result<String> {
    let key = unhex(key_hex)?;
    let data = unhex(data_hex)?;
    let mut mac = <Hmac<Sha256> as HmacKeyInit>::new_from_slice(&key)
        .map_err(|e| BakaError::Crypto(format!("hmac key: {e}")))?;
    mac.update(&data);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

/// AES encrypt. `mode` is `"ecb"` or `"cbc"`; `iv_hex` is empty for ECB.
/// `padding` is `"pkcs7"` or `"none"`. Returns raw ciphertext hex.
///
/// crypto-js defaults are reproduced in the JS shim (CBC when `iv` is given,
/// Pkcs7 otherwise); here the caller states what it wants.
pub fn aes_encrypt_hex(
    mode: &str,
    key_hex: &str,
    iv_hex: &str,
    data_hex: &str,
    padding: &str,
) -> Result<String> {
    let key = unhex(key_hex)?;
    let data = unhex(data_hex)?;
    const BLOCK: usize = 16;

    let mut buf = match padding {
        "pkcs7" => pkcs7_pad(&data, BLOCK),
        "none" => {
            if data.len() % BLOCK != 0 {
                return Err(BakaError::Crypto(format!(
                    "data length {} is not a multiple of the block size",
                    data.len()
                )));
            }
            data
        }
        other => return Err(BakaError::Crypto(format!("unknown padding `{other}`"))),
    };

    match mode {
        "ecb" => match key.len() {
            16 => encrypt_ecb::<aes::Aes128>(&key, &mut buf),
            24 => encrypt_ecb::<aes::Aes192>(&key, &mut buf),
            32 => encrypt_ecb::<aes::Aes256>(&key, &mut buf),
            n => return Err(BakaError::Crypto(format!("bad AES key length {n}"))),
        },
        "cbc" => {
            let iv = unhex(iv_hex)?;
            if iv.len() != BLOCK {
                return Err(BakaError::Crypto(format!("bad IV length {}", iv.len())));
            }
            match key.len() {
                16 => encrypt_cbc::<Aes128CbcEnc>(&key, &iv, &mut buf),
                24 => encrypt_cbc::<Aes192CbcEnc>(&key, &iv, &mut buf),
                32 => encrypt_cbc::<Aes256CbcEnc>(&key, &iv, &mut buf),
                n => return Err(BakaError::Crypto(format!("bad AES key length {n}"))),
            }
        }
        other => return Err(BakaError::Crypto(format!("unknown mode `{other}`"))),
    }
    Ok(hex::encode(&buf))
}

/// AES decrypt. Inverse of [`aes_encrypt_hex`].
pub fn aes_decrypt_hex(
    mode: &str,
    key_hex: &str,
    iv_hex: &str,
    data_hex: &str,
    padding: &str,
) -> Result<String> {
    let key = unhex(key_hex)?;
    let mut buf = unhex(data_hex)?;
    const BLOCK: usize = 16;

    if buf.len() % BLOCK != 0 {
        return Err(BakaError::Crypto(format!(
            "ciphertext length {} is not a multiple of the block size",
            buf.len()
        )));
    }

    match mode {
        "ecb" => match key.len() {
            16 => decrypt_ecb::<aes::Aes128>(&key, &mut buf),
            24 => decrypt_ecb::<aes::Aes192>(&key, &mut buf),
            32 => decrypt_ecb::<aes::Aes256>(&key, &mut buf),
            n => return Err(BakaError::Crypto(format!("bad AES key length {n}"))),
        },
        "cbc" => {
            let iv = unhex(iv_hex)?;
            if iv.len() != BLOCK {
                return Err(BakaError::Crypto(format!("bad IV length {}", iv.len())));
            }
            match key.len() {
                16 => decrypt_cbc::<Aes128CbcDec>(&key, &iv, &mut buf),
                24 => decrypt_cbc::<Aes192CbcDec>(&key, &iv, &mut buf),
                32 => decrypt_cbc::<Aes256CbcDec>(&key, &iv, &mut buf),
                n => return Err(BakaError::Crypto(format!("bad AES key length {n}"))),
            }
        }
        other => return Err(BakaError::Crypto(format!("unknown mode `{other}`"))),
    }

    if padding == "pkcs7" {
        unpad_pkcs7(&buf)?;
    } else if padding != "none" {
        return Err(BakaError::Crypto(format!("unknown padding `{padding}`")));
    }
    // Truncate the padding before encoding; unpad_pkcs7 only validated it.
    let plain_len = match padding {
        "pkcs7" => {
            let pad = *buf
                .last()
                .ok_or_else(|| BakaError::Crypto("empty plaintext".into()))?
                as usize;
            buf.len() - pad
        }
        _ => buf.len(),
    };
    Ok(hex::encode(&buf[..plain_len]))
}

#[allow(deprecated)] // Array::from_mut_slice is deprecated in favor of TryFrom; the
// TryFrom form is generic-awkward here and this call is length-checked.
fn encrypt_ecb<A: KeyInit + BlockCipherEncrypt>(key: &[u8], buf: &mut [u8]) {
    let cipher = A::new_from_slice(key).expect("validated key length");
    for chunk in buf.as_chunks_mut::<16>().0 {
        cipher.encrypt_block(Block::<A>::from_mut_slice(chunk));
    }
}

#[allow(deprecated)]
fn decrypt_ecb<A: KeyInit + BlockCipherDecrypt>(key: &[u8], buf: &mut [u8]) {
    let cipher = A::new_from_slice(key).expect("validated key length");
    for chunk in buf.as_chunks_mut::<16>().0 {
        cipher.decrypt_block(Block::<A>::from_mut_slice(chunk));
    }
}

#[allow(deprecated)]
fn encrypt_cbc<A: KeyIvInit + BlockModeEncrypt>(key: &[u8], iv: &[u8], buf: &mut [u8]) {
    // The mode struct chains the IV internally; encrypt_block advances it.
    let mut cipher = A::new_from_slices(key, iv).expect("validated key/iv length");
    for chunk in buf.as_chunks_mut::<16>().0 {
        cipher.encrypt_block(Block::<A>::from_mut_slice(chunk));
    }
}

#[allow(deprecated)]
fn decrypt_cbc<A: KeyIvInit + BlockModeDecrypt>(key: &[u8], iv: &[u8], buf: &mut [u8]) {
    let mut cipher = A::new_from_slices(key, iv).expect("validated key/iv length");
    for chunk in buf.as_chunks_mut::<16>().0 {
        cipher.decrypt_block(Block::<A>::from_mut_slice(chunk));
    }
}

fn unpad_pkcs7(buf: &[u8]) -> Result<()> {
    let &pad = buf
        .last()
        .ok_or_else(|| BakaError::Crypto("empty plaintext".into()))?;
    let pad = pad as usize;
    if pad == 0 || pad > 16 || pad > buf.len() {
        return Err(BakaError::Crypto("invalid pkcs7 padding".into()));
    }
    if buf[buf.len() - pad..].iter().any(|&b| b != pad as u8) {
        return Err(BakaError::Crypto("invalid pkcs7 padding".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// NIST SP 800-38A F.1.1 ECB-AES128.Encrypt, block 1.
    #[test]
    fn aes128_ecb_nist_vector() {
        let key = "2b7e151628aed2a6abf7158809cf4f3c";
        let plain = "6bc1bee22e409f96e93d7e117393172a";
        let ct = aes_encrypt_hex("ecb", key, "", plain, "none").unwrap();
        assert_eq!(ct, "3ad77bb40d7a3660a89ecaf32466ef97");
    }

    /// NIST SP 800-38A F.2.5 CBC-AES256.Encrypt, block 1.
    #[test]
    fn aes256_cbc_nist_vector() {
        let key = "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4";
        let iv = "000102030405060708090a0b0c0d0e0f";
        let plain = "6bc1bee22e409f96e93d7e117393172a";
        let ct = aes_encrypt_hex("cbc", key, iv, plain, "none").unwrap();
        assert_eq!(ct, "f58c4c04d6e5f1ba779eabfb5f7bfbd6");
        let round = aes_decrypt_hex("cbc", key, iv, &ct, "none").unwrap();
        assert_eq!(round, plain);
    }

    /// The netease eapi shape: AES-128-ECB over JSON with Pkcs7, key
    /// `e82ckenh8dichen8` — exercised end-to-end by wy.js.
    #[test]
    fn aes128_ecb_pkcs7_roundtrip() {
        let key = hex::encode(b"e82ckenh8dichen8");
        let plain = hex::encode("{\"id\":33894312}");
        let ct = aes_encrypt_hex("ecb", &key, "", &plain, "pkcs7").unwrap();
        let round = aes_decrypt_hex("ecb", &key, "", &ct, "pkcs7").unwrap();
        assert_eq!(round, plain);
    }

    #[test]
    fn md5_sha1_vectors() {
        // "abc" -> bytes 616263
        assert_eq!(
            md5_hex("616263").unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert_eq!(
            sha1_hex("616263").unwrap(),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            sha256_hex("616263").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hmac_vector() {
        // RFC 4231 test case 1: key = 0x0b*20, data = "Hi There"
        let key = "0b".repeat(20);
        let ct = hmac_sha256_hex(&key, "4869205468657265").unwrap();
        assert_eq!(
            ct,
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }
}
