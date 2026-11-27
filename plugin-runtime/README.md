# Native V2 plugin runtime

This independent Cargo workspace builds the Rust QuickJS plugin service used by
Electron. It never loads Node plugin code and has no sibling-checkout dependency.
Run `npm run build:plugin-runtime` from the application root. Rust 1.100.0 and a
native C/C++ toolchain are required. `npm run test:plugin-runtime` runs the actual
stdio service against trusted fixtures and a local HTTP server.

The JSON-RPC 2 protocol accepts health, prepareImport, inspect, load, invoke,
unload, clear and cancel. Every request has a string ID and object params. Frames are UTF-8 JSON
lines, bounded at 16 MiB; stdout contains only protocol responses. There are at
most 128 pending requests and four executing calls. Settings are immutable per
loaded host. Native shutdown retires active calls and background I/O.

`prepareImport` accepts `{source,kind?,id?,name?,locator?,variables?,enabled?,installedLx?,proxyUrl?}`.
`kind` is `auto`, `v2` or `lx`; explicit LX selection permits obfuscated scripts
without detection hints. Marked V2 documents always return `{source}` for strict
inspection, including malformed documents. They never fall back to LX execution.
An LX import returns `{source,id,originalId,manifest}`. The generated source embeds
the exact original LX string and adapts its event/callback API to V2 in QuickJS;
no Node VM, npm modules or old Baka/MusicFree host runs. Call `inspect` before
publishing either result.

The converted package installs its LX API, global aliases, immutable settings and
timer/buffer wrappers on its own actual QuickJS global object. Original scripts
can discover LX through indirect `eval`, `Function('return this')()`, free-variable
Function lookups and constructor chains. Each package owns a separate context;
ordinary V2 packages retain the lean environment. Native timers are captured
before wrappers are published so dynamic timeout calls remain cancellable.

The original install identity determines the stable generated ID. `installedLx`
rows contain `{id,name,enabled,variables}` so named updates retain saved identity,
settings and disabled state. An explicit `id` wins. Disabled originals compile
without running initialization; their `conversion.initializationVerified` is
false. Enabled originals initialize in a disposable observed host using supplied
variables and proxy settings. Import preparation has a 15 second outer deadline,
with bounded LX initialization inside it. Cancellation, clear and process shutdown
retire temporary hosts and their HTTP/timers before any result can publish.

The adapter preserves callback HTTP, binary buffers, hashing/AES/RSA and zlib
through the native SDK. Configuration views/update alerts have no V2 UI callback;
per-request cancellation suppresses callbacks while native call cancellation owns
transport abort. Persistent background intervals follow the V2 call lifecycle.
`scripts/lx-import-native.test.cjs` verifies these boundaries with unchanged and
packed eval/Function fixtures. Inspection/initialization is distinct from live
provider playback verification.

`rust/crates/{baka-core,baka-logging,baka-plugin-host}` and
`rust/vendor/rquickjs-sys` are unchanged imports from BakaMusicFlutter commit
236e46302cfb4334bd964bde38991fbbeb339d07. Shared contract/duration vectors retain
their original relative paths. See `UPSTREAM.json`, `licenses/` and component
licenses for provenance and terms. The upstream QuickJS host-job-context patch
is required for call-owned cancellation on every desktop target.

`src/lx_v2_migration.rs` and `src/lx_v2_adapter.js` adapt the existing Flutter LX
converter from commit a705a471a863697c14115a3868961df524a7f2c2. Desktop request
lifetimes replace workspace leases. The original evaluator retains immutable
settings after the host removes its temporary global environment, and converted
packages publish their compatibility API on their own actual global object. Original paths,
hashes and adaptation notes are recorded in `UPSTREAM.json`.

The build stages only the host platform executable plus license/provenance
material under `res/.service/plugin-v2/<platform>-<arch>/`. Target source and Cargo
artifacts are excluded from application packaging. `CARGO`, `CARGO_TARGET_DIR`,
`BAKA_PLUGIN_RUNTIME_TARGET`, `BAKA_PLUGIN_RUNTIME_PROFILE`, and the build script's
`--target`, `--platform`, `--arch`, `--profile` options support explicit toolchains
and build targets. Cross builds require matching target C/C++ tools; packaged
runtime smoke runs on the target OS/architecture.
