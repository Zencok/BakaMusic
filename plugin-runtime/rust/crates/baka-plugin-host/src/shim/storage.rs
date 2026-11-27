//! Durable plugin-local strings. SQLite transactions keep acknowledged writes atomic.
use rquickjs::{
    Ctx,
    function::{Async, Func},
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const LIMIT: usize = 10 * 1024 * 1024;

fn access(
    path: &std::path::Path,
    key: &str,
    change: Option<Option<&str>>,
) -> Result<Option<String>, String> {
    if key.is_empty() || key.len() > 1024 {
        return Err("storage key must contain 1..1024 bytes".into());
    }
    std::fs::create_dir_all(path.parent().ok_or("missing storage directory")?)
        .map_err(|e| e.to_string())?;
    let mut db = rusqlite::Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    .map_err(|e| e.to_string())?;
    if let Some(value) = change {
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        match value {
            Some(value) => {
                if value.len() > LIMIT {
                    return Err("plugin storage quota exceeded".into());
                }
                tx.execute("INSERT INTO items(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key,value]).map_err(|e| e.to_string())?;
                let size: i64 = tx.query_row("SELECT COALESCE(SUM(length(CAST(key AS BLOB))+length(CAST(value AS BLOB))),0) FROM items", [], |r|r.get(0)).map_err(|e|e.to_string())?;
                if size > LIMIT as i64 {
                    return Err("plugin storage quota exceeded".into());
                }
            }
            None => {
                tx.execute("DELETE FROM items WHERE key=?1", [key])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(None);
    }
    use rusqlite::OptionalExtension;
    db.query_row("SELECT value FROM items WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

pub(crate) fn install(ctx: &Ctx<'_>, root: PathBuf, id: &str) -> rquickjs::Result<()> {
    let path = root.join(format!(
        "{}.sqlite3",
        hex::encode(Sha256::digest(id.as_bytes()))
    ));
    let baka: rquickjs::Object = ctx.globals().get("__baka")?;
    for (name, operation) in [
        ("storage_get", 0),
        ("storage_set", 1),
        ("storage_remove", 2),
    ] {
        let path = path.clone();
        baka.set(
            name,
            Func::from(Async(
                move |key: String, value: rquickjs::function::Opt<String>| {
                    let path = path.clone();
                    async move {
                        let result = tokio::task::spawn_blocking(move || {
                            let change = match operation {
                                0 => None,
                                1 => {
                                    Some(Some(value.0.as_deref().ok_or("storage value required")?))
                                }
                                _ => Some(None),
                            };
                            access(&path, &key, change)
                        })
                        .await
                        .map_err(|e| {
                            rquickjs::Error::new_from_js_message("storage", "string", e.to_string())
                        })?;
                        result.map_err(|e| {
                            rquickjs::Error::new_from_js_message("storage", "string", e)
                        })
                    }
                },
            )),
        )?;
    }
    Ok(())
}
