export const pluginMethodNames = [
    "search",
    "getMediaSource",
    "getMusicInfo",
    "getLyric",
    "getAlbumInfo",
    "getMusicSheetInfo",
    "getArtistWorks",
    "getArtistInfo",
    "importMusicSheet",
    "importMusicItem",
    "getTopLists",
    "getTopListDetail",
    "getRecommendSheetTags",
    "getRecommendSheetsByTag",
    "getMusicComments",
    "getMusicDetailPageUrl",
    "recognize",
] as const;

export type PluginMethodName = (typeof pluginMethodNames)[number];

/**
 * platform 和用户变量 key 会被用作普通对象的属性名；
 * 原型链保留键会污染 Object.prototype 或命中继承访问器，必须拒绝。
 */
const reservedObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isReservedObjectKey(key: string) {
    return reservedObjectKeys.has(key);
}

export interface PluginExecutionEnvironment {
    os: NodeJS.Platform;
    appVersion: string;
    lang: string | null | undefined;
    userVariables: Record<string, string>;
    proxyUrl?: string;
}

export interface PluginHostDescriptor {
    hash: string;
    metadata: Record<string, unknown>;
    supportedMethods: PluginMethodName[];
}

export type PluginHostOperation = "load" | "invoke" | "unload" | "clear";

export interface PluginHostRequest {
    type: "request";
    requestId: string;
    operation: PluginHostOperation;
    payload: unknown;
}

export interface PluginHostResponse {
    type: "response";
    requestId: string;
    result?: unknown;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

export interface PluginHostCallbackRequest {
    type: "host-request";
    requestId: string;
    operation: "cookies.get" | "cookies.set" | "cookies.flush";
    payload: unknown;
}

export interface PluginHostCallbackResponse {
    type: "host-response";
    requestId: string;
    result?: unknown;
    error?: string;
}
