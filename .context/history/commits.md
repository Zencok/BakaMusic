# Commit Context History

## 2026-06-08T21:48:53.3159247+08:00 — fix(lyric): dim inactive line-timed desktop lyrics
`pending`
- **Decision**: Mark desktop lyric line state independently from the unplayed-color setting
- **Decision**: Carry explicit line-vs-word timing metadata through AMLL lines
- **Decision**: Use separate brightness behavior for line-timed and word-timed lyrics
- **Files**:   - src/common/amll-lyric.ts
  - src/renderer/components/AppleMusicLyricPlayer/index.tsx
  - src/renderer-lrc/pages/index.tsx
  - src/renderer-lrc/pages/index.scss

## 2026-06-09T23:31:03.5120279+08:00 — feat(music-detail): add vinyl cover style
`pending`
- **Decision**: Persist the music detail cover style as renderer-local preference
- **Decision**: Reuse the lyric toolbar menu placeholder for the cover style selector
- **Decision**: Use golden-ratio vinyl proportions for the album-art label
- **Files**:   - res/lang/en-US.json
  - res/lang/zh-CN.json
  - res/lang/zh-TW.json
  - src/renderer/components/MusicDetail/index.scss
  - src/renderer/components/MusicDetail/index.tsx
  - src/renderer/components/MusicDetail/widgets/Lyric/index.scss
  - src/renderer/components/MusicDetail/widgets/Lyric/index.tsx
  - src/types/user-perference.d.ts

## 2026-06-10T05:33:00.282Z — feat(music-detail): add selectable vinyl tonearm styles
`pending`
- **Decision**: Offer none/classic/glass tonearm variants as renderer-local preferences
- **Decision**: Add an outer/inner drop-point option for the tonearm reach
- **Decision**: Extract tonearm rendering into dedicated components
- **Files**:   - res/lang/en-US.json
  - res/lang/zh-CN.json
  - res/lang/zh-TW.json
  - src/renderer/components/MusicDetail/index.scss
  - src/renderer/components/MusicDetail/index.tsx
  - src/renderer/components/MusicDetail/widgets/Lyric/index.scss
  - src/renderer/components/MusicDetail/widgets/Lyric/index.tsx
  - src/types/user-perference.d.ts

## 2026-06-19T21:05:16.4643844+08:00 — fix(amll): avoid clipping lyric descenders
`pending`
- **Decision**: Fix descender clipping at the lyric word-wrapper level
- **Files**:   - src/amll-core/styles/lyric-player.module.css

## 2026-06-19T21:51:21.523380+08:00 — fix(amll): keep interlude dots tracking layout while paused
`pending`
- **Decision**: Fix inside InterludeDots.update() rather than the lyric scroll logic
- **Files**:   - src/amll-core/lyric-player/dom/interlude-dots.ts

## 2026-06-19T22:08:16.474424+08:00 — feat(music-detail): default vinyl tonearm to none
`pending`
- **Decision**: Flip the tonearm fallback so the default is no tonearm
- **Files**:   - src/renderer/components/MusicDetail/index.tsx
  - src/renderer/components/MusicDetail/widgets/Lyric/index.tsx

## 2026-06-19T22:37:16.766695+08:00 — fix(amll): enlarge translation lines and highlight current line
`pending`
- **Decision**: Enlarge translation/roman sub-lines to the golden ratio
- **Decision**: Highlight the current line's translation via renderMode rather than word-progress tracking
- **Files**:   - src/amll-core/lyric-player/dom/lyric-line.ts
  - src/amll-core/styles/lyric-player.module.css

## N/A — chore(deps): upgrade to React 19 and Electron 43 beta
`pending`
- **Decision**: 升级 React 生态到 v19 以利用最新特性和性能改进
- **Decision**: 升级 Electron 到 v43 beta 以获取最新平台能力
- **Decision**: 引入 @liquid-dom 依赖为流体玻璃效果做准备
- **Decision**: 添加 @webgpu/types 为 WebGPU 渲染支持做类型基础
- **Decision**: 统一 forge.config.ts 缩进为 4 空格以符合项目规范
- **Decision**: 配置 dev server overlay 仅显示错误，减少开发干扰
- **Files**:   - forge.config.ts
  - package-lock.json
  - package.json

