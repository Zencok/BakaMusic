# BakaMusic 插件开发指南

BakaMusic 插件是单文件 JavaScript 模块，用于提供在线搜索、媒体源、歌词、歌单、榜单、艺人、评论、MV、分享链接和听歌识曲等能力。插件在独立的受控进程中运行，不直接访问 Electron、Renderer DOM 或任意 Node.js API。

本指南以当前仓库为准。完整字段和返回类型以 [`src/types/plugin.d.ts`](../src/types/plugin.d.ts) 与 [`src/types/media.d.ts`](../src/types/media.d.ts) 为唯一契约；新增能力不会以其他播放器的插件文档为基准。

## 最小插件

插件必须导出一个对象，`platform` 是唯一必填元数据。推荐使用 CommonJS：

```js
const axios = require("axios");

module.exports = {
    platform: "Example Music",
    version: "1.0.0",
    author: "someone",
    primaryKey: ["id"],
    defaultSearchType: "music",
    supportedSearchType: ["music"],
    supportedQualities: ["128k", "320k", "flac"],

    async search(query, page, type) {
        if (type !== "music") {
            return { isEnd: true, data: [] };
        }

        const response = await axios.get("https://api.example.com/search", {
            params: { q: query, page },
        });

        return {
            isEnd: !response.data.hasMore,
            data: response.data.items.map((item) => ({
                id: String(item.id),
                platform: "Example Music",
                title: item.title,
                artist: item.artist,
                album: item.album,
                artwork: item.cover,
                duration: item.duration,
                qualities: {
                    "128k": { size: item.size128 },
                    "320k": { size: item.size320 },
                    flac: { size: item.sizeFlac },
                },
            })),
        };
    },

    async getMediaSource(musicItem, quality) {
        const response = await axios.get("https://api.example.com/source", {
            params: { id: musicItem.id, quality },
        });
        return {
            url: response.data.url,
            quality,
            headers: {
                referer: "https://example.com/",
            },
        };
    },
};
```

也可以使用 `module.exports.default = plugin`。直接返回对象的旧式脚本仍可加载，但不建议用于新插件。

## 元数据

| 字段 | 说明 |
|---|---|
| `platform` | 插件和媒体来源名称，必填、非空且不超过 128 个字符；同一平台的新版本会替换旧版本 |
| `version` | 插件版本，建议使用语义化版本 |
| `author` | 作者或维护者 |
| `srcUrl` | 更新地址，必须是 HTTPS `.js` 插件或 `.json` 清单地址 |
| `primaryKey` | 识别歌曲身份的字段列表，通常为 `id`，也可包含平台需要的 `mid`、`hash` 等 |
| `defaultSearchType` | 默认搜索类型：`music`、`album`、`artist`、`sheet` 或 `lyric` |
| `supportedSearchType` | `search` 实际支持的搜索类型 |
| `supportedQualities` | 插件声明的音频音质档位 |
| `supportedVideoQualities` | 插件可请求的 MV 档位，例如 `720p`、`1080p`、`4k` |
| `userVariables` | 需要用户在插件管理页填写的配置项 |
| `hints` | 按方法名提供输入提示，例如 `importMusicItem`、`importMusicSheet` |

音频音质键为：

```text
mgg, 128k, 192k, 320k, flac, flac24bit, hires, vinyl,
dolby, atmos, atmos_plus, master
```

## 媒体对象

所有媒体对象都应提供稳定的 `id` 和 `platform`。宿主会在部分列表返回后补全 `platform`，但插件不应依赖这一行为。

歌曲至少包含：

```js
{
    id: "track-id",
    platform: "Example Music",
    title: "Song title",
    artist: "Artist",
    album: "Album",
    artwork: "https://example.com/cover.jpg",
    duration: 245.5,
    mv: "mv-id",
    qualities: {
        "320k": { size: 9234567 },
        flac: { size: 31234567 },
    },
}
```

`duration` 使用秒。`qualities` 的键应与插件声明的音质一致，值可提供 `url` 和 `size`；也可以只保留平台解析所需的 `hash` 等自定义字段，最终在 `getMediaSource` 中换取真实地址。

歌单、专辑和艺人对象的关键字段：

```js
const sheet = {
    id: "sheet-id",
    platform: "Example Music",
    title: "Playlist",
    artist: "Creator",
    artwork: "https://example.com/sheet.jpg",
    description: "Description",
    worksNum: 100,
};

const artist = {
    id: "artist-id",
    platform: "Example Music",
    name: "Artist",
    avatar: "https://example.com/avatar.jpg",
    description: "Biography",
};
```

## 能力接口

插件只需实现自身支持的方法。BakaMusic 根据实际导出的函数生成能力列表。

