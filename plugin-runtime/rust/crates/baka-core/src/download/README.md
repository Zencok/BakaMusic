# Canonical download domain

Pure Rust types for V2 download resource/request identity, independent job IDs,
decimal-string u64 sequences, lifecycle policy and finite retry budgets. No HTTP,
SQLite, UI, plugin execution or platform state lives here.

`ResourceIdentity` uses the shared validated `EntityRef`. Numeric IDs normalize
while string IDs remain distinct. `JobId` receives 128 bits of OS entropy from
the coordinator and has the fixed `dl2_` + 32 lowercase hex representation.

See [DESIGN.md](DESIGN.md) and the application's
[download design](../../../../../docs/design/plugin-v2/DOWNLOADS.md).

Validation: `cargo test -p baka-core download` from `rust/`.