## 2026-06-28T11:30:00+08:00 — feat(native): add luna CENC proxy and private native CI
`pending`
- **Decision**: Keep native sources in a private repository
- **Decision**: Use a read-only deploy key for private native checkout
- **Decision**: Wrap Forge ignore instead of replacing it
- **Decision**: Route CENC cek media through luna-proxy
- **Files**:   - .github/workflows/build.yml
  - forge.config.ts
  - package.json
  - res/.service/luna-proxy.cjs
  - res/.service/native/ence.node
  - res/.service/native/qmc2.node
  - scripts/build-native.js
  - src/shared/plugin-manager/main/plugin-methods.ts
  - src/shared/service-manager/common.ts
  - src/shared/service-manager/main.ts
  - src/shared/service-manager/preload.ts
  - src/shared/service-manager/renderer.ts
  - src/types/plugin.d.ts

## 2026-06-29T16:30:00+08:00 — refactor(lyric): remove client-side Kuwo decryption, plugin handles it now
`c202faa0`
- **Decision**: Remove client-side Kuwo lyric decryption entirely
- **Files**:   - src/shared/plugin-manager/main/lyric-decrypt.ts

## 2026-07-16T23:49:40.2246300+08:00 — feat(lyrics): rebase AMLL core to 0.5.2
``pending``
- **Decision**: Keep src/amll-core vendored on the official 0.5.2 baseline.
- **Decision**: Reapply BakaMusic blur, romanization, interlude, brightness, and typography behavior.
- **Bug**: Reset the RAF clock before resume to prevent transient lyric jumps.
- **Files**: 57 files
- **Tests**: npm run lint; npx tsc --noEmit; npm run package; git diff --check

## 2026-07-16T23:54:41.9288238+08:00 — feat(ui): default music detail to vinyl cover
`pending`
- **Decision**: Default unset music detail cover preferences to vinyl while preserving explicit cover selections.
- **Files**: 2 files
- **Tests**: npm run lint; npx tsc --noEmit; git diff --check

## 2026-07-16T23:58:09.6956755+08:00 — fix(minimode): balance cover proportions
`pending`
- **Decision**: Use a 68px mini-mode cover to balance the 104px window height and lyric width.
- **Bug**: The unchanged 56px cover appeared undersized after the window height increase.
- **Files**: 1 file
- **Tests**: npm run lint; npx sass --no-source-map src/renderer-minimode/pages/index.scss; git diff --check

## 2026-07-17T00:25:57.9020728+08:00 — feat(statistics): redesign listening history
`pending`
- **Decision**: Unify recent ordering, play counts, timestamps, and migration in listeningStatistics.
- **Decision**: Count after playable source setup and keep statistics playback independent from queue replacement.
- **Decision**: Replace the recent-playlist page with a searchable recent/ranking dashboard and legacy route redirect.
- **Bug**: Replaying a history row now moves it to the top without removing it.
- **Bug**: Use normal document flow so every statistics row remains inside the list surface.
- **Files**: 18 files
- **Tests**: model test; ESLint; TypeScript; SCSS; diff check; Forge webpack stage

## 2026-07-17T00:33:43.5888632+08:00 — refactor(statistics): simplify dashboard layout
`pending`
- **Decision**: Match the download-management title surface and compact controls.
- **Decision**: Merge the four metric cards into a minimal divided bar while enlarging total plays.
- **Decision**: Remove duplicate horizontal top-three cards and retain rank emphasis in the list.
- **Files**: 2 files
- **Tests**: ESLint; TypeScript; SCSS; diff check

## 2026-07-17T00:53:28.9360021+08:00 — refactor(sidebar): reorganize navigation layout
`pending`
- **Decision**: Reorganize the sidebar into discovery, library, and playlist groups within a fixed 220px rail.
- **Decision**: Support collapsible discovery and library groups in flat and glass modes while preserving their distinct visual treatments.
- **Decision**: Replace the extensions footer with an accessible plugin-management icon in the discovery header.
- **Decision**: Restore familiar navigation wording and synchronize Simplified Chinese, Traditional Chinese, and English.
- **Files**: 12 files
- **Tests**: ESLint; TypeScript; SCSS; i18n JSON parse; diff check