| 方法 | 参数 | 返回值 |
|---|---|---|
| `search` | `query, page, type` | `{ data, isEnd }`，`data` 类型与搜索类型一致 |
| `getMediaSource` | `musicItem, quality` | 音频播放源或 `null` |
| `getMvSource` | `musicItem, videoQuality?` | MV/视频播放源或 `null` |
| `getMusicInfo` | `mediaBase` | 完整歌曲信息或 `null` |
| `getMusicDetailPageUrl` | `musicItem` | 歌曲详情/分享 URL 或 `null` |
| `getLyric` | `musicItem` | 歌词源或 `null` |
| `getAlbumInfo` | `albumItem, page` | `{ albumItem?, musicList?, isEnd? }` |
| `getMusicSheetInfo` | `sheetItem, page` | `{ sheetItem?, musicList?, isEnd? }` |
| `getArtistWorks` | `artistItem, page, type` | 歌曲或专辑分页结果 |
| `getArtistInfo` | `artistItem` | 艺人头像、简介等补充信息 |
| `importMusicSheet` | `urlLike` | 完整歌单对象；旧式歌曲数组仅用于兼容 |
| `importMusicItem` | `urlLike` | 单曲对象或 `null` |
| `getTopLists` | 无 | 榜单分组数组 |
| `getTopListDetail` | `topListItem, page` | 榜单信息与歌曲分页结果 |
| `getRecommendSheetTags` | 无 | 推荐标签和固定入口 |
| `getRecommendSheetsByTag` | `tagItem, page?` | 推荐歌单分页结果 |
| `getMusicComments` | `musicItem, page?` | `{ data, isEnd }` |
| `recognize` | `audioBase64, sampleRate?, channels?` | 听歌识曲结果 |

分页从 `1` 开始。仅当明确还有下一页时返回 `isEnd: false`；省略或返回其他值会被视为分页结束。

## 音频播放源

```js
async function getMediaSource(musicItem, quality) {
    return {
        url: "https://cdn.example.com/audio.m4a",
        quality,
        headers: {
            "user-agent": "ExampleClient/1.0",
            referer: "https://example.com/",
        },
    };
}
```

返回值支持：

- `url`：最终媒体地址。
- `headers`、`userAgent`：交给 libmpv 的远程请求信息。
- `quality`：实际返回的 BakaMusic 音质键。
- `ekey`：QMC2 媒体密钥，宿主会建立本地流式解密会话。
- `cek`：CENC/AES-CTR 的 32 位十六进制内容密钥，宿主会处理 Range、seek 和流式解密。

不要在插件中预下载整首歌曲，也不要自行建立本地代理。地址无效或当前档位不可用时返回 `null`。

## MV 与视频

MV 使用独立的视频契约，不要把 `1080p` 等视频档位写入音频音质字段：

```js
async function getMvSource(musicItem, videoQuality = "1080p") {
    const source = await resolveVideo(musicItem.mv, videoQuality);
    return {
        url: source.url,
        videoQuality: source.quality,
        width: source.width,
        height: source.height,
        bitrate: source.bitrate,
        size: source.size,
        codec: source.codec,
        mimeType: source.mimeType,
        dynamicRange: source.dolbyVision ? "dolby-vision" : "sdr",
        headers: source.headers,
        backupUrls: source.backupUrls,
        expiresAt: source.expiresAt,
        availableVideoQualities: source.options.map((option) => ({
            key: option.key,
            label: option.label,
            width: option.width,
            height: option.height,
            size: option.size,
            codec: option.codec,
            dynamicRange: option.dynamicRange,
        })),
    };
}
```

`dynamicRange` 可为 `sdr`、`hdr10` 或 `dolby-vision`。`availableVideoQualities` 应只包含平台实际返回的档位；其中的 `key` 会原样传回下一次 `getMvSource` 调用。远程地址必须为 HTTP(S)，主地址失效时宿主会依序尝试 `backupUrls`。

## 歌词

```js
async function getLyric(musicItem) {
    return {
        rawLrc: "[00:00.000]Example lyric",
        format: "lrc",
        translation: "[00:00.000]示例翻译",
        romanization: "[00:00.000]Example romanization",
    };
}
```

也可以通过 `lrc` 返回歌词 URL。支持的 `format` 为 `ttml`、`lrc`、`lrc-a2`、`yrc`、`qrc`、`eslrc`、`lyl`、`lys`、`lqe` 和 `plain`。TTML 可承载逐字、翻译、罗马音、Ruby 注音、背景人声和对唱等富信息。

## 分享、导入与识曲

歌曲分享入口使用 `getMusicDetailPageUrl`：

