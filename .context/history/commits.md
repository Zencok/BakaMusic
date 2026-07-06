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