## 2026-07-17T13:14:11.4620892+08:00 — feat(statistics): track actual listening duration
`pending`
- **Decision**: Measure listening time only from active, continuous playback progress and reject duration estimates.
- **Decision**: Persist `totalListeningSeconds` in listening-statistics schema version 2; legacy histories start at zero actual seconds.
- **Decision**: Format the total with up to two localized units from seconds through years.
- **Files**: 9 files
- **Tests**: model test; ESLint; TypeScript; i18n JSON parse; diff check

## 2026-07-17T16:16:29.281482+08:00 — fix(lyric): detect fullscreen video players
`pending`
- **Decision**: Combine notification state with foreground window geometry
- **Decision**: Match both outer and client bounds in raw and DIP coordinates
- **Decision**: Ship get-windows as a CommonJS runtime external
- **Bug**: Desktop lyrics stayed above standalone video players in fullscreen even though browser fullscreen already yielded correctly.
- **Files**: 9 files
- **Tests**: lyric z-order; regression suites; ESLint; TypeScript; Forge x64 package; diff check

## 2026-07-17T16:29:41.011985+08:00 — fix(lyric): normalize line-timed lyric opacity
`pending`
- **Decision**: Apply desktop line-timed opacity exactly once
- **Bug**: Line-timed desktop lyric rows remained extremely dim even after their configured inner opacity was raised to 0.85.
- **Files**: 3 files
- **Tests**: theme contract; ESLint; TypeScript; SCSS; diff check

## 2026-07-17T17:00:29.362775+08:00 — fix(ui): separate playlist detail surfaces
`pending`
- **Decision**: Keep shadows on concrete playlist surfaces only.
- **Decision**: Reuse the shared flat card radius.
- **Decision**: Guard grouping-shadow ownership with contract tests.
- **Bug**: Transparent grouping-wrapper shadows painted through playlist section gaps and visually joined separate cards.
- **Files**: 2 files
- **Tests**: theme contract; ESLint; 10-route flat/glass runtime shadow audit; diff check

## 2026-07-17T17:32:43.3363805+08:00 — feat(statistics): enrich listening history rows
`pending`
- **Decision**: Share quality and size metadata resolution between MusicList and listening statistics.
- **Decision**: Align statistics rows with common duration, quality/size, platform, count-badge, pause, and numbering patterns.
- **Decision**: Raise auxiliary typography and apply flat row geometry consistently.
- **Files**: 9 files
- **Tests**: quality metadata; theme contract; listening statistics; ESLint; TypeScript; SCSS; hidden Electron runtime audit; diff check

## 2026-07-17T17:42:45.2810113+08:00 — fix(statistics): restore padded track numbers
`pending`
- **Decision**: Restore 01/02/03 numbering in both recent and ranking statistics tabs.
- **Bug**: Statistics numbering no longer matched the retained padded song-list presentation.
- **Files**: 2 files
- **Tests**: theme contract; ESLint; diff check

## 2026-07-17T17:46:55.6738541+08:00 — refactor(sidebar): move play-by-id action to library
`pending`
- **Decision**: Place Play by ID beside the Music Library heading and remove it from My Playlists.
- **Decision**: Reuse and generalize the shared navigation-group action.
- **Decision**: Guard shortcut ownership with a source contract.
- **Files**: 3 files
- **Tests**: theme contract; ESLint; TypeScript; diff check

## 2026-07-17T17:58:07.7850599+08:00 — feat(theme): add local and marketplace search
`pending`
- **Decision**: Share one query across the Local Theme and Theme Marketplace tabs.
- **Decision**: Match normalized multi-token theme metadata and marketplace aliases.
- **Decision**: Add localized empty states plus responsive glass and flat styling.
- **Files**: 9 files
- **Tests**: theme contract; ESLint; TypeScript; SCSS; language JSON; diff check

## 2026-07-17T18:33:56.3053680+08:00 — feat(plugin): unify ID playback and playlist import
`pending`
- **Context-Id**: 5d40f3a1-434b-4b0a-9581-08fe23933dba
- **Decision**: Replace the two-modal flow with one shared plugin selection and input panel.
- **Decision**: Normalize manual media identifier aliases and retain the exact selected plugin delegate.
- **Decision**: Validate empty playlist imports without leaving the panel.
- **Bug**: QQ Music [L2] expected alphanumeric IDs in songmid/mid rather than id alone.
- **Files**: 14 files
- **Tests**: ESLint; TypeScript; theme contract; music quality; listening statistics; lyric z-order; Electron Forge package; diff check

