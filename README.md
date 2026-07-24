# BakaMusic

[![Stars](https://badgen.net/github/stars/ShenYichenCN/BakaMusic_syc)](https://github.com/ShenYichenCN/BakaMusic_syc/stargazers)
[![License](https://badgen.net/badge/license/AGPL-3.0-only/blue)](LICENSE)

**无广告、无内置在线音源、由插件扩展。**

BakaMusic_syc 是基于 BakaMusic 修改，由Electron、React 和 TypeScript 的跨平台桌面音乐播放器，提供播放、歌词、歌单、本地音乐、下载与主题框架；在线搜索与媒体来源由用户安装的插件提供。
原项目地址：[https://github.com/zencok/
](https://github.com/Zencok/BakaMusic)
## 目录

- [功能](#功能)
- [截图](#截图)
- [下载](#下载)
- [插件](#插件)
- [V2 主题包](#v2-主题包)
- [播放引擎](#播放引擎)
- [歌词体系](#歌词体系)
- [本地开发](#本地开发)
- [架构](#架构)
- [第三方与许可](#第三方与许可)

## 功能

| 功能 | 说明 |
|---|---|
| 插件化音源 | 扩展搜索、播放、歌词、专辑、榜单和歌单导入 |
| 多格式歌词 | TTML、LRC、LRC A2、YRC、QRC、ESLRC、LYL、LYS、LQE，支持逐字、翻译、音译及独立桌面歌词窗口 |
| 多窗口 | 主窗口、桌面歌词和紧凑迷你模式同步工作 |
| 播放与音质 | libmpv＋LibreMPEG 统一播放、输出设备、HLS 及插件声明的多档音质 |
| 本地音乐 | MP3/FLAC/ALAC/APE/DSF/DFF/TAK/TTA/WavPack 等格式的扫描、监听和分类浏览 |
| 下载管理 | 并发任务、暂停/续传、完整性校验、元数据与歌词写入 |
| 歌单与统计 | 本地/收藏歌单、备份恢复、最近播放和收听统计 |
| V2 主题 | 语义 Token、受控本地资源和沙箱动态背景 |
| 多语言 | 简体中文、繁体中文、English |

## 截图

| 主页 | 播放详情 |
|---|---|
| ![主页](./.imgs/home.png) | ![播放详情](./.imgs/player.png) |

| 推荐歌单 | 主题市场 |
|---|---|
| ![推荐歌单](./.imgs/playlist.png) | ![主题市场](./.imgs/theme-market.png) |

| 设置 | 多窗口联动 |
|---|---|
| ![设置](./.imgs/settings.png) | ![多窗口联动](./.imgs/showcase.png) |

## 下载

从 [GitHub Releases](https://github.com/Zencok/BakaMusic/releases) 获取发布包：

| 平台 | 产物 |
|---|---|
| Windows x64 | 离线 NSIS / NSIS Web / Portable ZIP |
| macOS x64、arm64 | DMG |
| Linux amd64、arm64 | DEB / AppImage |

NSIS Web 仅包含联网安装引导程序，安装时从同一 GitHub Release 下载对应的
`.nsis.7z` 完整载荷；离线 NSIS、Portable ZIP、DMG、DEB 和 AppImage 均直接携带
完整应用。每个完整应用载荷都包含播放核心所需的 mpv 运行时；NSIS Web 只延迟
下载整个应用载荷，mpv 不再拆分为独立下载项。

NSIS Web 默认复用应用更新源的首个 GitHub 加速前缀。构建时可通过
`NSIS_WEB_GITHUB_ACCELERATOR` 指定其他前缀；将其设为空字符串则生成 GitHub
直连地址。离线 NSIS 的内容和下载方式不受该变量影响。

## 插件

插件接口延续 MusicFree 生态的数据模型，可提供搜索、媒体地址、歌词、专辑/歌单、艺人、榜单、推荐和导入能力。插件在独立受控进程中运行，网络与存储能力经过宿主边界。

- 当前契约：[`src/types/plugin.d.ts`](src/types/plugin.d.ts)
- 参考文档：[MusicFree 插件开发文档](https://musicfree.catcat.work/plugin/introduction.html)

## V2 主题包

BakaMusic 接受 `bakamusic-theme@2` 主题。主题至少包含 `config.json` 和 `index.css`，可选资源位于 `imgs/`，动态背景位于 `iframes/`：

```text
my-theme/
├── config.json
├── index.css
├── imgs/
└── iframes/app.html
```

最小配置和 Token：

```json
{
  "spec": "bakamusic-theme@2",
  "name": "示例主题",
  "author": "someone",
  "version": "2.1.0",
  "preview": "@/imgs/preview.jpg",
  "description": "一句话描述",
  "tags": ["暗色"],
  "scheme": "dark"
}
```

```css
:root {
  --theme-primary: #5ee2d4;
  --theme-bg: #151718;
  --theme-text: #f5f7f8;
  --theme-scheme: dark;
}
```

`index.css` 只能包含一个 `:root` Token 块；布局、层级和行为由客户端管理。完整允许字段和 Token 以 [`src/shared/themepack/contract.ts`](src/shared/themepack/contract.ts) 为准。

## 播放引擎

所有本地与远程媒体均由 `libmpv + LibreMPEG` 解封装、解码和输出，不创建 Chromium `Audio`/WebAudio 播放链。QMC 与 CENC 媒体先经各自的流式解密层，再将明文媒体交给 libmpv；HLS、普通 HTTP 媒体以及自定义请求头由 libmpv 直接处理。

## 歌词体系

远程歌词由插件的 `getLyric` 接口或歌词 URL 获取；本地歌词来自音频文件的内嵌标签，或音频同目录下同名的侧车歌词文件。两类来源最终进入同一个 `LyricParser`：

- 可识别的主流格式优先使用 [`@applemusic-like-lyrics/lyric`](https://www.npmjs.com/package/@applemusic-like-lyrics/lyric) 解析；
- TTML 直接使用 [`@applemusic-like-lyrics/ttml`](https://www.npmjs.com/package/@applemusic-like-lyrics/ttml)，保留元数据、逐字音译、Ruby 注音、背景人声和对唱信息；
- 旧插件的混合时间戳、网易 JSON 行及纯文本继续由兼容解析逻辑处理。

本地侧车歌词采用“音频文件名 + 歌词扩展名”的方式关联，例如：

```text
晴天.flac
晴天.ttml
```

支持 `.ttml`、`.xml`、`.lqe`、`.lys`、`.yrc`、`.qrc`、`.alrc`、`.eslrc`、`.lyl`、`.lrc` 和 `.txt`。同一首歌曲存在多个侧车文件时，优先使用信息表达能力更完整的格式；侧车歌词优先于音频内嵌歌词。AMLL 各格式能力与 API 参见 [AMLL 歌词格式文档](https://amll.dev/guides/lyric/quickstart)。

## 本地开发

要求：Node.js `24.15.0`（见 `.node-version`）及 npm。

```bash
npm install
npm start
```

### 媒体运行时

mpv、LibreMPEG 和 AC-4 运行时不需要本地编译；开发和打包命令会从 [`MpvLibre Runtime`](https://github.com/Zencok/mpv-libre-runtime/releases) 下载当前平台的已验证归档，校验 SHA-256 后放入 `res/.runtime/`。安装器使用归档中的 FFmpeg 工具验证 LibreMPEG/AC-4 能力，随后剔除应用不调用的 `ffmpeg`、`ffprobe` 命令行程序，最终安装包仅保留 libmpv 运行所需文件和许可证。

当前固定 release、源码提交和各平台摘要以 [`scripts/media-runtime-manifest.json`](scripts/media-runtime-manifest.json) 为准。支持 Windows x64、macOS x64/arm64、Linux x64/arm64；归档按平台和架构选择，不能跨系统或 CPU 混用。运行时版本通过 GitHub Actions 定期检查并以 PR 更新，应用构建只消费清单中固定的不可变 URL 和摘要。

只有重建 `native/` 模块时才需要对应平台的 C/C++ 工具链；这与 mpv/LibreMPEG 运行时无关。Windows 安装器由 Forge 调用 electron-builder 的 NSIS target 生成，NSIS 工具链会按依赖自动准备。

### 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 带 Electron Inspector 启动 |
| `npm run runtime:install:dev` | 下载并校验当前平台的开发运行时 |
| `npm run lint` | ESLint 自动修复 `src/` |
| `npm exec tsc -- --noEmit --pretty false` | TypeScript 校验 |
| `npm test` | 运行聚合回归测试 |
| `npm run package` | 构建 unpacked 应用 |
| `npm run smoke:package` | 校验 ASAR/fuses、三窗口、插件/主题和后台服务 |
| `npm run smoke:native` | 在 Electron ABI 下加载 `qmc2`、`ence` |
| `npm run build:native` | 重建 `native/*` 并复制运行时模块 |
| `npm run make` | 生成当前平台的 Forge 产物（Windows 为离线/Web NSIS，macOS 为 DMG，Linux 为 DEB/AppImage） |
| `npm run sbom -- --output-file SBOM.cdx.json` | 生成可复现 CycloneDX 1.6 SBOM |
| `npm run clean` | 删除 `.webpack/`、`out/`、`tmp/` |

### 提交前验证

```bash
npm exec tsc -- --noEmit --pretty false
npm exec eslint -- ./src
npm test
```

窗口、IPC、服务、native 或打包相关变更再执行：

```bash
npm run package
npm run smoke:package
```

Windows 本地安装器示例：

```powershell
npm run make -- --platform=win32 --arch=x64
```

## 架构

```text
src/main/               Electron 主进程
src/preload/            contextBridge 边界
src/renderer/           主窗口 React 应用
src/renderer-lrc/       桌面歌词窗口
src/renderer-minimode/  迷你模式窗口
src/shared/             跨进程配置、插件、IPC、主题、服务
src/renderer/core/      播放、下载、歌单、本地音乐、统计、备份
src/webworkers/         utilityProcess 下载与文件监听实现
src/amll-core/          完整 AMLL 上游同步区
res/                    语言、图标、后台服务和 native 运行时
```

Renderer 关闭 Node integration，通过不同权限的 preload 调用主进程。插件、下载/监听任务和本地代理服务运行在独立 `utilityProcess`；生产包启用 ASAR 完整性与 Electron fuses。

## 第三方与许可

- `src/amll-core/` 基于 [applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics) Core，并作为完整上游同步边界保留。
- 歌词格式解析使用 [`@applemusic-like-lyrics/lyric`](https://www.npmjs.com/package/@applemusic-like-lyrics/lyric) 与 [`@applemusic-like-lyrics/ttml`](https://www.npmjs.com/package/@applemusic-like-lyrics/ttml)，两者均来自 AMLL 上游并采用 `AGPL-3.0-only`。
- BakaMusic 不附带在线音源或媒体内容。插件、数据来源和内容使用由其提供者与使用者负责，请遵守所在地区法律、服务条款与版权规则。
- 软件按现状提供，详见 [AGPL-3.0-only](LICENSE)。
