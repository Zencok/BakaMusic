//! Direct named request and response validation with account epoch isolation.
use baka_core::{BakaError, Result};
use serde_json::{Value, json};
use std::sync::Mutex;

#[derive(Default)]
pub(crate) struct V2State {
    pub manifest: Mutex<Option<Value>>,
    pub(crate) account_epoch: std::sync::atomic::AtomicU64,
}

pub(crate) struct Call {
    pub capability: String,
    pub request: Value,
    account_epoch: u64,
}

impl V2State {
    pub fn prepare(&self, name: &str, args: &[Value], id: &str) -> Result<Call> {
        let account_epoch = self
            .account_epoch
            .load(std::sync::atomic::Ordering::Acquire);
        if args.len() != 1 || !args[0].is_object() {
            return Err(BakaError::js(id, "V2 calls require one request object"));
        }
        let capability = name.to_owned();
        let mut request = args.first().cloned().unwrap_or(json!({}));
        if is_page(&capability) {
            let object = request.as_object_mut().expect("validated request object");
            object.entry("cursor").or_insert(Value::Null);
            object.entry("limit").or_insert(json!(30));
            if !object["cursor"].is_null() && !object["cursor"].is_string()
                || object["cursor"]
                    .as_str()
                    .is_some_and(|s| s.is_empty() || s.len() > 2048)
                || !object["limit"]
                    .as_u64()
                    .is_some_and(|v| (1..=100).contains(&v))
            {
                return Err(BakaError::js(
                    id,
                    "V2 cursor must be null/string and limit must be 1..100",
                ));
            }
        }
        return Ok(Call {
            capability,
            request,
            account_epoch,
        });
    }

    pub fn finish(&self, call: Call, result: Value, id: &str) -> Result<Value> {
        let auth_succeeded = match call.capability.as_str() {
            "auth.login" | "auth.callback" => {
                result == true
                    || result["authenticated"] == true
                    || result["ok"] == true
                    || result["success"] == true
            }
            "auth.logout" => {
                result.is_null()
                    || result == true
                    || result["authenticated"] == false
                    || result["ok"] == true
                    || result["success"] == true
            }
            _ => false,
        };
        if auth_succeeded
            && result.get("error").is_none_or(Value::is_null)
            && result["ok"] != false
            && result["success"] != false
        {
            self.account_epoch
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        if !is_page(&call.capability) {
            return Ok(result);
        }
        if !result.is_object()
            || !result.get("items").is_some_and(Value::is_array)
            || !result
                .get("nextCursor")
                .is_some_and(|v| v.is_null() || v.is_string())
            || result.get("total").is_some_and(|v| v.as_u64().is_none())
        {
            return Err(BakaError::js(
                id,
                format!(
                    "{} must return {{items:[],nextCursor:string|null,total?:unsigned integer}}",
                    call.capability
                ),
            ));
        }
        if let Some(next) = result["nextCursor"].as_str() {
            if next.is_empty()
                || next.len() > 2048
                || result["items"].as_array().is_none_or(Vec::is_empty)
                || call.request["cursor"].as_str() == Some(next)
            {
                return Err(BakaError::js(
                    id,
                    "V2 page made no progress or returned an invalid cursor",
                ));
            }
        }
        if result["items"].as_array().unwrap().len()
            > call.request["limit"].as_u64().unwrap_or(30) as usize
        {
            return Err(BakaError::js(id, "V2 page exceeds requested limit"));
        }
        {
            if call.account_epoch
                != self
                    .account_epoch
                    .load(std::sync::atomic::Ordering::Acquire)
            {
                return Err(BakaError::js(
                    id,
                    "V2 account changed while fetching page; restart from page one",
                ));
            }
        }
        Ok(result)
    }
}

fn is_page(cap: &str) -> bool {
    matches!(
        cap,
        "search"
            | "collections.members"
            | "discovery.charts"
            | "discovery.chartTags"
            | "discovery.playlistTags"
            | "discovery.playlists"
            | "discovery.hotSearch"
            | "discovery.recommendations"
            | "discovery.daily"
            | "discovery.similar"
            | "discovery.searchSuggestions"
            | "comments.list"
    )
}
