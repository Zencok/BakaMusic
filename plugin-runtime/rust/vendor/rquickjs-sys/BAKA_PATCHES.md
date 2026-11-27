# rquickjs-sys 0.14.0 platform bindings and host job contexts

Upstream source: crates.io rquickjs-sys 0.14.0 (MIT), archive SHA-256
cee271d0eeba64f0915b846cb7ae02e16faf3dfdffdca91731101d9d30fe3423.
QuickJS source and existing license headers are retained.
Only the native source distribution is needed here; upstream WASM libc archives
and unrelated engine examples are not imported. WASM is not a supported build
target for this vendored package.

Android ARM64/x86_64 bindings are copied from this version's matching Linux-musl
LP64 bindings, not from 0.9.0. The ABI structs contain no libc objects. Both
Android targets must compile against the updated engine before release.

Apple builds retain target-specific bindgen with cc's actual Clang arguments,
SDK and deployment target. Host include discovery is disabled for iOS; bundled
host bindings still follow the upstream host/cross-compilation guard. Windows
checks are not evidence of an Apple build.

## Call-owned asynchronous work (2026-10-20)

`quickjs.c` / `quickjs.h` add the private embedding helpers
`JS_GetHostJobContext` / `JS_SetHostJobContext`. The opaque `uint64_t` defaults
to zero. Jobs capture it at enqueue and restore the previous value on return;
promise reactions capture the subscriber's context at registration, for both
pending and already-settled promises (including native async/await). In
particular, settling a shared promise must not replace its subscribers' contexts
with the settling call's context. No JS values, pointers, GC roots, or request
data are added to the context field.

The Rust host uses these helpers only under `AsyncContext::with` / native
function runtime locks. Its private extern declarations match this header on
all targets; public opaque QuickJS types and Baka's C/Flutter ABI are unchanged.
Keep the Rust host and this source patch together when upgrading QuickJS.
The build script now tracks copied C sources/headers and `quickjs.bind.h`, so
warm builds rebuild the engine when this extension changes.

Host tests cover delayed/settled/shared promises, timers, concurrent subscribers,
HTTP header/body cancellation, background work and shutdown. Apple compilation
and actual-device verification remain separate release gates.

## Android ARM32 release target (2026-10-30)

`armv7-linux-androideabi.rs` is regenerated from the vendored QuickJS
headers with bindgen 0.72.1 and Android NDK 29.0.14206865, targeting
`armv7a-linux-androideabi24` with the NDK sysroot. QuickJS uses 32-bit NaN
boxing on this target; the 64-bit Android bindings cannot be reused. The
upstream ARMv7 Linux bindings also have an outdated `JS_NewArrayBuffer`
signature, so copying them is insufficient. The release script builds ARMv7
API 24 alongside ARM64, replacing x86_64 release packages.

To regenerate, use an isolated copy of this crate with `--features
update-bindings --target armv7-linux-androideabi`, the NDK CC/AR and
`LIBCLANG_PATH`, and `BINDGEN_EXTRA_CLANG_ARGS` containing
`--target=armv7a-linux-androideabi24 --sysroot=<NDK>/toolchains/llvm/prebuilt/<host>/sysroot`
and `-resource-dir=<NDK>/toolchains/llvm/prebuilt/<host>/lib/clang/21`.
Copy back only the generated target binding; CI uses this bundled binding
and does not require bindgen at build time.
