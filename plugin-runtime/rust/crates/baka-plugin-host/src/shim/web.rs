//! WHATWG URL parsing/serialization stays native; JavaScript owns API objects.
use rquickjs::{Ctx, Exception, function::Func};
use serde_json::json;
use url::{Url, quirks};

fn url_value(
    input: &str,
    base: Option<&str>,
    field: Option<&str>,
    value: &str,
) -> Result<String, String> {
    let mut url = Url::options()
        .base_url(
            base.map(Url::parse)
                .transpose()
                .map_err(|e| e.to_string())?
                .as_ref(),
        )
        .parse(input)
        .map_err(|e| e.to_string())?;
    // Invalid component assignments are ignored by the web URL API; href is
    // the exception and throws. quirks implements these setter algorithms.
    match field {
        Some("href") => quirks::set_href(&mut url, value).map_err(|e| e.to_string())?,
        Some("protocol") => {
            let _ = quirks::set_protocol(&mut url, value);
        }
        Some("username") => {
            let _ = quirks::set_username(&mut url, value);
        }
        Some("password") => {
            let _ = quirks::set_password(&mut url, value);
        }
        Some("host") => {
            let _ = quirks::set_host(&mut url, value);
        }
        Some("hostname") => {
            let _ = quirks::set_hostname(&mut url, value);
        }
        Some("port") => {
            let _ = quirks::set_port(&mut url, value);
        }
        Some("pathname") => quirks::set_pathname(&mut url, value),
        Some("search") => quirks::set_search(&mut url, value),
        Some("hash") => quirks::set_hash(&mut url, value),
        _ => {}
    }
    Ok(json!({"href":quirks::href(&url),"origin":quirks::origin(&url),"protocol":quirks::protocol(&url),
        "username":quirks::username(&url),"password":quirks::password(&url),"host":quirks::host(&url),
        "hostname":quirks::hostname(&url),"port":quirks::port(&url),"pathname":quirks::pathname(&url),
        "search":quirks::search(&url),"hash":quirks::hash(&url)}).to_string())
}

pub(super) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    let baka: rquickjs::Object = ctx.globals().get("__baka")?;
    baka.set(
        "url",
        Func::from(
            |ctx: Ctx<'_>,
             input: String,
             base: Option<String>,
             field: Option<String>,
             value: Option<String>| {
                url_value(
                    &input,
                    base.as_deref(),
                    field.as_deref(),
                    value.as_deref().unwrap_or(""),
                )
                .map_err(|e| Exception::throw_type(&ctx, &e))
            },
        ),
    )?;
    baka.set(
        "form_parse",
        Func::from(|input: String| {
            let pairs: Vec<_> = url::form_urlencoded::parse(input.as_bytes())
                .into_owned()
                .collect();
            serde_json::to_string(&pairs).unwrap()
        }),
    )?;
    baka.set(
        "form_encode",
        Func::from(|ctx: Ctx<'_>, pairs: String| {
            let pairs: Vec<(String, String)> = serde_json::from_str(&pairs)
                .map_err(|e| Exception::throw_type(&ctx, &e.to_string()))?;
            Ok::<_, rquickjs::Error>(
                url::form_urlencoded::Serializer::new(String::new())
                    .extend_pairs(pairs)
                    .finish(),
            )
        }),
    )?;
    ctx.eval::<(), _>(include_str!("web.js"))
}