## 2026-07-20T22:14:53.8798903+08:00 — feat(playlist): redesign play queue panel
`pending`
- **Context-Id**: fd43c9b8-f4de-484e-b0ed-d1e6a752075c
- **Decision**: Replace the legacy pill list with an artwork-led queue rail and dedicated now-playing stage.
- **Decision**: Keep the floating current-song locator and remove the duplicate text action.
- **Decision**: Cover the floating dock region and tune glass/flat panel opacity independently.
- **Files**: 7 files
- **Tests**: TypeScript; ESLint; full regression suite; Forge package; package smoke; Electron runtime visual and geometry audit; diff check

## 2026-07-21T14:58:48.2422126+08:00 — feat(fallback): redesign crash recovery page
`pending`
- **Context-Id**: 1e0d0a11-17cb-4c01-a1b2-43081d706d23
- **Decision**: Replace the legacy warning card with a branded, draggable recovery console.
- **Decision**: Keep the error summary open and move track context into progressive disclosure.
- **Decision**: Use shared theme tokens, responsive layouts, focus-visible states, and reduced-motion support.
- **Files**: 5 files
- **Tests**: TypeScript; ESLint; full regression suite; diff check

## 2026-07-21T17:45:28.2480385+08:00 — fix(lyrics): detect duet vocal layouts
`pending`
- **Context-Id**: 82c3a262-7987-4cb8-82e6-2218ab9e2515
- **Decision**: Infer duet sides from recognized speaker prefixes, alternating singer turns, and parenthesized vocal parts while preserving title and credit metadata.
- **Decision**: Preserve word timing and AMLL duet flags when splitting inline vocal responses.
- **Decision**: Merge same-timestamp singer markers before translation folding so opening lyrics remain attached to their source row.
- **Bug**: Duet tracks stayed on the left or switched on credit rows; conservative singer-role classification now controls layout.
- **Bug**: The first timed lyric could be swallowed by a parallel marker row; marker merging now precedes translation grouping.
- **Files**: 6 files
- **Tests**: lyric duet; download lyric export; TypeScript; ESLint; diff check

## 2026-07-21T19:23:02.4974490+08:00 — fix(music-detail): clear hidden drag regions
`pending`
- **Context-Id**: 1a23087b-ecd9-458b-8da8-0197e73633bf
- **Decision**: Withdraw the native topbar drag region whenever the retained MusicDetail overlay is hidden, preserving keepMounted and restoring it on reopen.
- **Bug**: Closing MusicDetail left native drag hit slots over main-page controls because Electron ignores pointer-events/inert for app regions.
- **Files**: 2 files
- **Tests**: TypeScript; ESLint; full regression suite; diff check

## 2026-07-23T22:41:20.8002681+08:00 — docs(readme): document AMLL lyric parsing
pending
- **Context-Id**: 3a4bdcca-b4b3-45b1-b814-d2f67929a676
- **Decision**: Describe remote plugin/URL lyrics and local embedded/sidecar lyrics as inputs to one shared LyricParser pipeline.
- **Decision**: Document AMLL format coverage, sidecar precedence, rich TTML metadata, and legacy compatibility.
- **Decision**: Add README navigation and reorganize runtime, plugin, theme, and development guidance.
- **Files**: 1 file
- **Tests**: diff check

## 2026-07-23T22:42:53.2298426+08:00 — fix(music-list): auto-scroll during custom sorting
pending
- **Context-Id**: 3cbf2e2f-20f0-4b82-91da-c91c882fa3d8
- **Decision**: Scroll the resolved page container with a proportional requestAnimationFrame loop near either drag edge.
- **Decision**: Track drag position at document scope so virtual row replacement does not interrupt scrolling.
- **Bug**: Native HTML dragging did not scroll the page-level virtual container while custom sorting songs.
- **Files**: 3 files
- **Tests**: TypeScript; ESLint; full regression suite; diff check; package blocked by running development Electron file lock

