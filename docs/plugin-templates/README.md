# 插件模板

先阅读 [插件开发指南](../plugin-development.md)。应用安装的是一个独立的 CommonJS `.js` 文件；本目录的检查器在 Node 下运行，不需要上传服务，也不代替客户端验证。

| 文件 | 用途 |
| --- | --- |
| [minimal-plugin.js](minimal-plugin.js) | 可改造的真实 HTTP 适配器，仅实现歌曲搜索和音源解析 |
| [full-plugin.js](full-plugin.js) | 可直接安装的离线契约演示，覆盖桌面全部 18 个方法及 Flutter 的热搜、每日推荐 |
| [lx-source.js](lx-source.js) | 独立 LX 事件脚本，演示两个来源的音源替换 |
| [manifest.example.json](manifest.example.json) | 桌面订阅清单结构示例；发布前替换 URL |
| [check.cjs](check.cjs) | 覆盖每个导出方法、分页、空结果、导入快照及异常映射的离线断言 |

从仓库根目录运行：

```sh
node docs/plugin-templates/check.cjs
node --check docs/plugin-templates/minimal-plugin.js
node --check docs/plugin-templates/full-plugin.js
node --check docs/plugin-templates/lx-source.js
```

## 从最小模板连接服务

将 `API` 替换成你控制的 HTTPS 接口，将 `PLATFORM` 改成稳定、唯一的平台名。按实际服务调整 `music()`、请求参数与响应映射。当前示例约定：

- `GET /songs?q=...&page=1` 返回 `{ "items": [{ "id": "7", "title": "Track", "artist": "Artist", "durationSeconds": 180 }], "hasMore": true }`。
- `GET /songs/7/source?quality=320k` 返回 `{ "url": "https://your-cdn.example/song.mp3", "headers": {} }`；确实没有权限或资源时返回 `{ "unavailable": true }`。
- 插件设置中的 `token` 可选，按次读取并发送为 `Authorization: Bearer ...`。音源请求头由解析结果单独提供，不自动转发账户 token 到 CDN。

网络失败直接抛错；不要把服务故障变成搜索结束。只有实际支持的功能才添加导出方法和能力声明。最小模板未声明 `srcUrl`；部署稳定更新地址后再添加。所有 `.invalid` 域名都必须替换才能联网。

## 全功能离线演示

安装 `full-plugin.js` 后可搜索 `i` 查看三首歌曲，搜索 `Example` 查看专辑、歌手和歌单。每页两项，第 2 页结束，第 3 页为空且结束。所有内容均为演示数据，不接入第三方音乐目录。

演示覆盖歌曲/专辑/歌手/歌单/歌词搜索、音源、MV、歌曲/歌手详情、歌词原文/翻译/音译、专辑/歌单/艺人作品分页、链接导入、榜单、推荐标签/歌单、评论、详情链接和识曲。歌曲 `duration` 使用秒；歌词搜索第四参数的 `durationMs` 使用毫秒。歌词上下文仅在 `type === "lyric"` 时参与筛选。

默认音频、视频、图片和详情页面 URL 都使用保留域名 `.invalid`，**无法实际播放或浏览**。`mediaBaseUrl` 是唯一演示配置：在插件变量中填写你控制的 HTTPS 目录，例如 `https://your-host.example/fixtures`，并提供以下真实文件：

- 音频：`song-1-128k.mp3`、`song-1-320k.mp3`、`song-1-flac.flac`；`song-2`、`song-3` 同样命名。不同音质应对应真实编码，不要仅重命名扩展名。
- 视频：`video-1-720p.mp4`、`video-1-1080p.mp4`；其他歌曲同样命名。测试文件需符合返回的分辨率、SDR 和 MP4 声明，接入业务服务时返回实际媒体信息。

替换顶部 `ORIGIN` 和图片地址后，可使用真实目录详情和封面。示例导入链接为 `https://catalog.example.invalid/song/song-1` 和 `https://catalog.example.invalid/sheet/sheet-1`。歌单全量快照包含全部三首歌曲；只有桌面条件导入传入匹配的 `knownVersion` 时返回 `{ notModified: true, syncVersion }`。生产中应根据真实完整快照生成版本，改变任何歌曲或顺序后同步改变版本。Flutter 当前不消费条件快照协议。

识曲演示仅匹配 `AAAAAA==`（四个零 PCM 字节）、8000 Hz、单声道，便于检查返回结构；它不做音频指纹或真实识别。连接真实识曲服务前不要向用户宣称识曲能力。

`getHotSearch()` 返回规范字符串数组；`getDailyRecommendations()` 按 UTC 日期返回 `ready`、明日零点的 Unix 毫秒 `refreshAt` 及带完整 `musicList` 的 `sheetItem`。这是无账户的固定演示，真实推荐服务应按指南返回账户/授权/刷新状态。日历时间随调用当天变化，目录数据与分页固定。

## 两端验证边界

桌面 RPC 只暴露 18 个标准方法，不会调用 `getHotSearch` 和 `getDailyRecommendations`。Flutter 会发现并调用这两个扩展。两个模板只依赖两端共同的 `env.getUserVariables()`、CommonJS 导出和基础 JavaScript；最小模板另外使用共同支持的 `axios.get()`。

本地检查器用隔离的 VM 加载模板、注入一个可断言的 axios 假服务，并读取桌面 `rpc.ts` 校验方法覆盖；它不会访问网络、解码音频、运行 Electron utilityProcess 或 Rust QuickJS。通过后，仍需在桌面和 Flutter 分别安装验证搜索、详情、翻页、导入、变量保存，以及真实音频/MV 的播放、请求头和过期重取。

“20 个方法”表示全功能目录模板中的 18 个桌面方法与两个常用 Flutter 扩展，不表示全部专用协议。Flutter 还存在用于特定加密音频解码的 `getAppleMusicKey` 回调，需按主指南中的专用契约实现，不应作为通用目录能力随意声明。

## LX 音源脚本

`lx-source.js` 使用两端实际提供的 `lx.on(lx.EVENT_NAMES.request, handler)` 和 `lx.send(lx.EVENT_NAMES.inited, { sources })`。先注册处理器，再发送初始化事件；来源声明使用 `type: "music"`、`actions: ["musicUrl"]` 与兼容拼写 `qualitys`。它不导出 CommonJS 目录对象，也不提供搜索、歌单或歌词；目录来自原生插件，LX 只替换已选来源的音频 URL。需要在客户端的 LX 入口安装并启用。

该示例声明 `kw` 的 `128k/320k` 与 `wy` 的 `128k/flac`，根据事件中的 `source`、`info.type` 和经过宿主适配的 `info.musicInfo.songmid` 生成 URL。真实集成通常需把歌曲 ID、音质发送到你控制的解析服务，保留平台原始 ID，不要把显示标题当作标识。其他可用来源代码是 `kg/tx/mg`；仅声明真正实现的来源和音质。

将 `MEDIA_BASE` 替换成真实 HTTPS 目录，按 `<source>/<songmid>-<quality>.mp3` 或 `.flac` 提供测试文件；默认 `https://lx-media.example.invalid` **不能播放**。桌面会进一步探测解析出的媒体地址，离线检查仅校验事件顺序、两个来源、每个音质、ID 编码和不支持请求的错误。脚本不依赖原生插件的 `env` 或 `require`：桌面 LX 沙箱没有这两个接口。需要网络请求时使用两端的 `lx.request(url, options, (error, response, body) => ...)`，返回的函数可取消请求；不要照搬原生插件的 axios 模板。
