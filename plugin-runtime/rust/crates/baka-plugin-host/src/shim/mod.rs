//! Generic native services for the strict V2 SDK.
mod cancellation;
mod crypto;
mod http;
mod namespace;
pub(crate) mod qrc;
pub(crate) mod storage;
mod timers;
mod v2_native;
mod v2_sm3;
mod web;

use baka_core::{BakaError, Result};
use rquickjs::{Ctx, Exception, function::Func};

pub use http::HttpShim;

/// Native services only: no npm/CommonJS compatibility packages or LX runtime.
pub(crate) fn install_v2_scoped(
    ctx: &Ctx<'_>,
    network: crate::plugin_network::PluginNetwork,
    scopes: crate::call_scope::CallScopes,
) -> Result<()> {
    let install = || -> rquickjs::Result<()> {
        namespace::install_baka_namespace(ctx)?;
        install_crypto(ctx)?;
        install_misc(ctx)?;
        v2_native::install(ctx)?;
        web::install(ctx)?;
        HttpShim::with_network(network).install_scoped(ctx, scopes.clone())?;
        timers::install(ctx, scopes)?;
        ctx.eval::<(), _>(include_str!("../v2_bridge.js"))?;
        Ok(())
    };
    install().map_err(|e| BakaError::js("<v2-sdk>", e.to_string()))
}

/// Map a host-side error to a raised JS exception with the message intact.
fn raise(ctx: &Ctx<'_>, err: BakaError) -> rquickjs::Error {
    Exception::throw_message(ctx, &err.to_string())
}

fn install_crypto(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let baka: rquickjs::Object = globals.get("__baka")?;

    baka.set(
        "random_bytes",
        Func::from(|ctx: Ctx<'_>, size: usize| {
            if size > 1024 * 1024 {
                return Err(Exception::throw_message(
                    &ctx,
                    "randomBytes size exceeds 1 MB",
                ));
            }
            let mut bytes = vec![0u8; size];
            getrandom::fill(&mut bytes)
                .map_err(|e| Exception::throw_message(&ctx, &e.to_string()))?;
            Ok(hex::encode(bytes))
        }),
    )?;
    baka.set(
        "md5",
        Func::from(|ctx: Ctx<'_>, data_hex: String| {
            crypto::md5_hex(&data_hex).map_err(|e| raise(&ctx, e))
        }),
    )?;
    baka.set(
        "sha1",
        Func::from(|ctx: Ctx<'_>, data_hex: String| {
            crypto::sha1_hex(&data_hex).map_err(|e| raise(&ctx, e))
        }),
    )?;
    baka.set(
        "sha256",
        Func::from(|ctx: Ctx<'_>, data_hex: String| {
            crypto::sha256_hex(&data_hex).map_err(|e| raise(&ctx, e))
        }),
    )?;
    baka.set(
        "hmac_sha256",
        Func::from(|ctx: Ctx<'_>, key_hex: String, data_hex: String| {
            crypto::hmac_sha256_hex(&key_hex, &data_hex).map_err(|e| raise(&ctx, e))
        }),
    )?;
    baka.set(
        "aes_encrypt",
        Func::from(
            |ctx: Ctx<'_>,
             mode: String,
             key_hex: String,
             iv_hex: String,
             data_hex: String,
             padding: String| {
                crypto::aes_encrypt_hex(&mode, &key_hex, &iv_hex, &data_hex, &padding)
                    .map_err(|e| raise(&ctx, e))
            },
        ),
    )?;
    baka.set(
        "aes_decrypt",
        Func::from(
            |ctx: Ctx<'_>,
             mode: String,
             key_hex: String,
             iv_hex: String,
             data_hex: String,
             padding: String| {
                crypto::aes_decrypt_hex(&mode, &key_hex, &iv_hex, &data_hex, &padding)
                    .map_err(|e| raise(&ctx, e))
            },
        ),
    )?;
    Ok(())
}

