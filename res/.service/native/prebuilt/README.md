# Developer-only native prebuilts

These `.node` binaries are vendored from the private [`baka-native`](https://github.com/Zencok/baka-native) release pipeline so contributors can run `npm run dev` without building C++ or downloading private release assets.

| Path | Content |
|------|---------|
| `win32-x64/` | Windows x64 (`qmc2` / `ence` / `taglib`) |
| `darwin-x64/` | macOS Intel |
| `darwin-arm64/` | macOS Apple Silicon |
| `linux-x64/` | Linux x64 |
| `linux-arm64/` | Linux arm64 |

## Usage

```bash
npm run native:install
```

Copies `prebuilt/<your-platform>/*` into `res/.service/native/` (the runtime load path).

## Not for end users

- Installers / packaged apps should not rely on this tree as a distribution channel.
- Product packaging continues to ship only the **current platform** modules under `res/.service/native/*.node` (or install from the pinned release manifest in CI).
- Refresh from a new `baka-native` release:

```bash
gh release download <tag> --repo Zencok/baka-native --dir artifacts/native-release-fetch
# extract archives into the platform folders, then:
npm run native:update-manifest -- --release=<tag>
npm run native:install
```

Pinned release metadata: `scripts/native-modules-manifest.json`.
