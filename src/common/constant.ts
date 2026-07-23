import { IAppConfig } from "@/types/app-config";
import { ICommand } from "@shared/message-bus/type";

export const internalDataKey = "$";
// 加入播放列表/歌单的时间
export const timeStampSymbol = Symbol.for("time-stamp");
// 加入播放列表的辅助顺序
export const sortIndexSymbol = Symbol.for("sort-index");
/**
 * 歌曲引用次数
 * TODO: 没必要算引用 如果真有需要直接取异或就可以了
 */
export const musicRefSymbol = "$$ref";

export const localPluginName = "本地";
export const localPluginHash = "本地";

export const supportedMediaType = [
    "music",
    "album",
    "artist",
    "sheet",
] as const;

export const rem = 13;

export enum MusicSheetSortType {
    None = "None",
    Title = "title",
    Artist = "artist",
    Album = "album",
    Newest = "time",
    Oldest = "time-rev",
}

export enum RequestStateCode {
    /** 空闲 */
    IDLE = 0b00000000,
    PENDING_FIRST_PAGE = 0b00000010,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    LOADING = 0b00000010,
    /** 检索中 */
    PENDING_REST_PAGE = 0b00000011,
    /** 部分结束 */
    PARTLY_DONE = 0b00000100,
    /** 全部结束 */
    FINISHED = 0b0001000,
    /** 出错了 */
    ERROR = 0b10000000,
}

/** 音质列表（从低到高；空间音频档从 Dolby 开始） */
export const qualityKeys: IMusic.IQualityKey[] = [
    "mgg",
    "128k",
    "192k",
    "320k",
    "flac",
    "flac24bit",
    "hires",
    "vinyl",
    "dolby",
    "atmos",
    "atmos_plus",
    "master",
];

/** 音质显示文本 */
export const qualityText: Record<IMusic.IQualityKey, string> = {
    "mgg": "低音质 MGG",
    "128k": "普通音质 128K",
    "192k": "中等音质 192K",
    "320k": "高清音质 320K",
    "flac": "高清音质 FLAC",
    "flac24bit": "无损音质 FLAC Hires",
    "hires": "无损音质 Hires",
    "vinyl": "无损音质 Vinyl",
    "dolby": "空间音频 Dolby",
    "atmos": "空间音频 Atmos",
    "atmos_plus": "空间音频 Atmos 2.0",
    "master": "无损音质 Master",
};

export const supportLocalMediaType = [
    ".3g2",
    ".3ga",
    ".3gp",
    ".669",
    ".8svx",
    ".aa",
    ".aac",
    ".acc",
    ".ac3",
    ".ac4",
    ".act",
    ".adts",
    ".adx",
    ".aif",
    ".aifc",
    ".aiff",
    ".alac",
    ".amf",
    ".amr",
    ".ams",
    ".ape",
    ".ast",
    ".au",
    ".brstm",
    ".caf",
    ".dbm",
    ".dff",
    ".dmf",
    ".dsf",
    ".dsm",
    ".dts",
    ".dtshd",
    ".eac3",
    ".ec3",
    ".f4a",
    ".f4b",
    ".far",
    ".flac",
    ".gdm",
    ".genh",
    ".gsm",
    ".imf",
    ".it",
    ".j2b",
    ".m2ts",
    ".mts",
    ".m4a",
    ".m4b",
    ".m4r",
    ".m4s",
    ".mdl",
    ".med",
    ".mka",
    ".mkv",
    ".mlp",
    ".mo3",
    ".mod",
    ".mov",
    ".mp1",
    ".mp2",
    ".mp3",
    ".mp4",
    ".mpa",
    ".mpc",
    ".mt2",
    ".mtm",
    ".oga",
    ".ogg",
    ".okt",
    ".oma",
    ".opus",
    ".psm",
    ".ptm",
    ".ra",
    ".ram",
    ".rf64",
    ".s3m",
    ".shn",
    ".spx",
    ".stm",
    ".tak",
    ".thd",
    ".truehd",
    ".ts",
    ".tta",
    ".ult",
    ".umx",
    ".vgm",
    ".vgz",
    ".voc",
    ".wav",
    ".wave",
    ".weba",
    ".webm",
    ".wma",
    ".wv",
    ".xm",
    ".xwma",
];

export const toastDuration = {
    short: 1000,
    long: 2500,
};

export const defaultFont = {
    fullName: "默认",
    family: "",
    postscriptName: "",
    style: "",
};

