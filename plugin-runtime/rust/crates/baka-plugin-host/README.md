# Baka plugin host

Executes only canonical V2 packages in isolated QuickJS contexts. Every source
starts with the exact `// @baka-provider 2` first line and synchronously exports
`{manifest, handlers}`. Shared `baka-core::plugin_contract::PackageManifest`
validation is authoritative for identity, kinds, sources and capabilities.

`PluginHost::new` and `new_with_network` install the same generic native SDK.
`load_v2_script` requires manifest ID to equal the host/storage ID. No legacy
script loaders, npm modules, Buffer, DOM or LX event runtime are installed.
`manifest()` returns a complete validated snapshot, including author and metadata.
`inspect_source(source, variables)` evaluates metadata in a disposable context
with no persistent storage, initialization I/O or handler calls.

`call_entry("search", &[request])` dispatches exactly one named object to a
declared capability. Paged responses retain opaque cursors without page-number
projection or hidden metadata calls. Successful account changes retire in-flight
pages. Native HTTP, timers and storage retain call cancellation and lifecycle
shutdown guards. `plugin_network::PluginNetwork` shares proxy/workspace transport
policy; probing is an explicit caller operation. Native lyrics retain parsing,
repair, decryption and export; provider protocol rules remain plugin-owned.

Call `configure_storage` with an absolute application-support directory. Native
storage is bound only after manifest identity validates. Use `examples/v2_probe`
for canonical package diagnostics. Run `cargo test -p baka-core -p baka-plugin-host`
from `rust/`; these tests are separate from live-provider/device evidence.
