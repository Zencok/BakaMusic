//! Process-wide diagnostics. No network traffic, headers or bodies are collected.
//! All producers redact before storage; database work is called off Flutter's UI.
use regex::Regex;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const CAPACITY: usize = 3000;
const MAX_TEXT: usize = 8192;
const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub time: u64,
    pub level: String,
    pub category: String,
    pub tag: String,
    pub message: String,
    pub detail: String,
    pub session: String,
}

pub struct Store {
    entries: VecDeque<Entry>,
    crashes: VecDeque<Entry>,
    db: Option<Connection>,
    next: i64,
    session: String,
    storage_error: Option<String>,
    bytes: usize,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            crashes: VecDeque::new(),
            db: None,
            next: 1,
            session: format!("{}-{}", now(), std::process::id()),
            storage_error: None,
            bytes: 0,
        }
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Best-effort redaction, intentionally removing whole URL paths/query strings.
/// Free-form text can still contain personal information; review before sharing.
pub fn redact(text: &str) -> String {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let rules = RULES.get_or_init(|| vec![
        (Regex::new(r#"(?i)https?://[^\s<>\"']+"#).unwrap(), "[URL]"),
        (Regex::new(r#"(?im)(authorization|proxy-authorization|cookie|set-cookie)\s*[\"']?\s*[:=][^\r\n]*"#).unwrap(), "$1=[REDACTED]"),
        (Regex::new(r#"(?i)(bearer|basic)\s+[a-z0-9+/=._-]+"#).unwrap(), "$1 [REDACTED]"),
        (Regex::new(r#"(?i)([\"']?(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|api[_-]?key)[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;&}]+)"#).unwrap(), "$1[REDACTED]"),
        (Regex::new(r#"(?i)(?:content|file)://[^\s\"']+|[a-z]:\\[^\r\n\"']+|/(?:data|storage|sdcard|Users|home)/[^\r\n\"']+"#).unwrap(), "[PATH]"),
    ]);
    // Bound work before applying regexes, then bound expansion too (UTF-8 safe).
    let mut output: String = text.chars().take(MAX_TEXT).collect();
    for (pattern, replacement) in rules {
        output = pattern.replace_all(&output, *replacement).into_owned();
    }
    output.chars().take(MAX_TEXT).collect()
}

impl Store {
    pub fn open(&mut self, path: &str) -> Result<(), String> {
        if self.db.is_some() {
            return Ok(());
        }
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS crashes (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 3000);",
        )
        .map_err(|e| e.to_string())?;
        let mut restored = VecDeque::new();
        {
            let mut query = db
                .prepare("SELECT payload FROM logs ORDER BY id")
                .map_err(|e| e.to_string())?;
            let rows = query
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                if let Ok(entry) = serde_json::from_str::<Entry>(&row.map_err(|e| e.to_string())?) {
                    self.next = self.next.max(entry.id.saturating_add(1));
                    restored.push_back(entry);
                }
            }
        }
        self.crashes.clear();
        {
            let mut query = db
                .prepare("SELECT payload FROM crashes ORDER BY id DESC LIMIT 10")
                .map_err(|e| e.to_string())?;
            let rows = query
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                if let Ok(entry) = serde_json::from_str::<Entry>(&row.map_err(|e| e.to_string())?) {
                    self.next = self.next.max(entry.id.saturating_add(1));
                    self.crashes.push_front(entry);
                }
            }
        }
        let pending = std::mem::take(&mut self.entries);
        self.entries = restored;
        self.bytes = self.entries.iter().map(entry_bytes).sum();
        self.db = Some(db);
        self.trim();
        for mut entry in pending {
            entry.id = self.next;
            self.next += 1;
            self.insert(entry);
        }
        Ok(())
    }

    fn trim(&mut self) {
        while self.entries.len() > CAPACITY || self.bytes > MAX_BYTES {
            if let Some(entry) = self.entries.pop_front() {
                self.bytes -= entry_bytes(&entry);
            }
        }
    }

    fn insert(&mut self, entry: Entry) {
        self.bytes += entry_bytes(&entry);
        self.entries.push_back(entry.clone());
        self.trim();
        if entry.category == "crash" {
            self.crashes.push_back(entry.clone());
            while self.crashes.len() > 10 {
                self.crashes.pop_front();
            }
        }
        if let Some(db) = &mut self.db {
            let oldest = self.entries.front().map_or(entry.id + 1, |e| e.id);
            let result = (|| -> rusqlite::Result<()> {
                let tx = db.transaction()?;
                tx.execute(
                    "INSERT INTO logs VALUES (?1, ?2)",
                    params![entry.id, serde_json::to_string(&entry).unwrap()],
                )?;
                tx.execute("DELETE FROM logs WHERE id < ?1", [oldest])?;
                if entry.category == "crash" {
                    tx.execute(
                        "INSERT INTO crashes VALUES (?1, ?2)",
                        params![entry.id, serde_json::to_string(&entry).unwrap()],
                    )?;
                    tx.execute("DELETE FROM crashes WHERE id NOT IN (SELECT id FROM crashes ORDER BY id DESC LIMIT 10)", [])?;
                }
                tx.commit()
            })();
            if let Err(error) = result {
                self.storage_error = Some(error.to_string());
            }
        }
    }

    pub fn record(&mut self, level: &str, category: &str, tag: &str, message: &str, detail: &str) {
        let level = match level.to_ascii_uppercase().as_str() {
            "DEBUG" | "VERBOSE" => "DEBUG",
            "WARN" | "WARNING" => "WARN",
            "ERROR" | "FATAL" => "ERROR",
            _ => "INFO",
        };
        let entry = Entry {
            id: self.next,
            time: now(),
            level: level.into(),
            category: redact(category).chars().take(64).collect(),
            tag: redact(tag).chars().take(128).collect(),
            message: redact(message),
            detail: redact(detail),
            session: self.session.clone(),
        };
        self.next += 1;
        self.insert(entry);
    }

    fn total(&self) -> usize {
        self.entries.len()
            + self
                .crashes
                .iter()
                .filter(|e| !self.entries.iter().any(|recent| recent.id == e.id))
                .count()
    }

    fn selected(&self, request: &Value) -> Vec<&Entry> {
        let query = request["query"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let mut entries = self
            .entries
            .iter()
            .chain(
                self.crashes
                    .iter()
                    .filter(|e| !self.entries.iter().any(|recent| recent.id == e.id)),
            )
            .collect::<Vec<_>>();
        entries.sort_by_key(|e| std::cmp::Reverse(e.id));
        entries
            .into_iter()
            .filter(|entry| {
                [
                    ("level", entry.level.as_str()),
                    ("category", entry.category.as_str()),
                    ("session", entry.session.as_str()),
                ]
                .iter()
                .all(|(key, value)| {
                    request[*key]
                        .as_str()
                        .is_none_or(|v| v.is_empty() || v == *value)
                }) && (!request["crashes"].as_bool().unwrap_or(false) || entry.category == "crash")
                    && (query.is_empty()
                        || format!(
                            "{} {} {} {} {}",
                            entry.level, entry.category, entry.tag, entry.message, entry.detail
                        )
                        .to_lowercase()
                        .contains(&query))
            })
            .collect()
    }

    pub fn command(&mut self, request: &Value) -> Result<Value, String> {
        match request["op"].as_str().unwrap_or("") {
            "init" => {
                self.open(request["path"].as_str().ok_or("Missing database path")?)?;
                Ok(json!({"session": self.session}))
            }
            "append" => {
                for entry in request["entries"]
                    .as_array()
                    .ok_or("Missing entries")?
                    .iter()
                    .take(256)
                {
                    let field = |key: &str| entry[key].as_str().unwrap_or("");
                    self.record(
                        field("level"),
                        field("category"),
                        field("tag"),
                        field("message"),
                        field("detail"),
                    );
                }
                Ok(json!({}))
            }
            "read" => {
                let entries = self.selected(request);
                let offset = request["offset"].as_u64().unwrap_or(0).min(CAPACITY as u64) as usize;
                let limit = request["limit"].as_u64().unwrap_or(200).min(500) as usize;
                Ok(
                    json!({"entries": entries.iter().skip(offset).take(limit).collect::<Vec<_>>(),
                    "matched": entries.len(), "total": self.total(), "session": self.session,
                    "persistent": self.db.is_some(), "storageError": self.storage_error}),
                )
            }
            "export" => {
                let entries = self.selected(request);
                let text = entries
                    .iter()
                    .map(|e| {
                        format!(
                            "{} [{}] {}/{} (session {})\n{}\n{}\n",
                            e.time, e.level, e.category, e.tag, e.session, e.message, e.detail
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(
                    json!({"text": format!("BakaMusic diagnostics v1\nNewest first; timestamps: Unix milliseconds\nEntries: {} / {}\n{}\n\n{}", entries.len(), self.total(), redact(request["environment"].as_str().unwrap_or("")), text)}),
                )
            }
            "clear" => {
                let crashes = request["crashes"].as_bool().unwrap_or(false);
                if let Some(db) = &mut self.db {
                    let tx = db.transaction().map_err(|e| e.to_string())?;
                    tx.execute("DELETE FROM crashes", [])
                        .map_err(|e| e.to_string())?;
                    if crashes {
                        // Delete by IDs rather than depending on SQLite JSON support.
                        for entry in self.entries.iter().filter(|e| e.category == "crash") {
                            tx.execute("DELETE FROM logs WHERE id=?1", [entry.id])
                                .map_err(|e| e.to_string())?;
                        }
                    } else {
                        tx.execute("DELETE FROM logs", [])
                            .map_err(|e| e.to_string())?;
                    }
                    tx.commit().map_err(|e| e.to_string())?;
                }
                if crashes {
                    self.entries.retain(|e| e.category != "crash");
                } else {
                    self.entries.clear();
                }
                self.bytes = self.entries.iter().map(entry_bytes).sum();
                self.crashes.clear();
                Ok(json!({}))
            }
            _ => Err("Unknown diagnostics command".into()),
        }
    }
}

fn entry_bytes(e: &Entry) -> usize {
    // JSON escaping can use six bytes per input byte; reserve the worst case.
    256 + 6
        * (e.level.len()
            + e.category.len()
            + e.tag.len()
            + e.message.len()
            + e.detail.len()
            + e.session.len())
}

fn global() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

enum Job {
    Record([String; 5]),
    Command(Value, std::sync::mpsc::Sender<Result<Value, String>>),
}

static DROPPED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn writer() -> Result<&'static std::sync::mpsc::SyncSender<Job>, String> {
    static WRITER: OnceLock<Result<std::sync::mpsc::SyncSender<Job>, String>> = OnceLock::new();
    WRITER
        .get_or_init(|| {
            let (send, receive) = std::sync::mpsc::sync_channel::<Job>(256);
            std::thread::Builder::new()
                .name("baka-diagnostics".into())
                .spawn(move || {
                    for job in receive {
                        match job {
                            Job::Record(fields) => {
                                if let Ok(mut store) = global().lock() {
                                    store.record(
                                        &fields[0], &fields[1], &fields[2], &fields[3], &fields[4],
                                    );
                                } else {
                                    DROPPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                            Job::Command(request, response) => {
                                let result = global()
                                    .lock()
                                    .map_err(|_| "Diagnostics store unavailable".to_string())
                                    .and_then(|mut store| store.command(&request));
                                let _ = response.send(result);
                            }
                        }
                    }
                })
                .map_err(|e| e.to_string())?;
            Ok(send)
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn record(level: &str, category: &str, tag: &str, message: &str, detail: &str) {
    // Producers never wait for disk or for another producer. Redact before
    // crossing even this bounded in-process queue.
    let fields = [
        redact(level).chars().take(16).collect(),
        redact(category).chars().take(64).collect(),
        redact(tag).chars().take(128).collect(),
        redact(message),
        redact(detail),
    ];
    if writer()
        .and_then(|send| {
            send.try_send(Job::Record(fields))
                .map_err(|e| e.to_string())
        })
        .is_err()
    {
        DROPPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

pub fn command(request: &Value) -> Result<Value, String> {
    if request["op"] == "init" {
        install_panic_hook();
    }
    // A command is also a FIFO barrier for previously accepted producer logs.
    // Flutter calls this from a worker isolate, never its rendering isolate.
    let (send, receive) = std::sync::mpsc::channel();
    writer()?
        .send(Job::Command(request.clone(), send))
        .map_err(|_| "Diagnostics writer stopped")?;
    let mut result = receive.recv().map_err(|_| "Diagnostics writer stopped")??;
    if request["op"] == "clear" && !request["crashes"].as_bool().unwrap_or(false) {
        DROPPED.store(0, std::sync::atomic::Ordering::Relaxed);
    }
    if request["op"] == "read" {
        result["dropped"] = json!(DROPPED.load(std::sync::atomic::Ordering::Relaxed));
    }
    Ok(result)
}

fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // Do not deadlock if the store itself panics.
            if let Ok(mut store) = global().try_lock() {
                store.record("ERROR", "crash", "Rust", &info.to_string(), "Native panic");
            }
            previous(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_producers_do_not_wait_for_store_and_commands_are_barriers() {
        let guard = global().lock().unwrap();
        for _ in 0..400 {
            record("INFO", "app", "queue", "token=hidden-value", "");
        }
        drop(guard);
        let result = command(&json!({"op":"read", "tag":"queue", "limit":500})).unwrap();
        assert!(result["matched"].as_u64().unwrap() > 0);
        assert!(result["dropped"].as_u64().unwrap() > 0);
        assert!(!result.to_string().contains("hidden-value"));
    }
    #[test]
    fn redacts_credentials_urls_paths_and_preserves_unicode() {
        let value = redact(
            "token=abc password=secret\nAuthorization: Bearer secret\nhttps://user:pwd@host/private?q=secret\n/storage/emulated/0/private.mp3\n你好",
        );
        for secret in ["abc", "secret", "private", "user:pwd"] {
            assert!(!value.contains(secret), "{value}");
        }
        assert!(value.contains("你好"));
        assert!(!redact(r#"{"api_key":"abc", "refresh_token": "def"}"#).contains("abc"));
        assert_eq!(redact(&"词".repeat(20000)).chars().count(), MAX_TEXT);
    }
    #[test]
    fn persists_pending_records_filters_pages_and_clears_crashes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs.sqlite");
        let mut store = Store::default();
        store.record("warn", "playback", "Player", "你好", "stack needle");
        store.open(path.to_str().unwrap()).unwrap();
        store.record("error", "crash", "Flutter", "failure", "stack");
        assert_eq!(
            store
                .command(&json!({"op":"read", "query":"NEEDLE", "level":"WARN"}))
                .unwrap()["matched"],
            1
        );
        assert_eq!(
            store
                .command(&json!({"op":"read", "offset":1,"limit":1}))
                .unwrap()["entries"][0]["category"],
            "playback"
        );
        drop(store);
        let mut store = Store::default();
        store.open(path.to_str().unwrap()).unwrap();
        assert_eq!(store.entries.len(), 2);
        assert_eq!(
            store.command(&json!({"op":"read","crashes":true})).unwrap()["matched"],
            1
        );
        store
            .command(&json!({"op":"clear","crashes":true}))
            .unwrap();
        assert_eq!(store.entries.len(), 1);
        assert!(
            store
                .command(&json!({"op":"export","query":"你好"}))
                .unwrap()["text"]
                .as_str()
                .unwrap()
                .contains("stack needle")
        );
        store.command(&json!({"op":"clear"})).unwrap();
        drop(store);
        let mut store = Store::default();
        store.open(path.to_str().unwrap()).unwrap();
        assert!(store.entries.is_empty());
    }
    #[test]
    fn bounded_storage_keeps_latest_records() {
        let mut store = Store::default();
        for i in 0..CAPACITY + 30 {
            store.record("info", "app", "test", &i.to_string(), "");
        }
        assert_eq!(store.entries.len(), CAPACITY);
        assert_eq!(store.entries.front().unwrap().message, "30");
        assert_eq!(
            store.command(&json!({"op":"read","limit":99999})).unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            500
        );
    }

    #[test]
    fn crash_archive_survives_log_rotation_restart_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs.sqlite");
        let mut store = Store::default();
        store.open(path.to_str().unwrap()).unwrap();
        for i in 0..12 {
            store.record("ERROR", "crash", "test", &format!("crash {i}"), "stack");
        }
        // Large text forces byte retention long before the count limit.
        for _ in 0..200 {
            store.record(
                "INFO",
                "app",
                "noise",
                &"x".repeat(MAX_TEXT),
                &"y".repeat(MAX_TEXT),
            );
        }
        assert!(store.bytes <= MAX_BYTES);
        assert!(store.entries.len() < 200);
        assert!(!store.entries.iter().any(|e| e.category == "crash"));
        drop(store);
        let mut store = Store::default();
        store.open(path.to_str().unwrap()).unwrap();
        let result = store
            .command(&json!({"op":"read", "crashes":true}))
            .unwrap();
        assert_eq!(result["matched"], 10);
        assert_eq!(result["entries"][0]["message"], "crash 11");
        store
            .command(&json!({"op":"clear", "crashes":true}))
            .unwrap();
        assert_eq!(
            store.command(&json!({"op":"read","crashes":true})).unwrap()["matched"],
            0
        );
        drop(store);
        let mut store = Store::default();
        store.open(path.to_str().unwrap()).unwrap();
        assert!(store.crashes.is_empty());
    }
}
