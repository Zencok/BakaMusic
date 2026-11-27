# Download identity and policy

Entity ownership, request deduplication and execution ownership have separate
identities. SHA-256 resource/request keys never replace the stored canonical
identity; the coordinator checks the canonical value on digest matches. Audio
deduplication preserves one ordinary download entry; MV requests include quality.

Job IDs never contain provider names, display names or raw song IDs. Recreated
jobs get new IDs. Generation/revision/operation counters use checked Rust u64
arithmetic and canonical decimal JSON strings. No SQLite text ordering or Dart
integer arithmetic determines fencing.

The retry policy is deliberately independent of transport. It cannot infer
quality availability from free-form error messages. Native admission and the
durable store must enforce worker ownership and recovery barriers separately.

2026-11-27: introduced these primitives to remove task-ID length coupling and
cross-language counter ambiguity. Device performance is not inferred from tests.