fn install_misc(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let baka: rquickjs::Object = globals.get("__baka")?;

    baka.set(
        "deflate_zlib",
        Func::from(|ctx: Ctx<'_>, data: String| {
            use std::io::Write;
            if data.len() > 32 * 1024 * 1024 {
                return Err(Exception::throw_message(
                    &ctx,
                    "compression input exceeds 16 MiB",
                ));
            }
            let bytes =
                hex::decode(data).map_err(|e| Exception::throw_message(&ctx, &e.to_string()))?;
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&bytes)
                .map_err(|e| Exception::throw_message(&ctx, &e.to_string()))?;
            let compressed = encoder
                .finish()
                .map_err(|e| Exception::throw_message(&ctx, &e.to_string()))?;
            if compressed.len() > 16 * 1024 * 1024 {
                return Err(Exception::throw_message(
                    &ctx,
                    "compression output exceeds 16 MiB",
                ));
            }
            Ok(hex::encode(compressed))
        }),
    )?;
    baka.set(
        "lyric_parse",
        Func::from(
            |ctx: Ctx<'_>,
             raw: String,
             translation: Option<String>,
             romanization: Option<String>,
             artist: Option<String>| {
                crate::lyric_native::parse(
                    &raw,
                    translation.as_deref(),
                    romanization.as_deref(),
                    artist.as_deref(),
                )
                .and_then(|lines| {
                    let download_lrc =
                        crate::lyric_native::export::format(&lines, &raw, &Default::default());
                    serde_json::to_string(&serde_json::json!({
                        "parsedLines": lines,
                        "downloadLrc": download_lrc,
                        "systemLrc": crate::lyric_native::export::system_lrc(&lines),
                    }))
                    .map_err(|e| e.to_string())
                })
                .map_err(|e| Exception::throw_message(&ctx, &e))
            },
        ),
    )?;
    baka.set(
        "lyric_decode",
        Func::from(|ctx: Ctx<'_>, text: String| {
            qrc::decode(&text).map_err(|e| Exception::throw_message(&ctx, &e))
        }),
    )?;
    baka.set(
        "html_decode",
        Func::from(|_ctx: Ctx<'_>, text: String| {
            html_escape::decode_html_entities(&text).into_owned()
        }),
    )?;
    baka.set(
        "inflate_zlib",
        Func::from(|ctx: Ctx<'_>, hex_data: String, to_string: bool| {
            inflate_zlib(&hex_data, to_string).map_err(|e| raise(&ctx, e))
        }),
    )?;
    baka.set(
        "text_decode",
        Func::from(|ctx: Ctx<'_>, hex_data: String, encoding: String| {
            text_decode(&hex_data, &encoding).map_err(|e| raise(&ctx, e))
        }),
    )?;
    Ok(())
}

/// TextDecoder backend. encoding_rs natively speaks gb18030/gbk — the reason
/// kw's word-by-word lyrics decode correctly here while Hermes needed a
/// hand-rolled decoder.
fn text_decode(hex_data: &str, encoding: &str) -> Result<String> {
    use encoding_rs::Encoding;

    let data = hex::decode(hex_data.trim())
        .map_err(|e| BakaError::Decode(format!("bad hex input: {e}")))?;
    let label = if encoding.trim().is_empty() {
        "utf-8"
    } else {
        encoding.trim()
    };
    let enc = Encoding::for_label(label.as_bytes())
        .ok_or_else(|| BakaError::Decode(format!("unsupported encoding `{label}`")))?;
    // Windows code page alias for the CJK fallback path.
    // decode 返回 (Cow, encoding_used, had_errors)；文本取第一项。
    let (text, _, _) = if label.eq_ignore_ascii_case("cp936") {
        encoding_rs::GBK.decode(&data)
    } else {
        enc.decode(&data)
    };
    Ok(text.into_owned())
}

/// pako.inflate backend: zlib-format decompression. `{to:'string'}` returns
/// the UTF-8 text; otherwise hex of the raw bytes.
fn inflate_zlib(hex_data: &str, to_string: bool) -> Result<String> {
    use std::io::Read;

    let data = hex::decode(hex_data.trim())
        .map_err(|e| BakaError::Decode(format!("bad hex input: {e}")))?;
    let decoder = flate2::read::ZlibDecoder::new(&data[..]);
    let mut decoder = decoder.take(16 * 1024 * 1024 + 1);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| BakaError::Decode(format!("inflate failed: {e}")))?;
    if out.len() > 16 * 1024 * 1024 {
        return Err(BakaError::Decode("inflate exceeds 16 MB".into()));
    }
    if to_string {
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Ok(hex::encode(&out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inflate_zlib_round_trip() {
        let compressed = {
            let mut enc =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(
                &mut enc,
                "[00:01.500]hello lyric line\n[00:02.000]second".as_bytes(),
            )
            .unwrap();
            enc.finish().unwrap()
        };
        let out = inflate_zlib(&hex::encode(&compressed), true).unwrap();
        assert_eq!(out, "[00:01.500]hello lyric line\n[00:02.000]second");
    }

    #[test]
    fn html_decode() {
        assert_eq!(
            html_escape::decode_html_entities("a &amp; b &#x27;c&#39;").as_ref(),
            "a & b 'c'"
        );
    }
}