type IShortCutKeys = keyof NonNullable<IAppConfig["shortCut.shortcuts"]>;
export const shortCutKeys: IShortCutKeys[] = [
    "play/pause",
    "skip-next",
    "skip-previous",
    "volume-up",
    "volume-down",
    "toggle-desktop-lyric",
    "like/dislike",
    "toggle-main-window-visible",
];

// 快捷键列表对应的指令
export const shortCutKeysCommands: Record<IShortCutKeys, keyof ICommand> =
    {
        "play/pause": "TogglePlayerState",
        "skip-next": "SkipToNext",
        "skip-previous": "SkipToPrevious",
        "volume-down": "VolumeDown",
        "volume-up": "VolumeUp",
        "toggle-desktop-lyric": "ToggleDesktopLyric",
        "like/dislike": "ToggleFavorite",
        "toggle-main-window-visible": "ToggleMainWindowVisible",
    };

// 主进程的Resource
export enum ResourceName {
    SKIP_LEFT_ICON = "skip-left.png",
    SKIP_RIGHT_ICON = "skip-right.png",
    PAUSE_ICON = "pause.png",
    PLAY_ICON = "play.png",
    DEFAULT_ALBUM_COVER_IMAGE = "album-cover.jpeg",
    LOGO_IMAGE = "logo.png",

}

/** 下载状态 */
export enum DownloadState {
    /** 空闲状态 */
    NONE = "NONE",
    /** 排队等待中 */
    WAITING = "WAITING",
    /** 下载中 */
    DOWNLOADING = "DOWNLOADING",
    /** 已暂停 */
    PAUSED = "PAUSED",
    /** 失败 */
    ERROR = "ERROR",
    /** 下载完成 */
    DONE = "DONE",
}

// GitHub 加速前缀由主题商店、更新检查和 Release 下载共同复用。
export const githubAcceleratorPrefixes = [
    "https://gh.xmly.dev/",
    "https://gh-proxy.org/",
] as const;

const themePackStoreDirectUrl =
    "https://raw.githubusercontent.com/Toskysun/BakaThemePacks/v2/prod/";

// 主题市场源：BakaThemePacks v2/prod（bakamusic-theme@2 产物根目录）
// 目录约定：publish.json、themes/*.mftheme、previews/*
export const themePackStoreBaseUrl = [
    ...githubAcceleratorPrefixes.map((prefix) => `${prefix}${themePackStoreDirectUrl}`),
    themePackStoreDirectUrl,
    "https://cdn.jsdelivr.net/gh/Toskysun/BakaThemePacks@v2%2Fprod/",
];

const appLatestReleaseApiUrl =
    "https://api.github.com/repos/Zencok/BakaMusic/releases/latest";
const appLatestReleasePageUrl =
    "https://github.com/Zencok/BakaMusic/releases/latest";

// GitHub API 端点：与主题商店一致，优先并行尝试加速前缀。
export const appUpdateApiSources = [
    ...githubAcceleratorPrefixes.map((prefix) => `${prefix}${appLatestReleaseApiUrl}`),
    "https://api.gitmirror.com/repos/Zencok/BakaMusic/releases/latest",
    appLatestReleaseApiUrl,
];

// API 受共享限流时，从 latest 页的重定向位置解析版本并按稳定产物名下载。
export const appUpdateLatestPageSources = [
    ...githubAcceleratorPrefixes.map((prefix) => `${prefix}${appLatestReleasePageUrl}`),
    appLatestReleasePageUrl,
];

// GitHub 下载加速镜像前缀（空字符串表示直连）
export const githubDownloadMirrors = [
    ...githubAcceleratorPrefixes,
    "",
];

/** 播放器状态 */
export enum PlayerState {
    /** 无音频 */
    None,
    /** 播放中 */
    Playing,
    /** 暂停 */
    Paused,
    /** 缓冲中 */
    Buffering,
}

/** 播放器仍保持播放意图，包括等待缓冲的状态。 */
export function isPlaybackActive(state?: PlayerState) {
    return state === PlayerState.Playing || state === PlayerState.Buffering;
}

/** 播放模式 */
export enum RepeatMode {
    /** 随机 */
    Shuffle = "shuffle",
    /** 播放队列 */
    Queue = "queue-repeat",
    /** 单曲循环 */
    Loop = "loop",
}

export const CommonConst = {
    /** 新建歌单名称长度限制 */
    NEW_SHEET_NAME_LENGTH_LIMIT: 120,
};
