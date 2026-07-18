export const pluginMethodNames = [
    "search",
    "getMediaSource",
    "getMusicInfo",
    "getLyric",
    "getAlbumInfo",
    "getMusicSheetInfo",
    "getArtistWorks",
    "importMusicSheet",
    "importMusicItem",
    "getTopLists",
    "getTopListDetail",
    "getRecommendSheetTags",
    "getRecommendSheetsByTag",
    "getMusicComments",
] as const;

export type PluginMethodName = (typeof pluginMethodNames)[number];

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
