# BakaMusic 插件开发手册

本文面向插件作者：从一个可导入的 JavaScript 文件开始，完成搜索、播放、歌词、歌单、榜单、艺人、评论、MV、听歌识曲、热搜与每日推荐，再进行跨端验证和发布。

**范围：桌面端 BakaMusic 与 BakaMusicFlutter 的当前实现。** 本文描述现有能力，不代表两个客户端已经功能完全一致。桌面端以 [公开方法名单](../src/shared/plugin-manager/rpc.ts)、[插件类型](../src/types/plugin.d.ts)、[媒体类型](../src/types/media.d.ts) 和实际调用为准；Flutter 端以 Rust 宿主和 Flutter 调用点为准。文末给出逐模块源码索引。示例中的媒体链接必须替换为自己的可访问资源。

## 阅读路线

- **第一次写插件**：阅读 [快速开始](#quickstart)、[元数据](#metadata)、[媒体模型](#models)、[分页与错误](#pagination)，复制最小模板。
- **给现有音源补能力**：查 [能力总表](#capabilities)，按对应章节实现。没有实现的函数不要导出。
- **同时支持两端**：先看 [跨端兼容](#compatibility)，尤其是热搜、识曲、导入版本协议、存储模块和分页默认值。
- **维护完整插件**：使用 [完整模板与自测](#templates)、[验收用例](#testing)、[发布规则](#publishing) 和 [源码覆盖索引](#sources)。

### 按能力查找

| 开发任务 | 对应章节 |
|---|---|
| 建立插件与媒体数据 | [能力范围](#capabilities) · [快速开始](#quickstart) · [元数据](#metadata) · [模型/单位](#models) · [分页/错误](#pagination) |
| 搜索与发现 | [搜索/歌词搜索](#search) · [榜单/推荐](#discovery) · [热搜](#hot-search) · [每日推荐](#daily) |
| 音频与歌词 | [音频源/音质/详情](#audio) · [歌词/翻译/罗马音](#lyrics) · [专辑/歌单/艺人](#collections) |
| 更多媒体能力 | [评论](#comments) · [MV](#video) · [听歌识曲](#recognition) · [Apple HLS](#apple-hls) |
| 导入与扩展 | [分享/导入/同步](#import) · [LX](#lx) · [内部边界](#internal) |
| 运行与发布 | [模块/网络/存储](#runtime) · [安装/更新](#publishing) · [跨端兼容](#compatibility) |
| 实施与维护 | [模板](#templates) · [测试/排错](#testing) · [源码覆盖](#sources) |

<a id="capabilities"></a>
## 1. 能力总表与边界

“支持”表示有实际调用链；不等同于任意平台、任意媒体均能成功播放。方法名大小写必须完全一致。

| 模块 / 插件方法 | 桌面端 | Flutter 端 | 入口与返回概述 |
|---|---|---|---|
| `search` | 支持 | 支持 | 歌曲、专辑、歌手、歌单、歌词搜索；`{data,isEnd}` |
| `getMediaSource` | 支持 | 支持 | 播放与音频下载复用；返回音频源 |
| `getMusicInfo` | 支持 | 支持 | 按原始身份补歌曲元数据 |
| `getLyric` | 支持 | 支持 | 原文、翻译、罗马音、格式 |
| `getAlbumInfo` | 支持 | 支持 | 专辑信息和歌曲分页 |
| `getMusicSheetInfo` | 支持 | 支持 | 远程歌单信息和歌曲分页 |
| `getArtistWorks` | 支持 | 支持 | `music` / `album` 独立分页 |
| `getArtistInfo` | 支持 | 无专门详情调用 | 桌面端补充艺人信息；移动端从作品结果/初始条目取信息 |
| `getTopLists` | 支持 | 支持 | 榜单分组，非歌曲分页 |
| `getTopListDetail` | 支持 | 支持 | 单个榜单歌曲分页 |
| `getRecommendSheetTags` | 支持 | 支持 | 固定标签和分组标签 |
| `getRecommendSheetsByTag` | 支持 | 支持 | 指定标签下的歌单分页 |
| `getMusicComments` | 支持 | 支持 | 评论分页及内嵌回复 |
| `getMvSource` | 支持 | 支持 | MV 播放、画质发现和下载复用 |
| `getMusicDetailPageUrl` | 支持 | 支持 | 分享 / 外部详情页 |
| `importMusicSheet` | 支持 | 支持 | 插件取回完整歌单快照，宿主预览/保存/同步 |
| `importMusicItem` | 支持 | 无对应导入入口 | 桌面端解析单曲链接；Flutter 的按 ID 播放走另一条链路 |
| `recognize` | 支持 | 尚无识曲接入 | PCM 音频换取歌曲候选 |
| `getHotSearch` 及别名 | 未列入公开方法 | 支持 | 搜索页热搜词 |
| `getDailyRecommendations` | 未列入公开方法 | 支持 | 首页每日推荐状态与歌单入口 |
| `getAppleMusicKey` | 未列入公开方法 | 专用源回调 | Apple HLS 解密上下文，配合专用 getMediaSource 描述符 |

桌面端当前方法白名单是上表前 18 个方法。Flutter 的热搜和每日推荐可以与这些方法共存于同一个插件对象，但桌面端不会因此出现对应功能。

**这些功能没有单独的标准插件方法：**

- 音频下载复用 `getMediaSource`；MV 下载复用 `getMvSource`。不要自行发明 `downloadMusic`、`downloadMv`。
- 音质/画质选择来自插件声明、歌曲元数据和源返回值，没有要求插件实现 `getQualityChoices`。
- 翻译、罗马音、对唱和背景人声由歌词结果/歌词格式承载，没有独立的 `getTranslation` 等接口。
- 账号配置可使用用户变量；没有通用的 `login/logout`、扫码登录、云盘/云歌单 CRUD 或上传协议。平台自有鉴权逻辑不等于宿主提供了这些 UI。
- 音效、解码器、HPX、音频处理模型、本地扫描、桌面歌词、播放队列、下载目录和工作区权限属于宿主功能，不是第三方音源插件扩展点。
- `__importMusicSheet`、`__qualityChoices` 等双下划线名称是 Flutter 的内部桥接入口，**不应导出为插件方法**。详见 [内部边界](#internal)。

<a id="quickstart"></a>
## 2. 快速开始：导出、导入与第一条歌曲

插件交付物是**单个 JavaScript 文件**，不是 npm 包目录。可以在开发时拆分源码，但发布前要打包成一个文件，并将宿主提供的模块保留为外部依赖。

推荐格式：

```js
const axios = require("axios");

module.exports = {
    platform: "Example Music",
    version: "1.0.0",
    author: "Your name",
    primaryKey: ["id"],
    defaultSearchType: "music",
    supportedSearchType: ["music"],
    supportedQualities: ["320k"],

    async search(query, page, type) {
        if (type !== "music") return { data: [], isEnd: true };
        const { data } = await axios.get("https://api.example.invalid/search", {
            params: { q: query, page },
        });
        return {
            data: data.items.map((item) => ({
                id: String(item.id),
                platform: "Example Music",
                title: item.title,
                artist: item.artist,
                duration: item.durationSeconds,
            })),
            isEnd: !data.hasMore,
        };
    },

    async getMediaSource(musicItem, quality) {
        const { data } = await axios.get("https://api.example.invalid/source", {
            params: { id: musicItem.id, quality },
        });
        return data.url ? { url: data.url, quality } : null;
    },
};
```

这里的 `.invalid` 是故意不可用的占位域名。可直接复制的文件见 [最小模板](plugin-templates/minimal-plugin.js)；用于不联网验证契约的文件见 [完整演示模板](plugin-templates/full-plugin.js)。

1. 替换 API 地址并完成平台数据映射。
2. 在插件管理中导入本地 `.js`，确认来源名、版本和能力。
3. 搜索一首歌，检查后续页和终页。
4. 播放该歌曲，验证所需的 ID、hash 和请求头均保留。
5. 再逐项添加可用能力；不要为了显示按钮导出空函数。

两端都兼容 `module.exports.default = plugin` 的对象包装。**这不是原生 ES Module 支持**：不要直接发布带 `import ... from` 或 `export default` 语法的源码。旧式脚本的尾表达式兼容不作为新插件写法。

<a id="metadata"></a>
## 3. 插件元数据与用户变量

### 3.1 元数据字段

| 字段 | 类型 / 示例 | 含义与约束 |
|---|---|---|
| `platform` | 非空字符串 | 来源身份；跨端请保持稳定。桌面端限制不超过 128 字符并拒绝保留对象键 |
| `version` | `"1.2.0"` | 插件版本，建议语义化版本 |
| `author` | 字符串 | 作者/维护者 |
| `srcUrl` | HTTPS URL | 插件更新位置；可为脚本或订阅清单，按内容识别，不应依赖扩展名 |
| `appVersion` | 字符串 | 桌面类型保留的兼容声明；不要把它当成两端统一强制版本门禁 |
| `primaryKey` | `["id", "hash"]` | 桌面绑定歌词时额外保留的关联身份字段；不是所有媒体存储的通用字段白名单 |
| `defaultSearchType` | `"music"` | 默认搜索类型 |
| `supportedSearchType` | 字符串数组 | 实际支持的搜索类型；注意字段名是单数 `Type` |
| `supportedQualities` | 音质键数组 | 音频能力声明，不代表每首歌均有全部档位 |
| `supportedVideoQualities` | `["720p","1080p"]` | 视频档位声明，和音频音质分开 |
| `cacheControl` | `"cache"` / `"no-cache"` / `"no-store"` | 保留的兼容元数据；当前桌面未据此执行源缓存，不能依赖它控制 HTTP 或 URL 缓存 |
| `userVariables` | 配置项数组 | 用户在插件设置中填写的变量声明 |
| `hints` | 方法名到提示数组 | 输入帮助；例如 `importMusicSheet`、`importMusicItem`、`getMusicInfo` |

`supportedMethod`、`supportedMethods`、`hash`、`path`、`_path`、禁用状态、排序和用户填写的变量值由宿主管理。不要把这些内部字段当成必须写入插件的元数据。

建议**显式声明** `supportedSearchType`。Flutter 对未声明类型的旧插件有默认兼容行为；空数组与未声明不是同一个意思。跨端共同类型为：

```text
music, album, artist, sheet, lyric
```

Flutter 兼容部分旧插件的 `musicSheet` 搜索类型，会在需要时把歌单查询转换成该字符串。新插件使用 `sheet`。声明 `lyric` 不代表普通歌曲搜索自动可用。

### 3.2 配置声明与读取

```js
userVariables: [
    { key: "token", name: "访问令牌", hint: "填写平台提供的访问令牌" },
    { key: "account", name: "账号标识", hint: "用于区分每日推荐账号" },
],
hints: {
    importMusicSheet: ["粘贴完整歌单分享链接或歌单 ID"],
    importMusicItem: ["粘贴单曲分享链接"],
    getMusicInfo: ["填写歌曲 ID"],
},
```

在方法调用时读取变量：

```js
const variables = env.getUserVariables();
const token = variables.token || "";
```

不要在模块加载时固定缓存用户令牌。设置可能变更，账号切换后缓存必须隔离。共同配置项使用 `key/name/hint`。Flutter 额外读取 `type/defaultValue`，其中 `type:"password"` 可遮蔽文本；默认值由配置 UI 处理，未保存时不保证运行时自动填充。桌面未提供同样的表单类型契约，不能假设 `secret/type/default` 跨端有效。

`env.getUserVariables()` 与 `env.userVariables` 提供变量；`env.os`、`env.appVersion`、`env.lang` 提供宿主环境。**桌面端** `os` 通常是 `win32/darwin/linux`；Flutter 当前使用 Rust 系统名（如 `windows/macos`），且 `appVersion/lang` 当前注入固定值 `0.1.0/zh-CN`，不能据此判断实际安装版本或界面语言。代理配置由宿主处理，不要读取未承诺的 `process.env`。

<a id="models"></a>
## 4. 统一媒体模型与单位

### 4.1 歌曲

```js
{
    id: "track-001",
    platform: "Example Music",
    title: "示例歌曲",
    artist: "歌手甲 / 歌手乙",
    album: "示例专辑",
    artwork: "https://cdn.example.invalid/cover.jpg",
    duration: 245.5,
    mv: "mv-001",
    qualities: {
        "320k": { size: 9234567 },
        flac: { size: 31234567, hash: "provider-hash" },
    },
    hash: "provider-track-hash",
    albumId: "provider-album-id",
}
```

- 跨端推荐字符串 `id`。Flutter 兼容数字 ID；不要在翻页时改变其类型，也不要使用临时序号作为身份。
- `platform + id` 共同确定来源身份。其他平台的 ID 不可直接交给当前插件解析。
- `title/artist/album/artwork` 是规范显示字段。保留平台必需的 hash、mid、token 等普通 JSON 字段，但不要把整个 HTTP response 放进去。
- `duration` 单位是**秒**。未知时省略，不要用毫秒填入。
- `mv` 可为字符串或数字。部分视频型歌曲还使用 `videoId`、`is_video`；只有确实有视频时才返回相关标记。
- `qualities` 按歌曲列出真实档位。值可包含 `url`、`size` 和解析所需原始字段。`size` 优先用字节数，也兼容显示文本。
- `url` 可用于静态直接源，但动态鉴权、短期 URL 应在 `getMediaSource` 时解析。

### 4.2 歌单与专辑

```js
const sheet = {
    id: "sheet-001", platform: "Example Music",
    title: "示例歌单", artist: "创建者",
    artwork: "https://cdn.example.invalid/sheet.jpg",
    description: "歌单介绍", worksNum: 500, playCount: 12000,
};
const album = {
    id: "album-001", platform: "Example Music",
    title: "示例专辑", artist: "歌手",
    artwork: "https://cdn.example.invalid/album.jpg",
    description: "专辑介绍", date: "2026-11-25", worksNum: 12,
};
```

`worksNum` 表示来源声明的总数，**不是当前页长度，也不是完整性证明**。来源可能包含不可用歌曲或重复项。专辑 `date` 是显示文本，不要求宿主推断时区。只有完整导入快照才应携带全部 `musicList`；普通卡片不应塞入几千首歌曲。

### 4.3 歌手与统计

```js
{
    id: "artist-001", platform: "Example Music",
    name: "歌手", avatar: "https://cdn.example.invalid/artist.jpg",
    description: "简介", fans: 10000,
    songCount: 603, albumCount: 45,
}
```

Flutter 区分歌曲数和专辑数，优先使用 `songCount/albumCount` 等明确字段，支持作品响应中的 `artistItem` 更新。不要用含义不清的 `worksNum` 同时充当两个计数；桌面类型中的歌手基本字段不等于移动端计数字段的完整列表。

### 4.4 单位速查

| 字段 / 数据 | 单位 |
|---|---|
| 歌曲 `duration` | 秒 |
| 歌词搜索 `context.durationMs` | 毫秒 |
| MV `expiresAt` | Unix 毫秒 |
| 评论 `createAt` | Unix 毫秒，推荐数字 |
| 文件 `size` | 字节，或明确格式化文本 |
| 识曲 `sampleRate` | Hz |
| 识曲音频 | 有符号 16-bit PCM，参见识曲章节 |
| 歌词逐字时间 | 由具体歌词格式定义，不能混用歌词内部时间单位和歌曲时长 |

<a id="pagination"></a>
## 5. 分页、错误与大列表规则

### 5.1 新插件的统一写法

所有页码从 **1** 开始，后续页只返回该页成员；最后一页返回 `isEnd: true`。始终显式返回布尔值：

```js
{ data: [/* 本页条目 */], isEnd: false }
// 歌单 / 专辑 / 榜单详情使用 musicList
{ musicList: [/* 本页歌曲 */], isEnd: true }
```

固定顺序和稳定身份非常重要。宿主可能去重，也可能直接追加。不要让最后一页永远重复第一页；不能继续时不要返回 `isEnd:false` 配合空页。平台使用 offset/cursor 时，由插件将它适配到页码契约，并考虑并发查询及账号隔离。

### 5.2 现有客户端的缺省值并不一致

| 调用链 | 省略 `isEnd` 的现有行为 |
|---|---|
| 桌面搜索 / 艺人作品 | 缺省为 `true`；搜索的空页也会结束 |
| 桌面专辑 / 歌单 / 榜单详情 / 推荐歌单 / 评论 | 包装层将非严格 `false` 规范化为 `true` |
| Flutter 普通搜索 / 歌单 / 专辑 / 艺人 / 推荐页 | 未给布尔值时通常按列表是否为空判断；非空页可能继续 |
| Flutter 榜单详情 | 为兼容一次返回完整榜单的旧插件，省略布尔值默认完成；显式 `false` 才开启续页 |
| 评论 | 有独立标准化，参见评论章节 |

因此跨端插件**不要依赖任何缺省结束规则**。集合详情和普通搜索是不同接口，不可把 `data`、`musicList`、完整导入快照混为一谈。

Flutter 多个消费者还会在本页无新增身份时终止，避免不分页插件循环。不要依赖“完全重复页/空页之后仍有有效下一页”的行为。

### 5.3 错误不是空结果

- 正常无结果：返回 `{data:[],isEnd:true}`。
- 某首歌/某档位确实不可用：源方法可返回 `null`。
- 网络、认证、限流、响应解析失败：抛出简短、有用的错误，让用户重试。**不要把这些失败伪装成空歌单**，同步可能将空快照当成来源已经清空。
- 不返回错误页 HTML、Axios response、循环对象、函数、DOM、原生句柄或 BigInt。接口数据用普通 JSON 对象、数组、字符串、布尔值、有限数字和 null。
- 不要无限并发、无限重试、在每次列表调用时为每首歌请求完整详情。

### 5.4 大歌单的责任划分

普通浏览按页返回元数据；播放/下载时再解析相应媒体源，不预下载音频或全部封面。**分页详情**由宿主逐页调用；**完整导入**由插件在一次导入方法内取全，不存在通用的导入页码参数。

懒构建列表只减少不可见行的绘制，不能消除网络、JSON、元数据内存、排序和队列传输成本。当前 Flutter 的保存、播放全部、列表内过滤仍受已加载歌曲范围影响；不要把“插件分页正确”宣传成这些操作已经具备全量语义。

<a id="search"></a>
## 6. 搜索：歌曲、专辑、歌手、歌单与歌词

```js
async search(query, page, type, context) {
    // type: music | album | artist | sheet | lyric
    const result = await queryProvider(query, page, type);
    return { data: result.items, isEnd: !result.hasMore };
}
```

`data` 中的对象必须与 `type` 匹配：歌曲使用歌曲字段；专辑/歌单使用 `title`；歌手使用 `name/avatar`；歌词结果仍需有可交给 `getLyric` 的歌曲身份，可附 `rawLrcTxt` 预览。

### 歌词搜索的第四参数

```js
{
    title: "保留空格的歌名",
    artist: "保留空格的歌手",
    durationMs: 245500,
    musicItem: {
        id: "track-001",
        hash: "hash",
        kg_song_id: 123,
        album_audio_id: 456,
    },
}
```

默认关键词为 `歌手 - 歌名`；不会删除词内空格。`durationMs` 仅在已知有效时提供。`musicItem` **只在同平台歌词搜索时提供**，且限于上述身份字段；不能要求宿主传入完整播放队列或跨平台源 ID。第四参数可忽略以兼容旧插件。

Flutter 对声明 `lyric` 的插件发送 `type:"lyric"`；对仅有普通歌曲搜索和 `getLyric` 的旧插件可使用 `type:"music"` 作为歌词候选来源。显式歌词专用插件不应混入普通歌曲搜索。新插件应同时处理普通搜索无 `context`、歌词搜索无时长和跨平台无 `musicItem` 的情况。

<a id="audio"></a>
## 7. 音频源、音质、下载与详情补全

### 7.1 `getMediaSource(musicItem, quality)`

```js
{
    url: "https://cdn.example.invalid/audio.m4a",
    quality: "320k",
    headers: { Referer: "https://example.invalid/" },
    userAgent: "ExampleClient/1.0",
}
```

`quality` 是请求档位，响应 `quality` 应写**实际返回的档位**。播放和音频下载复用此方法，可能重复解析；不要把单次解析误认为唯一调用。

桌面端正式音质键：

```text
96k, 128k, 192k, 320k, flac, flac24bit, hires, vinyl,
dolby, atmos, atmos_plus, master
```

Flutter 优先顺序为 `master, atmos_pro, atmos_plus, atmos, dolby, dts, vinyl, hires, flac24bit, flac, 320k, 192k, 128k, 96k`，另保留自定义键（菜单中排在已知键之后）。它会结合声明、歌曲 `qualities`（兼容 `qualitys`）和旧式 `source` 元数据发现真实档位。跨端首先使用共同标准键，不要把“支持自定义”理解为桌面类型也接受任意字符串。桌面旧键回退为：`96k/128k → low`、`192k → standard`、`320k → high`、其余规范档位 `→ super`；新插件直接实现规范键。回退不会将不支持的档位变成真实可用资源。

返回的 URL 必须能由宿主使用；鉴权请求头放在 `headers/userAgent`，不要只放在插件 Axios 默认设置里。源为空或档位不可用可以返回 `null`。同一首歌若 URL 过期，允许下一次解析换取新地址；不要永久缓存签名 URL。桌面端在插件返回 null/undefined 时可尝试条目已有 URL，但 `{}` 不会触发同样回退；不要用空对象表示有效源。歌曲声明的真实音质也会限制请求档位。

### 7.2 加密源与宿主代理

| 字段 | 用途 | 作者需要提供 |
|---|---|---|
| `ekey` | QMC2 系列音频流 | 有效媒体 URL 与对应密钥；宿主建立解密流 |
| `cek` | CENC/AES-CTR | 32 个十六进制字符的内容密钥与媒体源 |

不要为了这两类源在插件中先下载整首文件，也不应创建本地代理。宿主负责流式处理、Range 和 seek。Flutter 还有专用来源识别/代理实现，属于宿主扩展；没有明确协议的额外字段不能假设桌面端同样支持。

### 7.3 `getMusicInfo(musicBase)`

接收至少有身份字段的对象，返回补充歌曲字段或 `null`：

```js
async function getMusicInfo(musicBase) {
    return {
        id: String(musicBase.id),
        title: "歌曲名称", artist: "歌手", album: "专辑",
        duration: 245.5,
        artwork: "https://cdn.example.invalid/cover.jpg",
        qualities: { "320k": { size: 9234567 } },
        hash: musicBase.hash,
    };
}
```

这是元数据补全，不是歌曲搜索。保留来源身份，避免用错误的 `platform/id` 覆盖目标。单独拿到歌曲 ID 的入口可能缺少 title、hash 等字段，应该补全后再解析音频。

Flutter 按 ID 播放会经过内部 `__playById`：向 `getMusicInfo` 传入兼容 ID 字段并复用已有队列身份。它不是 `importMusicItem` 的移动端别名。

<a id="lyrics"></a>
## 8. 歌词、翻译、罗马音与逐字数据

### 8.1 `getLyric(musicItem)`

推荐直接返回歌词文本：

```js
{
    rawLrc: "[00:01.000]第一句\n[00:05.000]第二句",
    format: "lrc",
    translation: "[00:01.000]First line\n[00:05.000]Second line",
    romanization: "[00:01.000]di yi ju\n[00:05.000]di er ju",
}
```

| 字段 | 含义 |
|---|---|
| `rawLrc` | 歌词原文内容 |
| `lrc` | 歌词 URL；不是另一个任意格式的全文字段 |
| `format` | 原文格式标识 |
| `translation` | 翻译文本 |
| `romanization` | 罗马音文本 |

原文为空不应以错误页或 JSON 字符串冒充歌词。**Flutter 当前不会请求结果中的 `lrc` URL，只处理 `rawLrc/translation/romanization` 文本。** 跨端插件应自行获取歌词正文并返回 `rawLrc`；不要假设音频 headers 会自动用于歌词 URL。

### 8.2 格式与富信息

桌面正式格式：

```text
ttml, lrc, lrc-a2, yrc, qrc, eslrc, lyl, lys, lqe, plain
```

逐字、时间轴、Ruby、背景人声、对唱等应按对应格式编码。TTML 可承载翻译、罗马音、背景声和角色；宿主负责解析、布局和渲染。不要把内部渲染对象数组当成通用 `getLyric` 返回协议。

桌面在无原文时才下载 `lrc` URL（5 秒超时，不继承音频源 headers）；本地歌词侧车优先于插件原文。插件非空翻译/罗马音会合并，三个文本字段都会经过宿主的 QRC 等既有解密兼容处理，这不代表支持任意自定义加密。Flutter 对上述三个规范文本字段做解密和自动格式解析（不依赖 `format` 字段），不应假设读取 `lyric/tlyric/romalrc` 等别名；新插件应尽量返回**已解码、明确格式的规范文本**。不要将“解析器支持某扩展名”混同于所有远程插件结果均支持任意字段。Flutter 的歌词解密、修复和时间轴在 Rust，界面渲染在 Flutter；插件只需提供源内容及必要原始身份。

验证至少包括：空歌词、纯文本、普通 LRC、逐字、翻译、罗马音、多歌手、背景声，以及时长/时间单位正确。播放器歌词、桌面歌词和下载歌词导出是宿主消费同一内容的不同流程。

<a id="collections"></a>
## 9. 歌单、专辑与艺人详情

### 9.1 `getMusicSheetInfo(sheetItem, page)`

```js
{
    sheetItem: { id: "sheet-001", title: "更新后的名称", worksNum: 500 },
    musicList: [/* 当前页歌曲 */],
    isEnd: false,
}
```

保留传入条目的全部平台查询字段。`sheetItem` 用于更新元数据；不要把整份歌单重复放在每一页。

### 9.2 `getAlbumInfo(albumItem, page)`

```js
{
    albumItem: { id: "album-001", title: "专辑", worksNum: 12 },
    musicList: [/* 当前页歌曲 */],
    isEnd: true,
}
```

即使大部分专辑只有一页，也应接收页码并明确结束。不能假设宿主永远只请求第一页。桌面专辑/歌单包装只在第 1 页合并详情元数据，后续页主要追加歌曲；专辑返回歌曲的 `album` 会按输入专辑标题补写。需要后续查询的额外字段应在初始条目或第一页提供。

### 9.3 `getArtistWorks(artistItem, page, type)`

```js
// type === "music"
{ data: [/* 歌曲 */], isEnd: false }
// type === "album"
{ data: [/* 专辑 */], isEnd: true }
```

歌曲和专辑的页码独立，不要在插件全局共用一个“当前页”。Flutter 还读取：

```js
{
    artistItem: {
        id: "artist-001", name: "歌手",
        songCount: 603, albumCount: 45,
    },
    data: [/* 当前类型的条目 */],
    isEnd: false,
}
```

移动端可从 `artistItem` 或明确的 `songCount/albumCount` 等计数字段补充总数。计数不应取“当前页长度”。

### 9.4 `getArtistInfo(artistItem)`

桌面端独立调用，返回艺人补充字段：

```js
{ name: "歌手", avatar: "https://cdn.example.invalid/avatar.jpg", description: "简介", fans: 10000 }
```

Flutter 目前没有对应的详情补全调用链。需要跨端显示的信息应同时放在搜索歌手条目、作品响应中的 `artistItem`，不要只在这个函数中提供。

<a id="discovery"></a>
## 10. 榜单与推荐歌单

### 10.1 `getTopLists()`

返回榜单分组，不是歌曲列表：

```js
[
    {
        title: "官方榜",
        data: [
            { id: "top-500", title: "热门 500", platform: "Example Music", worksNum: 500 },
        ],
    },
]
```

分组 `title` 可以省略，`data` 是可进入榜单详情的卡片。Flutter 也容忍部分未分组数组/包装形状，新插件使用上述共同格式。

### 10.2 `getTopListDetail(topListItem, page)`

```js
{
    topListItem: { id: "top-500", title: "热门 500", worksNum: 500 },
    musicList: [/* 当前页，按排名排序 */],
    isEnd: false,
}
```

桌面端读取 `topListItem` 更新标题等信息；Flutter 的通用集合解码目前读取 `sheetItem/albumItem`，并不以 `topListItem` 更新元数据。因此跨端插件应在初始榜单卡片中提供完整信息；必要时同时返回同内容的 `sheetItem`，不要只依赖详情元数据更新。

旧插件可一次返回全部歌曲并标记 `isEnd:true`。Flutter 最新榜单续页只对明确的 `isEnd:false` 开启；排行榜后续页必须保留自然排名，不要每页自行随机或重新排序。

### 10.3 `getRecommendSheetTags()`

```js
{
    pinned: [{ id: "all", title: "全部" }],
    data: [
        { title: "风格", data: [{ id: "pop", title: "流行" }, { id: "rock", title: "摇滚" }] },
        { title: "场景", data: [{ id: "work", title: "工作" }] },
    ],
}
```

这里的条目是**标签身份**，即使结构沿用歌单卡片，也不要求它是实际歌单。`id` 必须能原样传回下一方法。Flutter 首页会选择标签并保持会话；不要强行把某个首页选择推断成插件端随机推荐协议。

### 10.4 `getRecommendSheetsByTag(tagItem, page = 1)`

```js
{
    data: [
        { id: "sheet-001", title: "流行精选", platform: "Example Music", worksNum: 100 },
    ],
    isEnd: false,
}
```

返回的是歌单卡片，点开后由 `getMusicSheetInfo` 获取歌曲。不能直接返回歌曲对象替代歌单。标签变化必须重新从第 1 页开始；不要只按 page 缓存不同标签结果。

<a id="hot-search"></a>
## 11. 热搜（Flutter 扩展）

Flutter 按下列顺序选择第一个实际存在的方法，无参数调用：

1. `getHotSearch()`
2. `getHotSearches()`
3. `getHotSearchList()`
4. `getHotSearchWords()`
5. `hotSearch()`

新插件只需实现首选 `getHotSearch`，不要为同一功能导出五份重复函数。

推荐返回：

```js
async function getHotSearch() {
    return ["歌曲关键词", "歌手关键词", "专辑关键词"];
}
```

Flutter 兼容 `data/list/hotSearches/hots` 包装以及部分嵌套 `list/hots`，条目可为字符串或对象，对象依次读取 `searchWord/keyword/word/first/title/name`。空白剔除、去重后最多取 30 个词。热搜是关键词，不是可直接播放的歌曲；宿主点击后再走 `search`。

桌面端当前无热搜方法白名单/消费入口。导出这些方法不会自动让桌面端调用它们。

<a id="daily"></a>
## 12. 每日推荐（Flutter 扩展）

### 12.1 `getDailyRecommendations()`

无参数，插件从用户变量/自己的服务取得账号状态。成功返回：

```js
{
    state: "ready",
    date: "2026-11-25",
    title: "每日推荐",
    accountName: "示例账号",
    refreshAt: Date.now() + 3600000,
    sheetItem: {
        id: "daily-2026-11-25",
        platform: "Example Music",
        title: "每日推荐",
        worksNum: 30,
        dailyToken: "provider-owned-query-token",
    },
}
```

- `sheetItem` 是歌单入口；详情继续调用 `getMusicSheetInfo(sheetItem,page)`，必须保留账号/日期等平台查询字段。
- `refreshAt` 是**未来的 Unix 毫秒时间**；过期结果会被转成 `updating`，不能当成新的可用推荐。
- `date` 是平台显示日期，不强行按设备时区重算。
- `title/accountName/connectUrl` 是可选显示/连接信息，不要夹带令牌和开发诊断。

### 12.2 状态表

| `state` | 含义 |
|---|---|
| `ready` | 有有效的未来刷新时间和歌单入口 |
| `unconfigured` | 尚未配置账号/变量 |
| `login_required` | 需要登录或更新凭据 |
| `blocked` | 平台当前不允许获取 |
| `updating` | 推荐正在更新或旧结果过期 |
| 其他 / 无效值 | 按错误状态处理 |

未导出该方法时宿主视为 `unsupported`。非 ready 结果可带 `title/accountName/connectUrl`，不需要假造空的可播放歌单。账号、变量、日期和推荐有效期均应纳入插件缓存键。

桌面端当前未接入此扩展；不存在跨端统一的账号连接回调协议。

<a id="comments"></a>
## 13. 评论与回复

### `getMusicComments(musicItem, page = 1)`

```js
{
    isEnd: true,
    data: [{
        id: "comment-001",
        nickName: "听众",
        avatar: "https://cdn.example.invalid/avatar.jpg",
        comment: "评论正文",
        like: 12,
        createAt: 1795600000000,
        location: "上海",
        replies: [{
            id: "reply-001", nickName: "回复者", comment: "回复正文",
        }],
    }],
}
```

桌面规范字段为 `nickName/comment/like/createAt`，不要直接照搬平台的 `nickname/content/likedCount/time`。回复使用递归 `replies`，并控制体积和深度。回复内分页没有独立公开方法。桌面类型允许 `replies`，但当前评论面板只渲染顶层评论，不能将返回嵌套回复视为桌面 UI 已完整展示回复的证明。

Flutter 有原生评论标准化和别名兼容，但跨端插件应主动映射到上面的规范字段。需要翻页时明确返回 `isEnd:false`；没有评论返回 `{data:[],isEnd:true}`。评论接口不提供发表评论、点赞、删除或回复写入的标准方法。

Flutter 兼容顶层数组或 `data/comments/items`，条目正文 `comment/content/text`；用户名 `nickName/nickname/userName/name`，点赞 `like/likeCount/likes/like_count`（不是 `likedCount`），日期 `createAt/createdAt/timestamp/time`。正数日期小于 1e11 时按秒转毫秒。空正文被丢弃，回复深度受限为 8。结束规则为：空列表结束；否则显式 isEnd 优先，其次取 !hasMore，均缺省则结束。这些兼容别名不替代桌面规范字段。

<a id="video"></a>
## 14. MV：发现、播放、切换画质与下载

### 14.1 视频入口

歌曲的 `mv`、`videoId`、`is_video` 等信息用于暴露视频入口。**只导出 `getMvSource` 并不能凭空为每首歌生成 MV。** 保留平台的视频身份字段；没有视频时返回 `null`。

### 14.2 `getMvSource(musicItem, videoQuality?)`

```js
{
    url: "https://cdn.example.invalid/video.mp4",
    videoQuality: "1080p",
    headers: { Referer: "https://example.invalid/" },
    userAgent: "ExampleClient/1.0",
    width: 1920, height: 1080,
    duration: 245.5, bitrate: 4500000, size: 140000000,
    codec: "avc1", mimeType: "video/mp4",
    dynamicRange: "sdr",
    backupUrls: ["https://backup.example.invalid/video.mp4"],
    expiresAt: Date.now() + 600000,
    availableVideoQualities: [
        { key: "720p", label: "720P", width: 1280, height: 720, codec: "avc1", dynamicRange: "sdr" },
        { key: "1080p", label: "1080P", width: 1920, height: 1080, codec: "avc1", dynamicRange: "sdr" },
    ],
}
```

### 14.3 字段与规则

| 字段 | 规则 |
|---|---|
| `url` | HTTP(S) 远程视频地址，不能返回任意本地文件路径 |
| `videoQuality` | 实际档位，和音频 `quality` 分开 |
| `availableVideoQualities` | 真实可用档位；每项 `key` 会原样传回后续解析 |
| `key/label` | 稳定请求键 / 显示文本；不能只返回 label |
| `width/height` | 非负尺寸 |
| `bitrate` | 平台实际码率，推荐 bits/s |
| `size` | 字节或格式化文本 |
| `codec/mimeType` | 实际编码和 MIME |
| `dynamicRange` | `sdr`、`hdr10`、`dolby-vision` |
| `backupUrls` | 主地址不可用时的候选地址 |
| `expiresAt` | Unix 毫秒；不是剩余秒数 |
| `headers/userAgent` | 媒体请求所需信息，不只用于获取 URL 的 API |

各画质项也可提供 `bitrate/size/codec/mimeType/dynamicRange`。首次调用可能不传画质，选择可用默认值并返回实际档位；后续传入插件返回的稳定键。切换画质时不要把未知请求默默当作最高画质。

桌面端 `expiresAt` 当前只做声明/标准化，没有主动监控到期的播放器逻辑；不要依赖它自动刷新地址。

MV 下载复用同一源协议，宿主负责任务和保存路径，不需要 `downloadMv`。备用地址、过期刷新、编码和 HDR 支持要在实际设备分别验证：声明 Dolby Vision 不等于设备已具备对应渲染能力。

<a id="import"></a>
## 15. 分享、单曲导入、歌单快照与同步

### 15.1 `getMusicDetailPageUrl(musicItem)`

同步或异步返回歌曲的 HTTP(S) 分享/详情 URL，或 `null`：

```js
function getMusicDetailPageUrl(musicItem) {
    return "https://example.invalid/song/" + encodeURIComponent(musicItem.id);
}
```

不要返回可执行脚本、HTML、`file:` 地址或没有转义的拼接内容。Flutter 通过内部 `__musicShare` 进行校验，并可能使用条目已有分享字段作为兼容来源；插件作者仍应实现规范方法。

### 15.2 `importMusicItem(urlLike)`（桌面端）

输入为用户粘贴的链接/ID 文本，返回一首完整的规范歌曲或 `null`。解析时保留播放、歌词、MV 所需字段。它不是列表分页接口，也不是“按 ID 播放”的统一跨端协议。

### 15.3 `importMusicSheet(urlLike, options?)`

返回**完整歌单快照**：

```js
{
    id: "sheet-001", platform: "Example Music",
    title: "导入的歌单", artist: "创建者",
    artwork: "https://cdn.example.invalid/sheet.jpg",
    description: "介绍", worksNum: 500,
    musicList: [/* 完整、按顺序的有效歌曲 */],
    isEnd: true,
    syncVersion: "account-A:sheet-001:revision-8",
}
```

旧插件返回歌曲数组仍有兼容，但会丢失歌单标题、封面等上下文。新插件使用对象。

插件负责取完平台的分页，可逐页顺序请求并设置有界重试；一次导入方法不能仅返回首页让宿主猜测如何继续。`worksNum` 与规范化后的唯一歌曲数可能不同，不能只看总数判断成功。

网络/认证失败抛错；成功的空列表只表示来源确实为空。桌面同步允许真实空快照；Flutter 首次导入要求有有效歌曲，而同步允许空列表并拒绝明确的 `hasMore:true/isEnd:false`。Flutter 首次导入当前还没有相同的完整性拒绝检查，**插件仍必须取全，不能利用这个缺口返回半份歌单**。

`isImported/importSources/importOwnership` 等归属与来源记录由宿主管理。不要伪造其他插件来源、手工添加标记或宿主信任字段。

### 15.4 条件完整快照（桌面端可选扩展）

桌面端支持：

```js
async function importMusicSheet(input, options) {
    const known = options && options.knownVersion;
    const revision = await getCurrentRevision(input);
    if (known && revision === known) {
        return { notModified: true, syncVersion: revision };
    }
    return {
        id: "sheet-001", title: "歌单",
        musicList: await fetchAllTracks(input),
        syncVersion: revision,
    };
}
```

`syncVersion` 是 1–1000 字符的不透明版本号，必须覆盖**成员、顺序、返回的歌曲元数据**并区分来源和账号。不得把密钥作为版本号；不得仅凭“同一天”断定未变化。

仅在请求带来的 `knownVersion` 确实匹配时返回 `notModified:true`；宿主未传版本时必须返回完整快照。旧插件忽略第二参数即可。桌面当前要求：若提供 `options`，必须含有效非空 `knownVersion`；不要主动传入 `{}`。

**Flutter 当前不发送该条件版本请求，也不消费 notModified 快照**，因此跨端插件只有收到有效 `options.knownVersion` 才可使用简化响应。`{sync:true}` 是 Flutter 调用内部导入桥时的宿主选项，不等于一定会传给插件。

### 15.5 宿主同步行为

两端在同步时保留手动添加项和来源归属，避免某个来源移除歌曲时误删其他来源仍拥有的成员。同步不是追加重复歌单：完整快照用于比较成员与顺序，然后事务提交；旧数据应在取回成功前保留。

桌面同步有同插件串行、最多三个插件并行、在途合并与有界快照缓存。条件快照缓存最多 16 个来源、共 8 MiB、单条 50,000 首、最长 5 分钟；重启/淘汰后重新取完整快照。插件/配置/用户变量/语言/代理变化会使相关版本缓存失效。不要把这些桌面实现数值当作移动端统一契约。

`MusicSheet.frontend.getLastImportSyncMetrics()` 是宿主开发诊断，不是插件可调用 API，也不是普通用户流程的一部分。

<a id="recognition"></a>
## 16. 听歌识曲（桌面端）

### `recognize(audioBase64, sampleRate?, channels?)`

桌面录制链路提供约 10 秒的 **8 kHz、16-bit、单声道 PCM** Base64，参数会传入实际采样率和声道数。它不是 WAV 文件、MP3 或浏览器 Blob；如果服务要求 WAV，由插件按服务协议封装正确的 PCM 头。

```js
async function recognize(audioBase64, sampleRate, channels) {
    const matches = await queryRecognitionService({
        audioBase64, sampleRate, channels,
    });
    return {
        isEnd: true,
        data: matches.map((item) => ({
            id: String(item.id),
            platform: "Example Music",
            title: item.title,
            artist: item.artist,
            duration: item.durationSeconds,
            artwork: item.cover,
            hash: item.hash,
            qualities: item.qualities,
            confidence: item.confidence,
        })),
    };
}
```

缺省采样率/声道为 `8000/1`。必须返回带 `data` 数组的对象，不能只返回候选数组；桌面包装层会拒绝后者。

返回 `data` 是歌曲候选，不是另一套识曲专用身份。用户应能对候选继续获取详情、播放、歌词与收藏，因此仅返回识曲服务的临时请求 ID 不够。

`confidence` 是可选置信度，建议映射到 0–1 并保持含义一致。没有识别结果返回空数组，不代表需要下一页；此接口没有 page 参数。

桌面宿主有针对部分旧平台的内建识别回退和元数据补全，属于兼容行为。新插件应自行实现识曲能力，不要依赖平台名称匹配来获得通用识曲服务。**Flutter 当前没有录音/recognize 插件消费链**；不能将桌面方法表当作已支持移动端识曲的证明。



<a id="apple-hls"></a>
## 17. Apple HLS 专用源与密钥回调（Flutter 扩展）

这是一条独立于普通 `url/ekey/cek` 的原生源协议。桌面端的 18 方法白名单**不包含** `getAppleMusicKey`，不能将此描述符直接作为普通跨端音频源。

### 17.1 `getMediaSource` 返回描述符

```js
{
    type: "apple-hls",
    appleMusic: {
        version: 1,
        playlistUrl: "https://media.example.invalid/playlist.m3u8",
        adamId: "123456789",
        keyEndpoint: "https://keys.example.invalid/session",
        codec: "alac",
        // audioGroup: "provider-audio-group",
    },
}
```

`appleMusic` 严格校验字段，不要加入未定义键：

| 字段 | 约束 |
|---|---|
| `version` | 必须为数字 `1` |
| `playlistUrl` | HTTP(S) URL，必须有 host，不含 URL 用户名/密码及 fragment |
| `adamId` | 1–32 位十进制数字字符串，首位不为 0 |
| `keyEndpoint` | 字符串，最多 2048 UTF-8 字节；传回插件，不由描述符选择其他插件 |
| `codec` | 可选字符串，最多 64 字节；实际媒体必须与声明相符 |
| `audioGroup` | 可选字符串，最多 256 字节，用于选择音轨组 |

**此专用路径当前不会把普通源的 `headers` 自动转发给清单/分片请求**；必须提供原生路径可直接访问的媒体 URL，不要依赖普通音频源的 Authorization 规则来完成此处媒体鉴权。密钥服务的认证由插件回调处理，`keyEndpoint` 由宿主原样传回而非主动请求；宿主不会注入可直接使用的密钥服务器。

### 17.2 `getAppleMusicKey(request)`

宿主会调用**同一个源插件**的：

```js
async function getAppleMusicKey(request) {
    // request: { adamId, uri, keyEndpoint }
    // 通过你实现的服务获取原生解密上下文，返回下面约定的数据。
    const { data } = await axios.post(request.keyEndpoint, {
        adamId: request.adamId,
        uri: request.uri,
    });
    return data;
}
```

上述请求体只是适配示意，服务端的鉴权和响应生成必须真实实现。输入 `uri` 来自 SAMPLE-AES 清单的 `skd://itunes.apple.com/...` 密钥 URI，最多 2048 字节且不含空白。

回调结果是**直接的上下文对象**，不是 `{data:...}` 包装，也不是普通 16 字节 AES key：

```text
{
  ctx:   "<标准 Base64，上下文字节>",
  state: "<标准 Base64，状态字节>",
  rdx: "<十六进制寄存器值>", rcx: "<十六进制寄存器值>",
  rax: "<十六进制寄存器值>", r9:  "<十六进制寄存器值>",
  rbp: "<十六进制寄存器值>"
}
```

- `ctx` 解码后 0x8000–0x10000 字节。
- `state` 解码后 0x2000–0x8000 字节。
- 寄存器字段为 1–16 位十六进制字符串，可带 `0x` 前缀。
- 完整 JSON 上限 256 KiB；回调等待上限 15 秒。
- 占位字符串不构成有效上下文，不应复制成可用的演示密钥。

### 17.3 播放、下载与刷新

当前要求有限 VOD 媒体清单（ENDLIST）、byte ranges、SAMPLE-AES/com.apple.streamingkeydelivery；不接受 master/live/discontinuity、多 MAP 或缺少必要范围/密钥信息的清单。Range 响应必须 206 且 Content-Range 精确匹配。当前限额包括：清单 1 MiB、init 8 MiB、分片 24 MiB、单 sample 1 MiB、10,000 分片、64 个密钥、200 万 sample。

Rust 宿主负责媒体清单、分片、解密、Range 和本地输出。播放 ALAC 源走 WAV 输出，AAC 走 M4A；**下载已支持清晰的编码 M4A**，ALAC 保持 ALAC、AAC 保持 AAC，不等于所有源都转成 WAV。

分片遇到 401/403/410 时，宿主可用原始参数再次调用源插件的 `getMediaSource` **一次**获取新描述符；刷新后的流结构、编码、请求头、长度与 sample 布局需要满足宿主的一致性校验。不能通过刷新把当前会话切换成另一首歌或不兼容编码。

此专用协议的最终约束见 Flutter 的 `baka-proxy/src/apple/{mod,prepare,playlist,session}.rs` 和 `baka-ffi/src/apple_playback.rs`。它是音源协议，不提供 Apple 账号登录、云库管理或通用 DRM 插件 SDK。

<a id="runtime"></a>
## 18. JavaScript 运行时、网络、存储与 Cookie

### 18.1 执行模型

桌面端在 Electron `utilityProcess` 中管理插件；这是受控运行边界，不能据此宣称“任意第三方代码绝对隔离”。Flutter 每个插件使用独立 QuickJS 运行时，不是完整 Node.js 或浏览器。

两端调用都支持异步 Promise，并将 `this` 绑定到插件导出对象。结果需为 JSON 安全数据。Flutter 会 JSON 序列化跨越 Rust 边界，`undefined` 最终可变为 null。

不依赖应用 Renderer DOM、Electron、任意文件路径、原生模块或未提供的 npm 包。桌面工具进程存在的 Node 全局，也不自动成为跨端插件契约。网络优先使用共同提供的 `axios`。

### 18.2 require 支持矩阵

| 模块 | 桌面端 | Flutter 端 |
|---|---|---|
| `axios` | 包实现及宿主请求配置 | 受支持子集，见下表 |
| `crypto-js` | 包实现 | 加密/编码子集 |
| `cheerio` | 包实现 | 轻量 HTML/选择器子集 |
| `dayjs` | 包实现 | 基本日期格式化子集 |
| `big-integer` | 包实现 | 大整数常用操作子集 |
| `qs` | 包实现 | 简单平面键值 stringify |
| `he` | 包实现 | `decode` |
| `pako` | inflate/deflate 等及兼容包装 | `inflate`，不能假设 deflate/ungzip 存在 |
| `buffer` | Buffer | Node 风格兼容 Buffer |
| `@react-native-cookies/cookies` | Electron Cookie 桥 | 不提供 |
| `webdav` | 提供 | 不提供此 require 模块 |
| `musicfree/storage` | 共享持久化存储 | 不提供 |
| `baka/storage` | 不提供 | 插件隔离持久化存储 |

未知 `require`：桌面返回 null，Flutter 抛错。可选模块检测既要捕获异常，也要处理 null。`__musicfree_require` 是兼容 require 别名，不是另一个包管理器。

Flutter 具体子集：

| 模块 | 可依赖的当前能力 / 重要缺口 |
|---|---|
| Axios | 可调用配置、URL+配置、`request/get/post/getUri/default`；支持 headers、params、body、timeout、arraybuffer、validateStatus 等；不提供 `create/interceptors/put/delete` 辅助 API |
| CryptoJS | Utf8/Hex/Base64/Latin1，MD5/SHA1/SHA256/HmacSHA256，AES ECB/CBC，Pkcs7/NoPadding；AES 显式 WordArray key，CBC 显式 IV，不支持字符串口令自动派生密钥 |
| Cheerio | load/select/text/attr/children/find/each/map/toArray/first 等；复杂 CSS 选择器不能假定等同 npm cheerio |
| Dayjs | 基础调用、unix、format；主要替换 YYYY/MM/DD/HH/mm/ss，不含完整插件生态 |
| Pako | 字节输入 inflate；可用 `{to:"string"}` 获取文本，否则字节输出 |
| Buffer | 同时有全局 Buffer 与 `require("buffer")`，支持编码及常用二进制读写；不代表存在 fs/stream |

Flutter 还提供 URL/URLSearchParams、TextEncoder/TextDecoder、btoa/atob、AbortController/AbortSignal、console 和定时器兼容。**不要由此推断存在 fetch、DOM 或完整 WebCrypto**。如果依赖某个子集之外的函数，将兼容实现打包进自己的脚本并实测。

### 18.3 HTTP 请求

```js
const { data } = await axios.get("https://api.example.invalid/items", {
    params: { page: 1 },
    headers: { Authorization: "Bearer " + (env.getUserVariables().token || "") },
    timeout: 10000,
});
```

| 项目 | 桌面端 | Flutter 端 |
|---|---|---|
| Axios 默认超时 | 15 秒 | 20 秒，请求超时封顶 60 秒 |
| 请求/响应体 | 默认最大 16 MiB | 由原生 HTTP 路径和运行时边界限制，不能照搬桌面配额 |
| 重定向 | 由宿主/请求配置管理 | 默认及上限 10；每次重定向经过工作区网络准入 |
| 代理/Cookie/TLS | 应用配置的代理；Electron Cookie 另有桥 | 原生网络路径；不承诺与 Electron 完全相同 |
| 二进制响应 | 常见 Axios/Node 表现 | `arraybuffer` 为 Uint8Array 兼容数据 |

超时不是“等待到上限才开始”：播放、歌词、MV 等上层流程还有自己的总预算。单个 HTTP 请求可用 60 秒不表示播放源解析一定会等 60 秒。

不能假设 Axios 自动共享 Electron Cookie，也不能假设鉴权请求头会被媒体播放器继承。Cookie、API 请求和媒体请求是不同链路，应分别正确传递。工作区禁网、插件禁用或切换导致的取消应正常结束，不绕开宿主网络路径另起进程。

### 18.4 存储适配

共同接口为异步 `getItem(key)`、`setItem(key,value)`、`removeItem(key)`，存储字符串；找不到返回 null。跨端选择模块：

```js
function getStorage() {
    try {
        const native = require("baka/storage");
        if (native) return native;
    } catch (_) {
        // 桌面端没有此模块时继续。
    }
    const legacy = require("musicfree/storage");
    if (!legacy) throw new Error("当前宿主没有可用存储模块");
    return legacy;
}
```

| 边界 | 桌面 `musicfree/storage` | Flutter `baka/storage` |
|---|---|---|
| 隔离 | 所有插件共享 JSON 存储，**自行给键加插件前缀** | 插件 ID 隔离的 SQLite 存储 |
| 配额 | 全部插件合计 10 MiB | 每插件键和值合计 10 MiB UTF-8 |
| 键 | 非空，最多 1024 JS 字符 | 1–1024 UTF-8 字节 |
| 写入 | 应 await 完成 | 事务提交后确认，应 await 完成 |

例如保存对象需 `JSON.stringify`，读取后自行 `JSON.parse` 并处理旧版本数据。不要存储整份音频、无限增长的歌词/媒体列表缓存，或把存储写入当成必然成功。

### 18.5 Cookie 桥（仅桌面）

`require("@react-native-cookies/cookies")` 提供异步 `get(url)`、`set(url,cookie)`、`flush()`。get 返回名称到 cookie 的映射；set 至少需要有效名称/值和 HTTP(S) URL，宿主校验长度与过期字段，flush 持久化 Electron 默认 session。

这不是移动端 Cookie API，也不是自动登录 SDK。`webdav` require 同样是桌面能力；Flutter 的宿主 WebDAV 备份功能不代表给第三方脚本开放同名模块。

### 18.6 资源边界

| 桌面边界 | 当前实现 |
|---|---|
| 插件代码 | 最大 5 MiB |
| 序列化元数据 | 最大 1 MiB |
| RPC 负载 | 最大 16 MiB |
| 待处理调用 | 最多 128 |
| 加载 / 普通方法调用 | 10 秒 / 30 秒 |
| 共享 utility 工作集 | 384 MiB 上限可触发宿主终止 |
| Cookie 回调 | 10 秒 |

Flutter 单插件 QuickJS 当前内存上限 128 MiB、栈上限 2 MiB。原生媒体/歌词/导入等不同路径还有独立限制。歌词普通解析文本每项上限 2 MiB、行数上限 20,000；TTML 有元素数/深度限制；加密 QRC 另有输入及解压上限。不要据此把接近限额作为正常数据规模。

<a id="lx"></a>
## 19. LX 音源：独立兼容层

LX 脚本不是上述 CommonJS 插件对象。它通过 `lx` 事件协议注册来源和 `musicUrl` 处理器；宿主把它作为某个平台的**播放接口覆盖**。搜索、歌词、歌单和详情仍由已安装的普通插件提供。

来源代码为 `kw/kg/tx/wy/mg`；脚本需声明实际支持的来源、动作与音质，宿主再与歌曲实际能力求交集。安装某个 LX 脚本并不等于每首歌都拥有它声明的所有档位。

流程：

1. 读取宿主提供的 `lx.EVENT_NAMES`。
2. 注册 `lx.on(EVENT_NAMES.request, handler)`。
3. 发送 `EVENT_NAMES.inited`，声明 `sources`。
4. 收到 `source/action/info` 后，仅处理支持的 `musicUrl` 请求并返回真实媒体地址。
5. 用户选择该播放接口后，宿主按来源路由；不相关来源继续使用普通插件。

处理器接收 `{source,action:"musicUrl",info:{type,musicInfo}}`，其中 `info.type` 是音质，`musicInfo` 由宿主从基础插件歌曲转换（保留 songmid 等身份）。初始化项使用 `{name,type:"music",actions:["musicUrl"],qualitys:[...]}`，注意旧字段拼写 `qualitys`。跨端应返回 **URL 字符串**。Flutter 另兼容源对象，但桌面 LX 宿主只接受字符串，并通过 Range `bytes=0-1` 请求探测 HTTP 200/206（8 秒预算）；不要把普通插件的源对象直接用于跨端 LX。

可复制模板与准确事件字段见 [LX 模板](plugin-templates/lx-source.js)。LX 的 `lx.request/utils` 等兼容 API 有独立实现，不等于普通插件的 Axios/require 环境。不要把 LX 事件名导出为 BakaMusic 方法，不要在普通插件中调用并不存在的 `requestMusicUrl` 注入函数。

`lx.request(url,options,callback)` 的 callback 为 `(error,response,body)`，返回取消函数；支持 method/headers/body/form/formData/binary/timeout。`lx.utils` 提供 buffer、crypto、zlib 兼容工具。桌面 LX 环境没有普通插件的 env/require/module；跨端脚本使用共同 lx API。`updateAlert` 用于更新提示；Flutter 对 `showConfigView` 只做无 UI 的兼容接收，桌面没有此事件，不能声称脚本配置页已实现。

两端均有 LX 适配；单独选择的脚本不声明某来源时，不会自动改选另一个脚本。特定脚本是否可用仍取决于事件 API、歌曲身份、音质映射和真实服务，不由“安装成功”保证。

<a id="publishing"></a>
## 20. 安装、订阅、完整性与更新

### 20.1 桌面端

本地可导入 `.js` 或 JSON 清单；远程只接受 HTTPS。远程按实际内容识别 JavaScript 或清单，不要求文件扩展名，查询参数和无扩展名 URL 均可。

桌面订阅清单：

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

示例摘要是占位，发布前必须计算最终脚本的真实摘要；可复制 [manifest.example.json](plugin-templates/manifest.example.json)。清单项是对象，不能用纯字符串数组替代。

- 远程相对 URL 基于清单地址解析；本地清单没有远程基准地址，应使用绝对 HTTPS URL。
- 清单最大 1 MiB、最多 100 项；脚本最大 5 MiB。
- 下载超时 20 秒，最多 5 次 HTTPS 重定向。
- `sha256` / `integrity` 可使用 64 位十六进制或 `sha256-<Base64>`。字段值优先于 URL 中的 hash。
- 签名需要同时提供 `signature/publicKey`；当前使用 `crypto.verify(null, UTF8代码, 公钥, Base64签名)`，例如 Ed25519，而非任意自定义摘要签名。
- 摘要/签名以最终文本编码与换行字节为准，计算后不要再次改写脚本。

更新时保持 `platform` 稳定并提升 `version`。桌面更新沿插件的 `srcUrl`；仅安装清单记录了下载来源，不代表插件自动拥有更新地址。不声明 `srcUrl` 的插件不会仅凭旧订阅凭据自动完成 update-all。

桌面默认拒绝较旧版本覆盖新版本（存在显式覆盖设置）；同版本不同代码可替换。类型中的 `appVersion` 并未形成统一的安装版本约束，不要自行编造 `minVersion` 清单字段。发布前检查新版是否能读取已有用户变量与存储。

### 20.2 Flutter 端

Flutter 安装路径与桌面不同：

| 项目 | Flutter 当前行为 |
|---|---|
| 远程地址 | 接受 HTTP(S)，最多 10 次 HTTP(S) 重定向；推荐作者发布 HTTPS |
| 下载边界 | 连接 15 秒、总计 20 秒、最多 5 MiB、严格 UTF-8 |
| 清单 | 远程文本以 `{` 开头才尝试清单；`plugins` 项可为字符串，或含 `url/srcUrl` 的对象；相对地址基于清单 URL |
| 摘要与签名 | 此路径**不验证**桌面的 sha256/integrity/signature/publicKey；不能向用户宣称跨端均已验签 |
| 清单限制 | 没有独立的桌面 1 MiB/100 项规则或 BOM 去除逻辑，仍受下载体积约束 |
| 本地 JSON | 文件选择器将文本交给脚本导入，不等于桌面本地清单解析 |
| 更新 | 使用调用者安装时存储的来源 URL；本地脚本没有远程地址时跳过更新 |
| 替换身份 | 优先复用 kind + 安装定位符对应的注册 ID；LX 还按脚本名匹配；普通插件平台重名时会查找同 platform 的已安装插件替换；没有桌面同等版本降级拒绝 |

订阅逐项安装不是全局原子事务。安装来源 URL、插件注册 ID 和显示名 `platform` 不是同一字段；跨端分发必须分别走真实安装入口验证。

Flutter 直接加载完整下载源码，**不为外部脚本自动注入服务端 API Key、UPDATE_URL 或 requestMusicUrl**。需要的服务地址、签名代码、适配逻辑必须在交付文件或明确的用户配置中存在。

<a id="compatibility"></a>
## 21. 跨端兼容决策表

| 事项 | 跨端建议 |
|---|---|
| 函数声明 | 以共同方法为基础，热搜/每日推荐和识曲分别标明单端 |
| 元数据 | 显式声明实际搜索类型；`primaryKey/defaultSearchType/cacheControl/appVersion` 的桌面字段不等于 Flutter catalog 行为 |
| 源与音质 | 共同标准键优先；移动自定义档位、Apple HLS 回调单独实现与验证 |
| 分页 | 永远显式布尔 `isEnd`，不依赖缺省值 |
| 歌词 | 跨端插件请求并返回 `rawLrc` 正文；不要只返回 URL |
| 评论 | 返回规范字段；移动别名兼容不是桌面契约，桌面不渲染嵌套回复 |
| 榜单元数据 | 初始卡片完整，必要时同时返回 `topListItem/sheetItem` |
| 艺人详情 | 不只依赖桌面 `getArtistInfo`；移动在条目/作品响应中提供信息 |
| 导入版本 | 仅在确实收到 `knownVersion` 时返回 notModified；移动目前始终取完整快照 |
| 用户变量 | 方法内读取；Flutter 特有表单字段不能当成桌面表单能力 |
| 持久化 | 模块适配并处理差异；桌面键前缀与共享配额 |
| npm 包 | 使用两端都实现的子集，尤其 Axios/Cheerio/CryptoJS |
| 更新 | 分别走两端安装与更新入口验证 |
| 测试 | Node 自测、真实宿主加载、设备播放证据分开记录 |

<a id="templates"></a>
## 22. 模板目录与开发方式

完整文件位于 [plugin-templates](plugin-templates/README.md)：

| 文件 | 用途 |
|---|---|
| [minimal-plugin.js](plugin-templates/minimal-plugin.js) | 真实 HTTP 适配起点，只声明已实现的搜索/音频能力 |
| [full-plugin.js](plugin-templates/full-plugin.js) | 离线数据演示全部 18 个桌面方法、Flutter 热搜和每日推荐 |
| [lx-source.js](plugin-templates/lx-source.js) | 独立 LX 格式模板，不能按普通插件对象使用 |
| [manifest.example.json](plugin-templates/manifest.example.json) | 桌面订阅清单格式 |
| [check.cjs](plugin-templates/check.cjs) | Node 离线契约自测，检查方法覆盖、分页、字段和错误 |
| [README.md](plugin-templates/README.md) | 替换点、演示数据和跨端验证说明 |

完整演示会产生固定的媒体/目录/评论/识曲测试数据，**不会实际进行歌曲指纹识别或连接真实音乐目录**。音视频、图片和页面使用 `.invalid` 占位域名。配置 `mediaBaseUrl` 并提供匹配文件后，才可进行真实播放测试。请勿把这种演示插件当作可供普通用户使用的在线音源。

`getAppleMusicKey` 不在普通完整演示的 20 方法内：它需要真实有效的专用解密上下文，按第 17 节接入与验证，不能以假寄存器值冒充有效模板。

添加能力的推荐顺序：歌曲模型 → 搜索 → 源与音质 → 详情/歌词 → 集合分页 → 推荐/榜单 → 评论/MV → 分享/导入 → 单端扩展。每次只声明真正可调用的能力，并针对原始平台字段保留回归样本。

<a id="testing"></a>
## 23. 自测、宿主回归与发布验收

### 23.1 模板快速检查

从桌面仓库根目录运行：

```sh
node docs/check-plugin-guide.cjs
node docs/plugin-templates/check.cjs
node --check docs/plugin-templates/minimal-plugin.js
node --check docs/plugin-templates/full-plugin.js
node --check docs/plugin-templates/lx-source.js
```

这些检查可证明示例代码和固定契约断言成立，**不能证明 Electron/QuickJS 完全一致、远程服务可用、真实媒体能解码或设备上的 HDR 正确**。

### 23.2 桌面宿主相关回归

```sh
npm run test:plugin-video-api
npm run test:plugin-playback-log
npm run test:lx-plugin
node scripts/import-sheet-sync.test.cjs
node scripts/lyric-search-context.test.cjs
```

第一项包含安装完整性回归。若修改运行时/类型/产品调用链，还应执行项目规定的类型检查、只读 lint、完整 `npm test` 与对应打包冒烟；单改文档无需宣称运行了这些全部检查。

### 23.3 Flutter 宿主相关回归

在 BakaMusicFlutter 根目录（Windows 使用共享 SDK `D:/flutter`）：

```sh
D:/flutter/bin/flutter.bat test test/chart_pagination_test.dart test/artist_albums_test.dart test/music_input_test.dart
D:/flutter/bin/flutter.bat test test/daily_recommendations_test.dart
node scripts/check_hot_search_plugin_contracts.cjs
node scripts/check_mv_plugin_contracts.cjs
```

Rust 插件运行时测试在 Flutter 仓库 `rust` 目录执行：

```sh
cargo test -p baka-plugin-host
```

请使用目标仓库当时存在的测试与工具链；这些命令是维护入口，不表示本次文档任务已执行全部测试。

### 23.4 逐能力验收矩阵

| 模块 | 最低验收场景 |
|---|---|
| 导出/元数据 | 本地导入、重载、禁用、重复平台、版本变更、变量保存后重读 |
| 搜索 | 所有声明类型；首页/第二页/终页/空结果/失败重试；ID 与平台一致 |
| 歌词搜索 | 同平台有 musicItem，跨平台无；无时长；第四参数缺省；词内空格 |
| 热搜 | 字符串/兼容对象；空白与重复；不支持时无假数据 |
| 每日推荐 | 未配置、失效凭据、ready、更新中、过期刷新；账号切换 |
| 音频/下载 | 真实档位、缺失档位、headers、URL 过期、seek、断网；不预下载全曲 |
| 歌曲详情 | 仅 ID 输入、原始 hash 不丢、补全不换身份、音质元数据 |
| 歌词 | rawLrc、翻译、罗马音、逐字、TTML 对唱/背景声、空/错误格式 |
| 专辑/歌单 | 首页元数据、第二页、最后一页；数千首时有界请求/内存 |
| 艺人 | 歌曲/专辑独立页码、独立总数、头像/简介 |
| 榜单 | 排名顺序、TOP500 多页、旧式一次全量与新式明确续页 |
| 推荐 | 固定/分组标签、切换标签重置页码、返回歌单而非歌曲 |
| 评论 | 规范字段、日期、下一页、空列表、嵌套回复的客户端差异 |
| MV | 默认画质、真实可选档位、切换、headers、备用源、下载、实际编码/HDR |
| 分享/单曲导入 | URL/ID、未知输入、HTTP(S) 校验、完整歌曲身份 |
| 歌单导入/同步 | 全量多页、真实空快照、认证失败保留旧数据、顺序/去重/手动添加项 |
| 条件快照 | 初始全量、版本相同、版本变化、错误版本、账号切换、缓存淘汰后全量 |
| 识曲 | 正确 PCM、无匹配、错误采样率、返回可播放候选；不把演示当真识别 |
| Apple HLS | 描述符/上下文校验、播放/seek/下载、401/403/410 单次刷新、一致性失败 |
| LX | 初始化、来源/动作/档位、基础插件身份、选择/取消覆盖、不支持来源 |
| 网络/存储 | 超时、限流、取消、模块缺失、存储配额/坏数据、双端重载 |
| 发布 | 最终脚本摘要、清单相对路径、完整性失败、更新 URL、旧版本拒绝 |

### 23.5 常见问题定位

| 现象 | 优先检查 |
|---|---|
| 能导入但功能按钮不出现 | 导出函数名、客户端白名单、搜索类型声明、歌曲是否有 MV 标记 |
| 总是只有第一页 | 是否误返回 isEnd:true；是否漏 page；后续页是否重复身份；榜单旧式缺省结束 |
| 一直加载重复内容 | 是否忽略页码；平台 cursor 缓存是否按查询/账号隔离 |
| 搜索到歌曲但无法播放 | 是否保留 ID/hash；档位是否真实；媒体 headers 是否与 API headers 分开 |
| 歌词桌面有、移动没有 | 是否只返回 lrc URL；应返回 rawLrc 文本 |
| MV 切换后画质不变 | 是否把 label 当 key；返回 videoQuality 是否实际更新；是否重用了旧 URL |
| 导入成功但数量少 | 是否只取首页；ID 去重/不可用项；worksNum 不是完整性保证 |
| 同步后歌曲丢失 | 是否将网络失败返回成成功空数组；来源归属是否由宿主管理 |
| Node 可运行、手机报错 | 是否依赖完整 npm API、未知 require、原生 ESM、文件系统或硬编码 env |
| 设置改了却仍用旧账号 | 是否在模块顶层缓存了变量；缓存键是否隔离账号 |
| 安装没问题却无法更新 | 是否声明稳定 srcUrl；版本是否提升；两端安装来源策略不同 |

<a id="internal"></a>
## 24. 宿主内部入口与插件接口的分界

### Flutter 内部命令

下列名字在源码里出现，但不是第三方插件应实现的函数：

| 类别 | 内部入口示例 |
|---|---|
| 详情/歌词/分享 | `__musicInfo`、`__lyric`、`__musicShare`、`__playbackMusicInfo`、`__playbackLyric` |
| 导入/音质/MV | `__importMusicSheet`、`__playById`、`__qualityChoices`、`__mvQualityChoices`、`__mvDownloadSource` |
| 推荐/日志 | `__discoveryTags`、`__hostLogs` |
| 同步/云备份/网络 | `__playlistSyncBegin/Commit/Cancel/Plan`、`__cloudBackupCommit`、`__webdav`、`__lxNetwork` |
| 播放/下载 | `__playbackQueue`、`__playbackResolve`、`__audioDownload`、`__mvDownload`、`__downloadPostprocess` |
| 本地/设置 | `__localLibrary`、`__workspace`、`__hpxSettings`、`__startupProfile` |

工作区 permit、播放 token、下载 taskLease 等由宿主取得并校验，插件函数不会因此多出一个通用权限参数。不要要求插件导出这些内部名字或自行构造令牌。

### 桌面内部接口

`PluginManager.callPluginDelegateMethod`、安装/重载/排序/日志方法、`resolveVideoSource`、源回退、歌词解析、代理注册、`MusicSheet.frontend` 都属于应用代码。它们可用于定位宿主行为，不是传给插件的 SDK 对象。

**公开的特殊回调是 `getAppleMusicKey`，不是所有泛型 dispatch 可执行的任意函数。** 判断“某能力已支持”必须找到真实产品调用点。

<a id="sources"></a>
## 25. 源码覆盖索引与维护规则

本次按 2026-11-25 两个仓库的实现核对。下表覆盖公开方法族、运行时、分发和宿主功能边界。桌面路径可直接点击；Flutter 路径相对于独立的 BakaMusicFlutter 仓库，避免把另一个仓库的文件误写为本仓库文件。

| 模块 | 桌面源码 | Flutter 源码（相对 BakaMusicFlutter） |
|---|---|---|
| 方法与媒体类型 | [rpc.ts](../src/shared/plugin-manager/rpc.ts)、[plugin.d.ts](../src/types/plugin.d.ts)、[media.d.ts](../src/types/media.d.ts) | `rust/crates/baka-ffi/src/plugin_call.rs`、`lib/services/plugin_discovery.dart`、`lib/data/model/models.dart` |
| 搜索/歌词搜索 | [方法包装](../src/shared/plugin-manager/main/plugin-methods.ts)、[歌词上下文](../src/shared/plugin-manager/lyric-search.ts) | `lib/features/search/search_page.dart`、`lib/services/plugin_discovery.dart` |
| 热搜/每日推荐 | 无公开方法 | `lib/services/plugin_discovery.dart`、`lib/features/home/home_page.dart` |
| 播放/音质/详情 | [源适配](../src/renderer/core/track-player/plugin-media.ts)、[方法包装](../src/shared/plugin-manager/main/plugin-methods.ts) | `rust/crates/baka-ffi/src/{playback,quality_request,metadata_request}.rs` |
| 歌词 | [歌词包装](../src/shared/plugin-manager/main/plugin-methods.ts)、[解密](../src/shared/plugin-manager/main/lyric-decrypt.ts) | `rust/crates/baka-ffi/src/lyric_request.rs`、`rust/crates/baka-plugin-host/src/shim/js.rs`、`rust/crates/baka-plugin-host/src/lyric_native` |
| 专辑/歌单 | [专辑页](../src/renderer/pages/main-page/views/album-view/hooks/useAlbumDetail.ts)、[歌单页](../src/renderer/pages/main-page/views/music-sheet-view/remote-sheet/hooks/usePluginSheetMusicList.ts) | `lib/features/collections/collection_page.dart`、`lib/services/plugin_discovery.dart` |
| 艺人 | [艺人页](../src/renderer/pages/main-page/views/artist-view/index.tsx)、[作品查询](../src/renderer/pages/main-page/views/artist-view/hooks/useQueryArtist.ts) | `lib/services/plugin_discovery.dart`、`lib/features/collections/collection_page.dart` |
| 榜单/推荐 | [榜单详情](../src/renderer/pages/main-page/views/toplist-detail-view/hooks/useTopListDetail.ts)、[推荐分页](../src/renderer/pages/main-page/views/recommend-sheets-view/hooks/useRecommendSheets.ts) | `lib/services/plugin_discovery.dart`、`rust/crates/baka-ffi/src/discovery.rs` |
| 评论 | [评论面板](../src/renderer/components/Panel/templates/MusicComment/index.tsx)、[方法包装](../src/shared/plugin-manager/main/plugin-methods.ts) | `rust/crates/baka-ffi/src/comment_request.rs`、`lib/features/comments/music_comments_page.dart` |
| MV | [MV 播放器](../src/renderer/components/Modal/templates/MvPlayer/index.tsx)、[视频类型](../src/types/plugin.d.ts) | `rust/crates/baka-ffi/src/video_request.rs`、`lib/features/mv/mv_player_page.dart` |
| 分享/身份 | [方法包装](../src/shared/plugin-manager/main/plugin-methods.ts) | `rust/crates/baka-ffi/src/music_identity.rs` |
| 导入/同步 | [歌单服务](../src/renderer/core/music-sheet/service.ts)、[导入回归](../scripts/import-sheet-sync.test.cjs) | `rust/crates/baka-ffi/src/{music_input,playlist_sync}.rs`、`lib/services/library_service.dart` |
| 识曲 | [录音处理](../src/renderer/utils/song-recognition.ts)、[识曲调用](../src/shared/plugin-manager/main/plugin-methods.ts) | 无产品消费链 |
| Apple HLS/密钥 | 无公开方法 | `rust/crates/baka-ffi/src/{apple_playback,download_source}.rs`、`rust/crates/baka-proxy/src/apple/{mod,prepare,playlist,session}.rs` |
| 运行时/模块/环境 | [utility host](../src/shared/plugin-manager/utility/plugin-host.ts)、[host client](../src/shared/plugin-manager/main/plugin-host-client.ts) | `rust/crates/baka-plugin-host/src/{host,shim/js,shim/http,shim/storage}.rs`、`rust/crates/baka-ffi/src/lib.rs` |
| LX | [事件宿主](../src/shared/plugin-manager/utility/lx-plugin-host.ts)、[适配器](../src/shared/plugin-manager/lx-adapter.ts)、[来源定义](../src/shared/plugin-manager/lx-types.ts) | `rust/crates/baka-plugin-host/src/lx_runtime.js`、`lib/rust/bridge.dart` |
| 安装/清单/更新 | [插件管理](../src/shared/plugin-manager/main/index.ts)、[安装回归](../scripts/plugin-import.test.cjs) | `rust/crates/baka-ffi/src/plugin_source_request.rs`、`lib/rust/bridge.dart` |
| HPX/模型等边界 | 宿主音频功能，不是音源 API | `lib/services/hpx_settings.dart`、`rust/crates/baka-ffi/src/lib.rs`，不开放第三方模型方法 |

维护时先更新真实方法/数据契约和消费链，再同步本指南的能力表、对应章节、跨端差异、模板及验收项。不能只给方法表追加名字而不写参数、返回值、分页、错误和客户端范围。
