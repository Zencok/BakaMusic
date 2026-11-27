# Diagnostics design

## Goals and architecture

Retain useful release-build failures across launches and provide one viewer
for both listening workspaces. Domain work stays in Rust; Flutter owns hooks,
platform streams, rendering and system file export.

Producers call record or submit JSON through baka_diagnostics from a Dart
worker isolate. Native producers redact and enqueue into a bounded 256-event
channel without waiting for storage; one Rust writer handles commands and events
in FIFO order. Commands act as barriers for accepted earlier events. A process-global
mutex serializes memory updates, SQLite writes and snapshots. It does not depend on an engine/workspace permit
and never enables online services. Early native entries merge into the database
when the application-private storage opens.

## Decisions and tradeoffs

SQLite transactions keep insert/retention atomic. DELETE journaling avoids a
growing WAL; secure-delete clears removed payloads. Pages retain their high-water
allocation: 8 MiB describes payload accounting, not an exact file-size promise.
Accounting reserves six times string bytes plus overhead for JSON escaping.
Each text field is capped at 8,192 Unicode scalars. Ten exception entries are
copied into an independent table and merged by ID without duplicate UI rows.

UI reads contain 200 entries; native reads cannot request over 500 per page.
Filtered exports cover all retained matching entries using the same predicate
as reads. A launch session distinguishes restored records. Dart batches ordinary
events for 250 ms, flushes errors immediately and caps its waiting batch at 256.
One append may wait behind a running append. Dropped/write-failed counts remain
visible. The native producer queue also reports dropped counts. Logging failure must not stop startup/playback.

The panic hook tries the store lock instead of deadlocking on a store panic,
and chains the previous reporter. OS termination and process corruption can
prevent the final write; this is not a replacement for OS crash reporting.

## Security boundary

Threats include plugin credentials, signed media URLs, local paths and export
disclosure. Redaction precedes memory/disk storage and covers every text field.
URLs are entirely removed; common password/token/header assignments and private
paths are replaced. HTTP diagnostics deliberately omit URLs, headers and bodies.
Database paths are supplied only by trusted application code.

Regex redaction is best effort, not anonymity or encryption. Arbitrary text may
contain names, emails or unusual secrets; the viewer advises review before
sharing. There is no telemetry or automatic external transmission. Copies are
bounded to one entry; export uses the existing document save service.

## Known limits and history

2026-10-19: Initial shared implementation. Android current-process logcat is a
supplemental stream; unavailable/terminated collection is recorded. Network
coverage is the MusicFree/LX request adapters, not every dependency's traffic.
SIGSEGV, OOM, ANR and uncaught child-isolate errors are not guaranteed captures.
See docs/LOGGING.md for host tests and pending device evidence.
