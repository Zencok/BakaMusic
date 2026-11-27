# baka-logging

Shared application diagnostics for BakaMusic, independent of workspaces and
plugin engine lifetimes. Flutter and native producers share one process store.

## Features

- Structured timestamp, level, category, tag, message, detail and launch session.
- App-private SQLite persistence across launches, newest-first reads and exports.
- At most 3,000 recent entries within an 8 MiB conservative payload budget.
- Ten separately archived exceptions survive ordinary log rotation.
- Search, level/category/session filters, pagination and selective clear.
- URL, common credential and private-path redaction before storage.

## Usage

```rust
use baka_logging::{command, record};
use serde_json::json;

// The application creates this private directory off Flutter's UI isolate.
command(&json!({"op":"init", "path":"/absolute/private/logs.sqlite"}))?;
record("WARN", "playback", "Player", "Source unavailable", "details");
let page = command(&json!({"op":"read", "level":"WARN", "limit":200}))?;
# Ok::<(), String>(())
```

Commands: init, append (up to 256 entries), read (up to 500 per page), export,
and clear. Read/export accept query, level, category, session and crashes.
Clear ignores search filters: crashes:true clears all exceptions; otherwise
it clears all diagnostics. Search includes exception details.

## Dependencies and layout

serde/serde_json define the boundary; regex handles redaction; rusqlite owns
persistence. src/lib.rs contains the store and regression tests. baka-ffi
exports baka_diagnostics; baka-plugin-host records console/network events.
Flutter core/app_log.dart provides platform adapters and worker-isolate calls;
features/settings/log_page.dart owns the shared viewer.

## Validation

From rust/: cargo test -p baka-logging.
Host tests exercise storage and redaction; device log collection requires
separate platform validation.