## 2026-07-23T23:05:58.3169549+08:00 — fix(lyrics): preserve embedded lyric structure
pending
- **Context-Id**: 7af82f4a-e6e5-465a-b551-b8c55cc6dab8
- **Decision**: Keep AMLL for canonical ESLRC and use mixed-timestamp compatibility output only when strict parsing loses embedded rows.
- **Decision**: Prefer timed Kana/Hangul originals over short Latin romanization and classify expanded production labels independently.
- **Decision**: Extend invalid or zero-duration folded lines to the next distinct timestamp.
- **Bug**: Adjacent SYLT timestamps dropped originals; short romanization and PV metadata displaced main lyrics; zero-duration lines faded immediately.
- **Files**: 2 files
- **Tests**: five real local samples; TypeScript; ESLint; full regression suite; diff check

## 2026-07-23T23:31:52.1532010+08:00 — feat(lyrics): write linked lyrics into local files
pending
- **Context-Id**: 420faf02-fcf1-4960-b367-e10b2b4dff01
- **Decision**: Serialize the displayed linked lyric as rich TTML and clear the association only after a verified metadata write.
- **Decision**: Route local tag mutation through validated NodeRuntime IPC with backup, rollback, and read-back verification.
- **Decision**: Remove stale ID3 SYLT/USLT frames and prefer complete TTML, including compatibility repair for prior browser namespace resets.
- **Bug**: Old synchronized frames were selected as hundreds of one-word lines after overwrite; complete TTML now wins and old frames are removed.
- **Files**: 15 files
- **Tests**: TypeScript; ESLint; full regression suite; FLAC/MP3/M4A/WAV metadata round-trip; diff check; package bundles built before active-dev finalization collision
## 2026-07-26T22:13:18.643+08:00 — feat(music-detail): immersive fullscreen veil choreography

- **Context-Id**: 7013e0e9-f46e-4310-9e7f-516e817f1b1b
- **Decision**: Hide the un-animatable OS fullscreen snap behind a veil phase
- **Decision**: Dissolve lyric card chrome and idle the toolbar in fullscreen
- **Files**: 0 files
- **Tests**: npm exec tsc -- --noEmit; package && npm run smoke:package

## 2026-07-26T22:13:59.503+08:00 — test: realign stale source-text assertions to shipped code

- **Context-Id**: 7dae4139-e79c-4acf-b267-b08b66b6dbd7
- **Decision**: Match assertions to shipped implementation instead of reverting code
- **Bug**: npm test failed on a clean tree at theme-contract and toolchain.
- **Files**: 0 files
- **Tests**: test:theme-contract; test:toolchain

## 2026-07-26T22:14:17.315+08:00 — fix(main): survive main-window destruction and bad plugin results

- **Context-Id**: 051e8522-9ed8-4bd8-81e1-859f3ac8f13f
- **Decision**: Latch a quitting flag on before-quit
- **Decision**: Re-create extension ports and guard destroyed windows everywhere
- **Decision**: Make the shared plugin host tolerate one bad plugin
- **Bug**: Install-update on default Windows config left a hidden zombie process while the installer ran against locked files.
- **Bug**: Tray commands crashed and all lyric/minimode IPC was denied after the main window closed with the app alive.
- **Files**: 0 files
- **Tests**: test:service-manager; package && npm run smoke:package

## 2026-07-26T22:14:42.109+08:00 — fix(download): scope worker recovery and lift watcher-scan timeout

- **Context-Id**: 3aa1664b-38eb-4f8c-bd95-6f4fb73cb021
- **Decision**: Recover the worker only on runtime transport failures
- **Decision**: Give watcher-scan its own long timeout
- **Bug**: Batch-downloading an album with one unavailable track thrashed all downloads and retried the bad track endlessly.
- **Files**: 0 files
- **Tests**: test:phase3-network; test:phase5-security

## 2026-07-26T22:15:06.246+08:00 — fix(playback): recover failed loads and stabilize queue identity

- **Context-Id**: 17407c12-62a8-4803-95a8-707bd5f04baf
- **Decision**: Reload on same-media when the controller has no source
- **Decision**: Stop orphaned audio from the main process
- **Decision**: String-key media identity and sparse sheet positions
- **Bug**: Clicking a track that failed while offline did nothing after the network returned.
- **Files**: 0 files
- **Tests**: test:playback-boundary; test:phase4-data

## 2026-07-26T22:15:26.302+08:00 — fix(lyrics): apply LRC offset to timeline and fix TTML romanization

- **Context-Id**: ccecdf84-52e8-4163-9bc5-ecaf57416dc1
- **Decision**: Bake offset into the timeline once at parse time
- **Decision**: Pair romanization by pre-filter line index
- **Bug**: Nonzero [offset:] desynced word highlight and line progress across all lyric views; empty TTML lines misaligned romanization.
- **Files**: 0 files
- **Tests**: test:lyric-formats; test:lyric-duet

