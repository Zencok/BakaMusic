# BakaMusic 更新日志

本文件根据 [GitHub Releases](https://github.com/Zencok/BakaMusic/releases) 整理，发布日期采用 GitHub Release 的 UTC 日期，并按版本从新到旧排列。

## [v1.8.4](https://github.com/Zencok/BakaMusic/releases/tag/v1.8.4) - 2026-08-18

- 新增跨平台系统媒体控制：Windows SMTC、macOS MediaPlayer 与 Linux MPRIS2 均可显示曲目信息、封面、播放状态和进度。
- 系统媒体面板可控制播放、暂停、停止、切歌和进度跳转，并与应用内音频及 MV 状态保持同步。
- 更新 Windows、macOS x64/arm64、Linux x64/arm64 的 native 模块与打包冒烟覆盖。

**版本差异：** [v1.8.3...v1.8.4](https://github.com/Zencok/BakaMusic/compare/v1.8.3...v1.8.4)

## [v1.8.3](https://github.com/Zencok/BakaMusic/releases/tag/v1.8.3) - 2026-08-17

- MV 播放器新增独立音量提示，滚轮调节时无需唤出底部控制栏。
- Windows 原生视频表面跟随播放器圆角与窗口尺寸裁剪，修复画面边缘溢出。
- 提升全局提示层级，避免 Toast 被模态框遮挡。

**版本差异：** [v1.8.2...v1.8.3](https://github.com/Zencok/BakaMusic/compare/v1.8.2...v1.8.3)

## [v1.8.2](https://github.com/Zencok/BakaMusic/releases/tag/v1.8.2) - 2026-08-17

- 新增可选的 AMLL 风格播放详情页，与原有经典沉浸式详情页共同提供两套播放界面。
- 新界面采用左侧封面与控制、右侧动态歌词的双栏布局，支持进度、音量、循环、随机和窗口操作。
- 接入基于封面的 AMLL Mesh Gradient 动态背景，并补充 CSP、缓存、回退和响应式适配。

**版本差异：** [v1.8.1...v1.8.2](https://github.com/Zencok/BakaMusic/compare/v1.8.1...v1.8.2)

## [v1.8.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.8.1) - 2026-08-16

- MV 播放从 Chromium `<video>` 迁移至随应用发布的原生 libmpv 宿主，统一远程视频解码、请求头和播放状态。
- 保留清晰度切换、倍速、音量、进度、全屏和下载，并在切换视频或画质时保持位置与播放状态。
- 优化原生视频首帧交接、窗口生命周期和 Acrylic 合成，减少灰屏、闪烁及背景突变。
- WASAPI 独占端点协商失败时自动回退共享输出，改善 Luna、AC-4 等音源启动稳定性。

**版本差异：** [v1.8.0...v1.8.1](https://github.com/Zencok/BakaMusic/compare/v1.8.0...v1.8.1)

## [v1.8.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.8.0) - 2026-08-16

- 新增 LX 音源脚本兼容层，可从本地或 HTTPS 地址导入播放接口，并绑定至现有 BakaMusic 平台插件。
- 重构插件管理工作区，集中展示启用状态、平台覆盖、当前播放接口、LX 音源选择和调用诊断日志。
- 新增听歌识曲，可采集系统音频并通过插件识别，结果支持播放、收藏和加入歌单。
- 新增跨平台 MV 播放与下载界面，支持画质探测、切换、倍速、进度、滚轮音量、键盘操作、全屏和下载管理。
- 推荐歌单、搜索与排行榜在进入详情和返回时保留来源、筛选及滚动位置。
- 修复本地音乐专辑、歌手和文件夹详情中的嵌套列表滚动。

**版本差异：** [v1.7.1...v1.8.0](https://github.com/Zencok/BakaMusic/compare/v1.7.1...v1.8.0)

## [v1.7.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.7.1) - 2026-08-15

- 导入歌单后新增预览页，展示封面、平台、标题、作者、歌曲数量和简介，并可进入标准详情页检查曲目。
- 扩展插件歌单导入协议，在兼容旧歌曲数组返回值的同时支持完整歌单对象。
- 下载后音频探测与转码迁移到原生 N-API 工作线程，并根据 CPU 与内存自适应并发。

**版本差异：** [v1.7.0...v1.7.1](https://github.com/Zencok/BakaMusic/compare/v1.7.0...v1.7.1)

## [v1.7.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.7.0) - 2026-08-14

- 重构推荐歌单和排行榜，统一来源导航、筛选、响应式布局与无障碍交互。
- 推荐歌单会按插件随机选择初始分类，并在详情返回时恢复当前标签与页面状态。
- 简化通过 ID 播放、歌单导入和歌词搜索等插件选择弹窗。
- 下载后转码进入有界异步队列，网络任务不再被音频后处理阻塞。
- 播放栏根据封面生成浅色/深色 OKLCH 配色，并校验文字与强调色对比度。

**版本差异：** [v1.6.1...v1.7.0](https://github.com/Zencok/BakaMusic/compare/v1.6.1...v1.7.0)

## [v1.6.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.6.1) - 2026-08-13

- 歌单备份统一为 v3，保留插件曲目 ID 的数字/字符串类型，避免恢复后逐字歌词失效。
- 修复整行及逐词歌词中的括号双人段、跨行和声、罗马音与翻译配对。
- 新增可选下载后转码：有损音频转 MP3、无损音频转 FLAC，AC-4/AC-3 等环绕声编码保持原文件。
- Electron 升级至 43.4.0，更新 libmpv/LibreMPEG/libplacebo 运行时和全平台 native 预构建。
- 修复 Windows NSIS 并行打包文件锁及运行时下载未读取系统代理的问题。

**版本差异：** [v1.6.0...v1.6.1](https://github.com/Zencok/BakaMusic/compare/v1.6.0...v1.6.1)

## [v1.6.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.6.0) - 2026-08-09

- 歌单备份格式升级至 v3，保留插件曲目 ID 的原始标量类型，并兼容恢复 v2 数据。
- 修复顶部搜索框文字与输入光标被裁切的问题。

**版本差异：** [v1.5.9...v1.6.0](https://github.com/Zencok/BakaMusic/compare/v1.5.9...v1.6.0)

## [v1.5.9](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.9) - 2026-08-02

- 下载标签新增封面兼容模式，将封面规范化为适合车机和硬件播放器的 sRGB JPEG，同时可选择保留原图。
- 修复无歌词歌曲的下载后处理与标签写入。
- 当前输出设备拔出时回退至默认设备，并按设置暂停或继续播放；设备重新接入后恢复用户选择。
- 侧栏分组和歌单加入支持 reduced-motion 的展开/收起动画，并稳定沉浸式全屏调度。

**版本差异：** [v1.5.8...v1.5.9](https://github.com/Zencok/BakaMusic/compare/v1.5.8...v1.5.9)

## [v1.5.8](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.8) - 2026-07-26

- 沉浸式全屏改用幕布阶段编排，隐藏系统全屏切换跳变；全屏歌词舞台进一步弱化界面框架。
- 修复离线曲目重试、缓冲中切换音质、旧 libmpv 会话残留及数字/字符串媒体 ID 混用导致的队列问题。
- 修复 LRC offset 与 TTML 罗马音错位，使主详情、桌面歌词和迷你模式时间轴一致。
- 下载错误按任务限制自动重试，本地大库扫描使用独立长超时，避免中断其他下载任务。
- 修复插件用户变量和窗口位置配置未持久化，并加固插件元数据与结构化克隆负载边界。
- 加固主窗口重建、退出流程与插件宿主异常恢复，优化列表、歌词面板和搜索性能。

**版本差异：** [v1.5.7...v1.5.8](https://github.com/Zencok/BakaMusic/compare/v1.5.7...v1.5.8)

## [v1.5.7](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.7) - 2026-07-24

- 放大播放时间、侧栏文字和图标，并调整侧栏宽度，改善高频操作可读性。
- 支持全局 F11；播放详情使用自底栏展开的过渡，并优化沉浸式全屏动画与窗口拖拽。
- 下载改用原生 TagLib 写入标签，统一插件、歌词、封面和扩展名解析链路。
- 补齐跨平台 TagLib 预构建、清单、安装与回归测试。

**版本差异：** [v1.5.6...v1.5.7](https://github.com/Zencok/BakaMusic/compare/v1.5.6...v1.5.7)

## [v1.5.6](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.6) - 2026-07-23

- Windows 新增 WASAPI 独占模式，并由 libmpv 枚举和切换输出设备。
- 音质体系新增 Dolby、Atmos 等空间音频档位，保留独立 Master 档位。
- 关闭 libmpv 外部文件自动加载，歌词和封面继续由 BakaMusic 统一管理。
- 优化 AMLL 手动滚动，并支持点击歌词行跳转播放位置。

**版本差异：** [v1.5.5...v1.5.6](https://github.com/Zencok/BakaMusic/compare/v1.5.5...v1.5.6)

## [v1.5.5](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.5) - 2026-07-23

- 接入公开发布的 mpv LibreMPEG 运行时，将本地与远程媒体统一迁移至 libmpv 播放链。
- 扩展本地无损格式覆盖至 DSF、DFF 等，并支持独立播放速度、半音级变调和输出设备选择。
- 加固本地扫描、内嵌歌词与封面处理，本地曲目可安全移入回收站。
- 以 AMLL lyric/TTML 包统一远程和本地歌词解析，保留 TTML 元数据、注音、背景人声及对唱信息。
- 支持将关联歌词写入本地媒体，并统一本地库、歌单、下载、统计和主题的宽松搜索。
- 新增 Windows NSIS Web 与 Linux AppImage 发布目标。

**版本差异：** [v1.5.4...v1.5.5](https://github.com/Zencok/BakaMusic/compare/v1.5.4...v1.5.5)

## [v1.5.4](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.4) - 2026-07-23

- 修复 Windows 11 24H2 下 Electron 透明窗口与系统 Acrylic 叠加造成的背景闪烁。
- 优化歌曲列表滚动期间的悬停反馈与合成性能。
- 调整玻璃播放栏进度条边距和时间字号，避免内容贴近圆角并改善可读性。

**版本差异：** [v1.5.3...v1.5.4](https://github.com/Zencok/BakaMusic/compare/v1.5.3...v1.5.4)

## [v1.5.3](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.3) - 2026-07-23

- 虚拟歌曲列表改用固定定位与动画帧调度，改善快速滚动时的错位和重绘。
- 主题初始化改为幂等，路由切换时保留 CSS 和背景 iframe，减少闪白或闪黑。
- 修复关闭播放详情后原生拖拽区域残留导致下层控件无法点击。

**版本差异：** [v1.5.2...v1.5.3](https://github.com/Zencok/BakaMusic/compare/v1.5.2...v1.5.3)

## [v1.5.2](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.2) - 2026-07-23

- 重做品牌化崩溃恢复页，提供重置、反馈和可展开诊断信息。
- 加固歌单备份恢复，兼容缺失标题和数值型插件曲目 ID，并恢复默认收藏歌单标题。
- 歌词解析新增对唱/双人声部识别，桌面歌词支持按声部分侧对齐。
- 修复桌面歌词在特定宽度下异常换行的问题。

**版本差异：** [v1.5.1...v1.5.2](https://github.com/Zencok/BakaMusic/compare/v1.5.1...v1.5.2)

## [v1.5.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.1) - 2026-07-23

- 内置主题在支持的 Windows 11 版本启用系统 Acrylic，其他平台和旧系统保持不透明背景。
- 新增固定悬浮的 Liquid Glass 播放栏，重排封面、控制区、时间线和功能入口，并升级封面取色算法。
- 重做播放队列，保留虚拟列表、拖拽、选择和定位当前歌曲能力。
- 优化播放详情初始化和重复打开性能，修复设置页偏移与顶栏拖拽。
- 恢复本地/WebDAV 歌单备份，完善下载进度和已移动文件的记录清理。

**版本差异：** [v1.5.0...v1.5.1](https://github.com/Zencok/BakaMusic/compare/v1.5.0...v1.5.1)

## [v1.5.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.5.0) - 2026-07-19

- 重构 Electron、React、Forge、IPC、配置、数据库和 utilityProcess 架构，加固 renderer、插件、下载与本地文件边界。
- 修复本地和加密媒体播放，授权文件使用支持 Range 的本地协议，QMC/CENC 等解密链保持流式播放与 seek。
- 完善沉浸式全屏会话：阻止显示器休眠、自动隐藏鼠标，并临时收起桌面歌词和迷你模式。
- 修复歌词恢复、桌面歌词锁定和迷你窗口关闭流程；歌词导出支持逐字、翻译、罗马音和命名模板。
- 下载新增可配置文件名模板；设置页、启动加载壳和系统明暗主题跟随完成重构。
- 列表新增定位当前歌曲；右键菜单支持媒体身份、分享及跳转艺人/专辑。
- 更新检查和 Release 下载支持 GitHub 加速回退，并补充安全、性能、迁移、native 与打包回归。

**版本差异：** [v1.4.0...v1.5.0](https://github.com/Zencok/BakaMusic/compare/v1.4.0...v1.5.0)

## [v1.4.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.4.0) - 2026-07-17

- 播放详情页支持 F11 沉浸式全屏，Windows 无边框窗口在原生全屏失败时可回退铺满当前显示器。
- 统一“通过 ID 播放”和“导入歌单”的插件输入面板，并记忆各入口上次选择的插件。
- 听歌统计新增真实播放时长，列表补充音质、大小和平台信息。
- 主题市场新增搜索，桌面歌词可识别无边框视频全屏并自动让位。
- 优化扁平模式歌单详情的表面、圆角和阴影层级。

**版本差异：** [v1.3.9...v1.4.0](https://github.com/Zencok/BakaMusic/compare/v1.3.9...v1.4.0)

## v1.3.9 - 2026-07-17

- 将 Electron 升级至 43.1.1 Stable，运行时同步升级至 Chromium 150.0.7871.114、Node.js 24.18.0 与 V8 15.0.245.15。
- 播放详情页底栏改为默认保持显示；仍可在设置中开启“进入播放详情页时自动隐藏底栏（悬停显示）”。
- Windows 桌面歌词检测到全屏游戏或全屏应用时会临时降低置顶层级，避免歌词覆盖游戏；退出全屏后恢复原有置顶状态。

## [v1.3.8](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.8) - 2026-07-16

### 歌词核心与动画

- 将内置 AMLL Core 重基线至官方 0.5.2，采用新的歌词分组、时间轴与布局架构，同时保留 BakaMusic 的现有显示与交互能力。
- 优化逐字进度、行切换、弹性滚动、自动换行和中间奏动画；当前行保持清晰，仅对较远歌词应用弱化模糊。
- 统一罗马音位于原文上方、翻译位于原文下方的层级，覆盖逐字匹配和整行回退场景。
- 修复长时间暂停后恢复时歌词短暂跳句，以及 seek 后媒体仍在缓冲时歌词提前前进并回退的问题。

### 迷你模式

- 接入与主歌词一致的 AMLL 播放器和歌词时钟，支持逐字进度、行切换、弹性及淡入淡出动画。
- 支持按设置同时显示原文、罗马音和翻译，并统一左对齐；优化切句过渡和播放状态同步。
- 窗口高度由 92px 调整为 104px，并重新平衡内边距、歌词区域与 68px 封面尺寸。

### 听歌统计

- 将“最近播放”升级为持久化听歌统计，记录总播放次数、不同歌曲数、最近播放、播放排行以及首次和最近播放时间。
- 自动迁移旧版最近播放及次数数据，支持最近/排行切换、歌曲搜索、清空统计和直接播放。
- 修复统计容量和内容溢出问题，并将顶栏指标整合为突出总播放次数的精简横栏。

### 侧边栏与界面

- 侧边栏固定为 220px，并重组为“发现”“音乐库”和个人歌单；玻璃与扁平风格均支持分组展开和收起。
- 导航项支持整行点击、左侧选中标识和键盘操作；插件管理收纳到“发现”标题右侧的图标入口。
- 统一导航文案；尚未保存封面样式偏好的用户，播放详情页默认使用唱片封面，既有偏好保持不变。

**版本差异：** [v1.3.7...v1.3.8](https://github.com/Zencok/BakaMusic/compare/v1.3.7...v1.3.8)

## [v1.3.7](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.7) - 2026-07-14

- 为搜索历史面板提供稳定的不透明明暗表面，并统一玻璃/扁平模式的语义映射，改善深色与半透明主题下的文字可读性。
- 播放详情页、沉浸式播放栏、歌词面板、音量浮层和封面菜单改用客户端私有视觉变量，不再受主题包详情配色影响。
- 继续解析旧主题的 `--theme-detail-*` Token 以维持安装兼容，但客户端不再使用这些值；新增主题契约回归测试。
- 主题商店增加 `gh.xmly.dev` 与 `gh-proxy.org` 加速源，并保留 GitHub Raw 和 jsDelivr 作为后备。

**版本差异：** [v1.3.6...v1.3.7](https://github.com/Zencok/BakaMusic/compare/v1.3.6...v1.3.7)

## [v1.3.6](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.6) - 2026-07-14

### 主题规范 V2

- 主题系统升级为 `bakamusic-theme@2`，使用公开的 `--theme-*` 语义 Token 覆盖页面、卡片、顶栏、侧栏、播放器、列表、面板、表单、弹层、状态色、圆角和滚动条。
- 明确主题只负责视觉，布局、层级、显隐、交互和播放行为由客户端负责；玻璃与扁平风格通过统一语义桥接消费主题色。
- 增加配置、必需 Token 和 CSS 的严格校验及契约测试；内置默认主题同步升级，主题缺失、损坏或不兼容时自动回退。
- 修复本地主题读取、安装更新、远程列表合并、样式级联及新旧安装目录扫描。此版本起旧主题需升级至 V2 规范。

### 下载管理

- 重做“全部/进行中/已下载”页面，任务卡片直接展示等待、下载、暂停和异常状态。
- 支持暂停、继续、失败重试、移除、批量暂停/继续、清除错误、清空任务和搜索。
- 下载器加入 HTTP Range 断点续传；已下载歌曲可打开目录、清空记录，或同时删除记录与本地文件。
- 修复“全部”遗漏活动任务和虚拟列表偏移；按真实完成时间倒序排列，并迁移旧记录的排序信息。

### 播放界面

- 播放详情页改为不透明沉浸式舞台，专辑封面流光、模糊动态背景及浅色光晕继续由客户端管理。
- 玻璃 Minibar 保留封面动态取色，扁平 Minibar 使用稳定主题色。
- 修复详情页底栏自动隐藏后遗留模糊带、透明条或主题霜化的问题，并改善搜索历史、音质选择、歌词、列表、设置和插件界面的主题可读性。

**版本差异：** [v1.3.5...v1.3.6](https://github.com/Zencok/BakaMusic/compare/v1.3.5...v1.3.6)

## [v1.3.5](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.5) - 2026-07-13

### 界面

- 播放详情页新增自动隐藏底栏及底部悬停唤出能力，玻璃和扁平风格均支持；设置页提供对应开关。
- 修复添加到歌单、本地扫描、退出确认、更新提示、二次确认、插件订阅和关于彩蛋等主题化对话框在浅色主题下的文字可读性。

### 稳定性

- 修复歌手页重复渲染后列表空白或持续加载；切换歌手时会正确重新请求。
- 专辑和榜单详情切换时重置页码并隔离请求世代，避免旧数据串入新条目。
- 通过 ID 播放找不到歌曲时正确提示；歌词请求失败不再清空当前歌词；推荐歌单会丢弃过期标签状态。
- 搜索媒体类型变化后重新选择可用插件；完善 Escape 关闭栈，避免详情页抢先响应。
- 修复自动加载更多无法连续翻页、评论失败后缺少重试、评论遮罩范围错误，以及本地扫描和远程主题请求离页后写入过期状态的问题。

**版本差异：** [v1.3.4...v1.3.5](https://github.com/Zencok/BakaMusic/compare/v1.3.4...v1.3.5)

## [v1.3.4](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.4) - 2026-07-13

- 顶栏背景、文字、搜索框、前进后退、窗口按钮和分割线改为跟随当前主题 Token，玻璃和扁平模式不再强制使用深色底或白色图标。
- 移除扁平模式下本地音乐等列表页的冗余外层卡片，只保留工具栏和歌曲列表表面。

**版本差异：** [v1.3.3...v1.3.4](https://github.com/Zencok/BakaMusic/compare/v1.3.3...v1.3.4)

## [v1.3.3](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.3) - 2026-07-13

### 交互与稳定性

- 详情页仅在自身打开且没有音质浮层、模态框、右键菜单或侧栏面板遮挡时响应 Escape，避免一次关闭多层界面。
- 音质解析和确认阶段校验当前歌曲，切歌后丢弃过期结果；评论请求按歌曲隔离世代，避免空白或串入上一首评论。
- 修正歌词搜索分页表达式，并处理歌词菜单中的渲染期状态更新、取消下载误报及菜单关闭后异步回写。
- 卸载底栏加载观察器时主动断开监听；评论按钮支持再次点击关闭。

### 界面与插件

- 共用模态框和侧栏面板改用主题浮动表面，关闭按钮、输入框和列表行统一使用主题 Token。
- 重做通过 ID 播放、导入歌单、歌词搜索和输入确认的插件选择界面。
- 搜索、歌词、ID 播放和歌单导入统一遵循插件管理中的排序，并排除已停用插件。

**版本差异：** [v1.3.2...v1.3.3](https://github.com/Zencok/BakaMusic/compare/v1.3.2...v1.3.3)

## [v1.3.2](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.2) - 2026-07-13

- 新增可在设置中切换的玻璃/扁平双界面风格，扁平模式适配顶栏、侧栏、列表、设置和底栏，并统一表面与圆角 Token。
- 扁平 Minibar 收起时使用主题色表面，展开详情时进入沉浸式透明状态；同步优化进度条、封面和控件对比度。
- 音质选择浮层继续保留玻璃样式，本地音乐视图切换按钮在扁平模式下恢复圆形。
- 修复白色扁平主题中详情页上一曲/下一曲图标不清晰、玻璃模式音质按钮缺少胶囊描边，以及展开详情时文字位置跳动的问题。

**版本差异：** [v1.3.1...v1.3.2](https://github.com/Zencok/BakaMusic/compare/v1.3.1...v1.3.2)

## [v1.3.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.1) - 2026-07-12

- 调整插件管理卡片的视觉层级和间距，使列表更紧凑易读。
- 将排序把手替换为六点 grip 图标，并微调来源徽章、控制区对齐和卡片细节。

**版本差异：** [v1.3.0...v1.3.1](https://github.com/Zencok/BakaMusic/compare/v1.3.0...v1.3.1)

## [v1.3.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.3.0) - 2026-07-12

- 新增插件启用/停用开关并持久化到插件元数据；停用插件会从搜索等能力入口中排除，同时保留重新启用入口。
- 优化插件优先级拖拽换位动画，并在拖到页面上下边缘时自动滚动。
- 插件卡片改为紧凑单行布局，卸载、更新、导入单曲/歌单和用户变量等按钮按列对齐。

**版本差异：** [v1.2.9...v1.3.0](https://github.com/Zencok/BakaMusic/compare/v1.2.9...v1.3.0)

## [v1.2.9](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.9) - 2026-07-07

- 网易云 JSON 歌词行改用独立时间轴，避免末尾无时间戳内容被并入上一句。
- 标准 LRC 改为逐行解析，增强多时间标签、元数据、注释行和混合格式兼容性。
- 混合时间戳解析增加网易云 JSON 行识别，减少特殊来源的歌词错位和缺行。

**版本差异：** [v1.2.8...v1.2.9](https://github.com/Zencok/BakaMusic/compare/v1.2.8...v1.2.9)

## [v1.2.8](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.8) - 2026-07-06

### 歌词解析

- 修复原文、罗马音和翻译时间戳略有差异时的丢行或错配问题。
- 正确识别作词、作曲、编曲等制作信息及其罗马音，不再误占普通歌词或首句罗马音。
- 清理部分来源将原文和翻译合并到一行后产生的重复翻译后缀。

### 本地歌词与插件

- 保留内嵌歌词的多行结构并处理转义换行；sidecar `.lrc`/`.txt` 增加 BOM、UTF-16 和 GB 系编码检测。
- 支持更多逐字格式，包括 YRC/MRC 三参数时间、QRC、行内 `(offset,duration)` 以及相对尖括号时间标签。
- Kuwo 歌词解密移至插件侧，避免主程序重复处理；QRC/XML 和普通插件、本地歌词继续走统一解析流程。

**版本差异：** [v1.2.7...v1.2.8](https://github.com/Zencok/BakaMusic/compare/v1.2.7...v1.2.8)

## [v1.2.7](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.7) - 2026-06-28

- 新增 `luna-proxy` 本地流式解密代理，可边下载边播放 CENC/AES-CTR 加密的 M4A 音频。
- 支持 HTTP Range 和中途 seek，并自动跟随 Luna CDN 的 302 重定向。
- 新增原生 `ence.node` 模块，在 Windows、macOS x64/arm64 和 Linux CI 中按平台构建。
- 插件的 `getMediaSource` 可返回原始加密 URL、32 位十六进制 `cek` 和可选请求头；客户端负责代理注册、分段与 seek。普通音源无需 `cek`，QMC2 音源继续使用 `ekey`。

**版本差异：** [v1.2.6...v1.2.7](https://github.com/Zencok/BakaMusic/compare/v1.2.6...v1.2.7)

## [v1.2.6](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.6) - 2026-06-27

> 升级后需在本地音乐页先清空列表再重新扫描，以便旧曲目获得新的音质等级和文件大小信息。

### 架构与构建

- 升级至 Electron 43 beta、React 19 和 TypeScript 6，并启用更严格的类型检查。
- 更新 GitHub Actions 与 CI 安装流程，移除 Electron 22/Windows x64 Legacy 构建，并修复 TypeScript 6 下 Forge/Webpack 的 `TS5011` 打包问题。

### 本地音乐与歌词

- 本地音乐列表及音质面板新增文件大小和音质徽标；切换音质时直接使用本地文件，避免崩溃。
- 将扫描和配置拆分为独立按钮；扫描改为增量处理新增/删除文件，并取消自动目录监听，改由用户手动重扫以降低内存占用。
- 修复原文、罗马音和翻译并行时间轴被拆成多行，以及三行歌词主/副行识别错误的问题。

### 修复与清理

- 修复启动时未恢复已保存配置、React 19 toast 和 `useRef` 兼容、插件排序持久化及 Headless UI 依赖问题。
- 删除未使用的实验下载器，并统一仓库换行符以减少跨平台无关差异。

**版本差异：** [v1.2.5...v1.2.6](https://github.com/Zencok/BakaMusic/compare/v1.2.5...v1.2.6)

## [v1.2.5](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.5) - 2026-06-19

- 播放详情页默认关闭黑胶唱臂，减少视觉干扰。
- 放大 AMLL 翻译行并突出当前播放行，提高双语歌词辨识度。
- 修复暂停时中间奏未持续参与布局，以及字母下伸部分被裁切的问题。

**版本差异：** [v1.2.4...v1.2.5](https://github.com/Zencok/BakaMusic/compare/v1.2.4...v1.2.5)

## [v1.2.4](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.4) - 2026-06-10

- 统一侧边栏“我的歌单”和“收藏歌单”的折叠标题、箭头状态及操作区布局。
- 将通用加载动画和底部加载状态更新为更轻量的液态玻璃风格。
- 将深色对话框中的“开发者的话”和“检查更新”等链接固定为橙色，避免主题覆盖后对比度不足。

**版本差异：** [v1.2.3...v1.2.4](https://github.com/Zencok/BakaMusic/compare/v1.2.3...v1.2.4)

## [v1.2.3](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.3) - 2026-06-10

- 新增音质选择弹出面板，统一播放栏、下载列表和歌单等位置的音质切换体验。
- 播放详情页新增黑胶唱片封面样式和唱臂设置，可按偏好控制唱臂显示效果。

**版本差异：** [v1.2.2...v1.2.3](https://github.com/Zencok/BakaMusic/compare/v1.2.2...v1.2.3)

## [v1.2.2](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.2) - 2026-06-08

- 修复桌面歌词透明窗口边缘可能出现黑色细线的问题，同时保留窗口缩放能力。
- 逐行歌词仅让当前播放行常亮，其余行固定为 70% 亮度；逐字歌词继续遵循亮度设置。

**版本差异：** [v1.2.1...v1.2.2](https://github.com/Zencok/BakaMusic/compare/v1.2.1...v1.2.2)

## [v1.2.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.1) - 2026-06-07

- 重构主侧边栏的宽度、字号、层级、选中状态和列表间距，改善导航与内容区比例。
- 重做歌单页播放、添加、下载和清空操作区，使用更轻量的玻璃工具栏。
- 排行榜移除外层卡片，以封面为主体并在封面内展示标题。
- 统一热门歌单、搜索专辑/歌单、主题市场和本地主题的封面叠层卡片样式。
- 调整本地音乐手动扫描按钮、侧栏选中条和列表细节，并清理废弃的旧卡片样式分支。

**版本差异：** [v1.2.0...v1.2.1](https://github.com/Zencok/BakaMusic/compare/v1.2.0...v1.2.1)

## [v1.2.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.2.0) - 2026-06-07

### 主要改动

- 重构设置页侧栏、内容区、表单行、快捷键、备份恢复和关于页布局。
- 将 `applemusic-like-lyrics` 核心从 `vendor` 迁移到 `src/amll-core`，清理示例和测试文件并更新构建配置。
- 搜索页新增刷新按钮，可按当前搜索类型和平台重新请求结果。

### 修复与体验

- 为插件“更新订阅”补充加载反馈和完整安装流程。
- 修复长下拉列表滚动后空白、设置下拉框被遮挡，以及自定义排序中新加入歌曲位置不符合当前排序的问题。
- 优化歌曲与本地音乐列表的分割线、悬浮阴影和圆角，并扩大歌词列表、Minibar、下载和播放列表中常用操作的点击热区。
- 简化左上角 Logo 和关于页的项目归属展示，新增 QQ 与 Telegram 社群入口。

**版本差异：** [v1.1.9...v1.2.0](https://github.com/Zencok/BakaMusic/compare/v1.1.9...v1.2.0)

## [v1.1.9](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.9) - 2026-06-07

- 修复迷你模式外层方框和透明窗口边缘细线。
- 重做窗口拖动逻辑，避免拖动时跳动。
- 允许单行歌词显示更多内容，隐藏控制按钮时不再提前截断。
- 改为双击进入主界面，减少拖动或查看歌词时误触打开窗口。

**版本差异：** [v1.1.8...v1.1.9](https://github.com/Zencok/BakaMusic/compare/v1.1.8...v1.1.9)

## [v1.1.8](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.8) - 2026-06-07

- 修复 Release 构建中加密音频无法播放的问题。
- 修复加密代理在打包或安装环境下的启动和加载异常，提高正式版本的代理稳定性。

**版本差异：** [v1.1.7...v1.1.8](https://github.com/Zencok/BakaMusic/compare/v1.1.7...v1.1.8)

## [v1.1.7](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.7) - 2026-06-06

- 全面重构桌面歌词，统一配置、窗口交互和渲染表现。
- 支持拖拽调整桌面歌词窗口尺寸，并修复透明窗口缩放失效。
- 新增歌词亮度调节、恢复默认和“未播放歌词保持白色”选项，弱化翻译与罗马音等副歌词层级。
- 修复深色面板输入框背景、收藏按钮命中范围等界面问题。
- Electron 升级至 42.3.3，更新构建流程并移除 Electron 22 Legacy Windows 构建。

**版本差异：** [v1.1.5...v1.1.7](https://github.com/Zencok/BakaMusic/compare/v1.1.5...v1.1.7)

## [v1.1.5](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.5) - 2026-05-04

- 优化桌面歌词布局和遮罩表现。
- 新增 Vinyl 音质标识并修复相关编码问题。
- 修复音乐列表排序偏好错误沿用到其他列表的问题。
- 调整侧边栏图标与文字间距。

**版本差异：** [v1.1.4...v1.1.5](https://github.com/Zencok/BakaMusic/compare/v1.1.4...v1.1.5)

## [v1.1.4](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.4) - 2026-04-11

- 音乐列表新增自定义排序和拖拽重排，将列排序按钮替换为下拉排序面板。
- 自动更新改用 GitHub Releases API，并通过 Axios 检查更新，修复 Electron 22 中 `net.fetch` 的兼容问题。
- 将预构建 `qmc2.node` 纳入版本管理，降低原生模块漏打包风险。

**版本差异：** [v1.1.3...v1.1.4](https://github.com/Zencok/BakaMusic/compare/v1.1.3...v1.1.4)

## [v1.1.3](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.3) - 2026-03-26

- 下载完成后可写入歌曲元数据、封面和歌词文件。
- 修复 `mflac-proxy` 重启死锁并关闭内存遥测，提高运行稳定性。
- 调整新建歌单的默认排序逻辑，并清理冗余输入框 `focus-within` 样式。

**版本差异：** [v1.1.2...v1.1.3](https://github.com/Zencok/BakaMusic/compare/v1.1.2...v1.1.3)

## [v1.1.2](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.2) - 2026-03-15

- 新建歌单支持设置默认排序。
- 拖动播放进度后立即同步 seek 进度显示。
- 修复订阅输入框聚焦状态的样式不一致。

**版本差异：** [v1.1.1...v1.1.2](https://github.com/Zencok/BakaMusic/compare/v1.1.1...v1.1.2)

## [v1.1.1](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.1) - 2026-03-10

- 修复 macOS 在 v1.1.0 中可能发生的启动崩溃。

**版本差异：** [v1.1.0...v1.1.1](https://github.com/Zencok/BakaMusic/compare/v1.1.0...v1.1.1)

## [v1.1.0](https://github.com/Zencok/BakaMusic/releases/tag/v1.1.0) - 2026-03-10

- 降低原生内存泄漏和进程开销，改善长时间运行稳定性。
- 规范插件返回的歌曲时长，减少播放与展示异常。
- README 增加免责声明和使用条款。

**版本差异：** [v1.0.7...v1.1.0](https://github.com/Zencok/BakaMusic/compare/v1.0.7...v1.1.0)

## [v1.0.7](https://github.com/Zencok/BakaMusic/releases/tag/v1.0.7) - 2026-03-09

- 修复封面加载异常和搜索结果刷新问题。
- 搜索结果页仅挂载当前激活标签，降低渲染开销；同时优化封面、图片加载和本地音乐扫描性能。
- 修复圆角覆盖层显示细节。
- 修复发布工作流、环境变量写入和 YAML 解析问题。

**版本差异：** [v1.0.5...v1.0.7](https://github.com/Zencok/BakaMusic/compare/v1.0.5...v1.0.7)