```js
getMusicDetailPageUrl(musicItem) {
    return `https://example.com/song/${encodeURIComponent(musicItem.id)}`;
}
```

新插件的 `importMusicSheet` 应返回完整歌单，以便用户先预览再导入：

```js
async function importMusicSheet(urlLike) {
    const result = await resolvePlaylist(urlLike);
    return {
        id: result.id,
        platform: "Example Music",
        title: result.title,
        artist: result.creator,
        artwork: result.cover,
        description: result.description,
        worksNum: result.tracks.length,
        isImported: true,
        musicList: result.tracks.map(mapMusicItem),
    };
}
```

`recognize` 接收最多约 10 秒的 `8 kHz / 16-bit / mono PCM` Base64 数据；参数仍会提供实际 `sampleRate` 和 `channels`。结果中的歌曲应保留平台后续获取详情与播放源所需的 ID、hash 和音质字段：

```js
async function recognize(audioBase64, sampleRate, channels) {
    const matches = await recognizeAudio(audioBase64, sampleRate, channels);
    return {
        isEnd: true,
        data: matches.map((item) => ({
            id: item.id,
            platform: "Example Music",
            title: item.title,
            artist: item.artist,
            artwork: item.cover,
            confidence: item.confidence,
        })),
    };
}
```

## 用户变量与运行环境

声明用户变量：

```js
module.exports = {
    platform: "Example Music",
    userVariables: [
        { key: "token", name: "Access Token", hint: "用于访问 Example Music API" },
    ],
    async search(query, page, type) {
        const { token } = env.getUserVariables();
        // ...
    },
};
```

宿主提供全局 `env`：

- `env.getUserVariables()` / `env.userVariables`：当前用户变量。
- `env.os`：`win32`、`darwin` 或 `linux`。
- `env.appVersion`：当前 BakaMusic 版本。
- `env.lang`：当前界面语言。

插件还可以使用 `URL`、受控 `console`，以及以下白名单模块：

```text
axios, cheerio, crypto-js, dayjs, big-integer, qs, he, pako,
buffer, webdav, @react-native-cookies/cookies, musicfree/storage
```

`musicfree/storage` 是为历史兼容保留的持久化模块名，提供异步 `getItem`、`setItem` 和 `removeItem`；每个插件的存储总量上限为 10 MiB。它不代表 BakaMusic 插件继续遵循 MusicFree 的接口规范。

不要依赖任意 Node.js 内置模块、文件系统、Electron、DOM 或未列出的 npm 包。`require()` 不在白名单时返回 `null`。

## 进程与数据边界

- 插件代码上限为 5 MiB，元数据上限为 1 MiB。
- Axios 默认超时为 15 秒，请求和响应体上限为 16 MiB，并自动使用应用配置的代理。
- 插件方法的参数和返回值会跨进程传输，必须可结构化克隆或安全 JSON 序列化。
- 不要返回 Axios response、函数、DOM 对象、Electron 实例、循环引用或可变 class instance；只返回普通对象、数组和标量。
- `getMediaSource` 与 `getMvSource` 的调用和插件 `console` 输出会进入插件管理页的播放接口日志。
- 插件宿主会限制调用负载、超时和资源占用；插件应自行处理平台错误并以 `null` 或空分页结果结束。

## 安装与发布

开发阶段可在“插件管理”中导入本地 `.js` 文件。远程安装只接受 HTTPS `.js` 或 `.json` 地址。

单插件发布时，将 `srcUrl` 指向稳定的 HTTPS `.js` 地址。订阅或批量发布可使用清单：

```json
{
    "plugins": [
        {
            "url": "./example-plugin.js",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
    ]
}
```

清单中的相对 URL 会基于清单地址解析。`sha256` 可使用 64 位十六进制摘要或 `sha256-<base64>`；还可同时提供 `signature` 和 `publicKey` 进行签名校验。插件更新时，BakaMusic 会校验版本，默认拒绝以旧版本覆盖新版本。

## 调试清单

1. 使用本地 `.js` 导入确认插件能加载，`platform`、版本和能力列表正确显示。
2. 分别测试搜索首页、下一页和空结果，确认 `isEnd` 语义正确。
3. 对每个声明音质测试 `getMediaSource`，并确认请求头、过期链接和不可用档位的处理。
4. 测试 MV 首次解析、画质切换、备用地址、HDR/Dolby Vision 标记和下载。
5. 检查歌词格式、翻译、罗马音及逐字时间轴。
6. 测试分享链接、歌单导入预览、艺人详情和听歌识曲等已声明能力。
7. 在插件管理的日志页检查调用耗时、错误和控制台输出。
8. 发布前计算最终 JavaScript 文件的 SHA-256，并通过 HTTPS 地址重新安装验证。

LX 音源脚本属于独立兼容层，只覆盖已安装底座插件的播放接口，不使用本文的 BakaMusic 插件对象契约。