## 2026-07-26T22:15:35.295+08:00 — fix(media-identity): refine multi-artist name splitting

- **Context-Id**: 716adff4-ea67-4e74-a5c7-785449e8f5dd
- **Decision**: Word-bound feat/ft and space-flanked interpunct only
- **Bug**: 'Daft Punk' became 'Da'+'Punk' and '迈克尔·杰克逊' split into two artists.
- **Files**: 0 files
- **Tests**: test:music-quality-metadata

## 2026-07-26T22:15:58.151+08:00 — perf(renderer): cut redundant list, lyric, and search work

- **Context-Id**: 137d3ace-7f2b-4818-bba5-155dd88f0e54
- **Decision**: Repair the MusicList memo comparator and stabilize call-site props
- **Decision**: Gate hidden lyric subscriptions and cache search normalization
- **Bug**: Closed detail page reconciled the lyric subtree ~5-10x/sec; keystrokes re-normalized the whole local library.
- **Files**: 0 files
- **Tests**: test:runtime-performance; test:search-matching

## 2026-07-26T22:16:18.433+08:00 — fix(app-config): bound legacy watch-dir migration grants

- **Context-Id**: 22a7a4f9-9e0b-426c-87a4-33f62514cda5
- **Decision**: Bound the migration grant scope instead of requiring prior authorization
- **Decision**: Move filesystem probing off the main thread
- **Bug**: A compromised renderer could obtain a persistent recursive grant over an entire drive.
- **Files**: 0 files
- **Tests**: test:app-config

## 2026-07-26T23:15:21.819+08:00 — fix(app-config): persist plugin user variables and harden pluginMeta

- **Context-Id**: ba4cce9f-c99c-4e97-aad9-6ffd0ccdaa0f
- **Decision**: Keep object-typed values in every config patch
- **Decision**: Fix the mutate-then-write shape at every call site, not only in the patch rule
- **Decision**: Reject prototype-reserved keys for plugin platform and user-variable keys on both sides
- **Decision**: Measure Map/Set/Error contents in the IPC payload estimator and validate pluginMeta nesting
- **Decision**: Ship the persistence fix and the review findings as one commit
- **Bug**: Plugin user variables were never stored: the app could not see the values and every restart lost the input, while variables saved by older versions still loaded normally.
- **Bug**: Off-screen lyric and minimode windows were moved back on screen but the corrected position was never persisted.
- **Bug**: A plugin declaring platform or a user-variable key named "__proto__" could write onto Object.prototype in the main renderer through the immer pluginMeta writers, silently disabling every plugin.
- **Bug**: A compromised renderer could push multi-megabyte Map/Set payloads past the 512KB app-config cap into main-process memory.
- **Files**: 14 files
- **Tests**: npm exec tsc -- --noEmit; npm exec eslint -- ./src; npm test

## 2026-08-20T22:07:07+08:00 — feat(music-detail): add AMLL controls and center fullscreen layout

- **Context-Id**: 2b05f3ba-012d-491f-95c7-01520a44eb15
- **Decision**: Add direct playback controls to classic AMLL detail
- **Decision**: Center the shared classic playback page in fullscreen
- **Decision**: Model AMLL lyric visibility and responsive controls explicitly
- **Decision**: Use localized labels and semantic controls
- **Files**: 11 files
- **Tests**: Not run (Git-only commit workflow)

## 2026-07-27T00:45:34.408+08:00 — fix(playback): stop skip loop when the output device disappears

- **Context-Id**: 82b55143-5f3a-4805-8ddd-8487991a0265
- **Decision**: Classify a dead output endpoint as its own error kind in the libmpv host
- **Decision**: Poll audio-device-list in the host instead of listening to Chromium devicechange
- **Decision**: Fall back to the default output and reload the track rather than only pausing
- **Decision**: Deduplicate the device-loss policy but never the recovery
- **Bug**: With a specific output device selected, unplugging it made the player skip through the whole queue instead of stopping, even with "pause when the audio device is removed" chosen.
- **Bug**: The "pause when the audio device is removed" preference had no effect at all.
- **Bug**: Switching the output device back to Default left playback on the previously selected device after the next track loaded.
- **Files**: 9 files
- **Tests**: npm exec tsc -- --noEmit; npm exec eslint -- ./src; npm test; npm run smoke:native; node scratchpad/mpv-device-list.cjs (libmpv audio-device-list probe)
## 2026-08-14T19:54:43.105+08:00 — feat(discovery): rebuild recommend and toplist pages around an editorial layout

