# BakaMusic

[![Stars](https://badgen.net/github/stars/Zencok/BakaMusic)](https://github.com/Zencok/BakaMusic/stargazers)
[![Latest Release](https://badgen.net/github/release/Zencok/BakaMusic)](https://github.com/Zencok/BakaMusic/releases/latest)
[![Downloads](https://badgen.net/github/assets-dl/Zencok/BakaMusic)](https://github.com/Zencok/BakaMusic/releases)
[![Issues](https://badgen.net/github/issues/Zencok/BakaMusic)](https://github.com/Zencok/BakaMusic/issues)
[![License](https://badgen.net/badge/license/AGPL-3.0-only/blue)](LICENSE)

**无广告、无内置在线音源、由插件扩展。**

BakaMusic 是基于 Electron、React 和 TypeScript 的跨平台桌面音乐播放器。它提供播放、歌词、歌单、本地音乐、下载与主题框架；在线搜索和媒体来源由用户安装的插件提供。

## 功能

| 功能 | 说明 |
|---|---|
| 插件化音源 | 扩展搜索、播放、歌词、专辑、榜单和歌单导入 |
| 多格式歌词 | 普通/逐字歌词、翻译、罗马音与独立桌面歌词窗口 |
| 多窗口 | 主窗口、桌面歌词和紧凑迷你模式同步工作 |
| 播放与音质 | 播放队列、输出设备、HLS 及插件声明的多档音质 |
| 本地音乐 | 目录扫描、文件监听、元信息解析和分类浏览 |
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
| Windows x64 | Setup / Portable ZIP |
| macOS x64、arm64 | DMG |
| Linux amd64 | DEB |

## 本地开发

要求：Node.js `24.15.0`（见 `.node-version`）及 npm。只有重建 `native/` 时才需要对应平台的 C/C++ 工具链；Windows 手动生成安装器还需要 [Inno Setup](https://jrsoftware.org/isinfo.php)。

```bash
npm install
npm start
```

| 命令 | 用途 |
|---|---|
| `npm run dev` | 带 Electron Inspector 启动 |
| `npm run lint` | ESLint 自动修复 `src/` |
| `npm exec tsc -- --noEmit --pretty false` | TypeScript 校验 |
| `npm test` | 运行聚合回归测试 |
| `npm run package` | 构建 unpacked 应用 |
| `npm run smoke:package` | 校验 ASAR/fuses、三窗口、插件/主题和后台服务 |
| `npm run smoke:native` | 在 Electron ABI 下加载 `qmc2`、`ence` |
| `npm run build:native` | 重建 `native/*` 并复制运行时模块 |
| `npm run make` | 生成 macOS/Linux Forge 产物（Windows 使用 Inno Setup） |
| `npm run sbom -- --output-file SBOM.cdx.json` | 生成可复现 CycloneDX 1.6 SBOM |
| `npm run clean` | 删除 `.webpack/`、`out/`、`tmp/` |

提交前建议执行：

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
npm run package
iscc /DMyAppVersion=VERSION /DMyAppId=BakaMusic release/build-windows.iss
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

## 插件

插件接口延续 MusicFree 生态的数据模型，可提供搜索、媒体地址、歌词、专辑/歌单、艺人、榜单、推荐和导入能力。当前契约以 [`src/types/plugin.d.ts`](src/types/plugin.d.ts) 为准；插件在独立受控进程中运行，网络与存储能力经过宿主边界。

参考：[MusicFree 插件开发文档](https://musicfree.catcat.work/plugin/introduction.html)。

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

## 第三方与许可

- `src/amll-core/` 基于 [applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics) Core，并作为完整上游同步边界保留。
- BakaMusic 不附带在线音源或媒体内容。插件、数据来源和内容使用由其提供者与使用者负责，请遵守所在地区法律、服务条款与版权规则。
- 软件按现状提供，详见 [AGPL-3.0-only](LICENSE)。
