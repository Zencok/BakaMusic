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