- **Context-Id**: ab3f1df4-342e-4c9b-9eda-40a6df4f0bf1
- **Decision**: Replace the pill source tabs with an underline rail driven by a measured sliding indicator
- **Decision**: Pass the Tab.List node through state rather than a shared ref object
- **Decision**: Make the flat editorial chip the base style for the tag row and let glass only remap borders
- **Decision**: Inset the toplist row dividers and drop the list top border
- **Decision**: Reserve the selected tab bold metrics with a hidden ghost copy
- **Decision**: Surface the active tag inside the expanded tag panel
- **Bug**: Selected-state styling on the source tabs would silently drop while the pointer was over the active tab.
- **Bug**: history.state.usr threw when the discovery pages were opened on a fresh navigation entry.
- **Files**: 15 files
- **Tests**: npm exec tsc -- --noEmit; npm exec eslint -- ./src; npm test; npx sass (changed scss); manual UI verification not performed

## 2026-08-14T22:30:57.161+08:00 — feat(recommend): randomize initial sheet tag

- **Context-Id**: 01a000ae-e589-748d-9658-38d960d51567
- **Decision**: Randomize the initial recommend-sheet tag per plugin
- **Decision**: Keep the expanded-panel seed tag aligned with the selected tag
- **Files**: 1 file
- **Tests**: not run (commit-only request)

## 2026-08-14T22:52:32.550+08:00 — fix(recommend): keep random tag stable on return

- **Context-Id**: 01a000c2-a9a6-7847-8f1b-9709b48862a2
- **Decision**: Cache recommendation tags per plugin for the renderer session
- **Bug**: Returning from a recommended sheet picked a new random tag and refreshed the list.
- **Files**: 1 file
- **Tests**: npm exec eslint -- Body/index.tsx; npm exec tsc -- --noEmit --pretty false; npm test

## 2026-08-15T18:35:49.9507317+08:00 — fix(local-music): correct nested list scrolling

- **Context-Id**: 01a004fd-ff3e-7ad5-b0f5-e38610471837
- **Decision**: Make the rendered music list own scrolling in nested local-music views
- **Bug**: Nested local-music lists could use a different scroll surface from their virtualized rows and collide with the glass music bar.
- **Files**: 9 files
- **Tests**: Not run (Git-only commit workflow)

## 2026-08-16T16:26:15.380+08:00 — feat(video): add production MV playback and downloads

- **Context-Id**: bc7af7af-8b89-475f-b578-ba195350e9c4
- **Decision**: Model video playback separately from audio quality
- **Decision**: Proxy remote video sources through a validated local session
- **Decision**: Only present verified qualities and start at the highest real option
- **Decision**: Use independent sessions for quality-selectable downloads
- **Bug**: Duplicate requested qualities could resolve to one source, and default playback started at 1080P instead of the highest verified quality.
- **Files**: 43 files
- **Tests**: npm exec tsc -- --noEmit; npm exec eslint -- ./src; npm test; npm exec sass (MV player SCSS)

## 2026-08-20T19:12:00+08:00 — fix(favorites): preserve album and toplist details

- **Context-Id**: 01a01edb-c654-7538-9f27-cdae636f14f6
- **Decision**: Record favorite media type and route starred entries by type
- **Bug**: Favorited albums reopened as playlists and showed 0 tracks.
- **Files**: 7 files
- **Tests**: npm exec tsc -- --noEmit; npm exec eslint -- ./src; npm test

## 2026-08-21T12:19:01.9513966+08:00 — fix(video): cover transparent overlay edge pixels

- **Context-Id**: 01a02289-fd83-7da3-91b4-5fd0116b682e
- **Decision**: Extend only the native video surface beyond the clip-path edge
- **Bug**: A light one-pixel strip of the main-window surface could appear beside the native MV player at fractional aspect-ratio edges.
- **Files**: 2 files
- **Tests**: npm exec tsc -- --noEmit --pretty false; npm exec eslint -- ./src; npm test
