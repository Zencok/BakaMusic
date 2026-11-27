//! Bounded native byte operations used by independently updated V2 providers.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rquickjs::{Ctx, Exception, function::Func};

const MAX_BYTES: usize = 16 * 1024 * 1024;

fn input(value: &str, encoding: &str) -> Result<Vec<u8>, String> {
    if value.len() > MAX_BYTES * 2 {
        return Err("byte input exceeds limit".into());
    }
    let bytes = match encoding.to_ascii_lowercase().as_str() {
        "utf8" | "utf-8" => value.as_bytes().to_vec(),
        "base64" => STANDARD.decode(value).map_err(|e| e.to_string())?,
        "hex" => hex::decode(value).map_err(|e| e.to_string())?,
        _ => return Err("unsupported input encoding".into()),
    };
    if bytes.len() > MAX_BYTES {
        return Err("byte input exceeds limit".into());
    }
    Ok(bytes)
}

pub(super) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    let baka: rquickjs::Object = ctx.globals().get("__baka")?;
    baka.set(
        "bytes_encode",
        Func::from(|ctx: Ctx<'_>, value: String, encoding: String| {
            input(&value, &encoding)
                .map(hex::encode)
                .map_err(|e| Exception::throw_type(&ctx, &e))
        }),
    )?;
    baka.set(
        "bytes_decode",
        Func::from(|ctx: Ctx<'_>, value: String, encoding: String| {
            let operation = || -> Result<String, String> {
                let bytes = input(&value, "hex")?;
                match encoding.to_ascii_lowercase().as_str() {
                    "hex" => Ok(hex::encode(bytes)),
                    "base64" => Ok(STANDARD.encode(bytes)),
                    "utf8" | "utf-8" => Ok(String::from_utf8_lossy(&bytes).into_owned()),
                    label => super::text_decode(&value, label).map_err(|e| e.to_string()),
                }
            };
            operation().map_err(|e| Exception::throw_type(&ctx, &e))
        }),
    )?;
    baka.set(
        "sm3",
        Func::from(|ctx: Ctx<'_>, value: String| {
            input(&value, "hex")
                .map(|bytes| hex::encode(super::v2_sm3::sm3(&bytes)))
                .map_err(|e| Exception::throw_type(&ctx, &e))
        }),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn byte_encodings_retain_binary_and_unicode() {
        assert_eq!(input("AP+A", "base64").unwrap(), vec![0, 255, 128]);
        assert_eq!(input("00ff80", "hex").unwrap(), vec![0, 255, 128]);
        assert_eq!(input("音乐", "utf8").unwrap(), "音乐".as_bytes());
        assert!(input("invalid", "hex").is_err());
        assert!(input("a", "utf16").is_err());
    }
}
