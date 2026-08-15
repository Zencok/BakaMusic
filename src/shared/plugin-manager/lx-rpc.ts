import type {
    LxPluginDescriptor,
    LxScriptInfo,
    LxSource,
} from "./lx-types";
import type { PluginExecutionEnvironment } from "./rpc";
import type { PluginPlaybackLogEvent } from "./playback-log";

export interface LxPluginHostLoadPayload {
    hash: string;
    code: string;
    scriptInfo: LxScriptInfo;
    environment: PluginExecutionEnvironment;
}

export interface LxPluginHostInvokePayload {
    hash: string;
    source: LxSource;
    quality: IMusic.IQualityKey;
    musicInfo: Record<string, unknown>;
    environment: PluginExecutionEnvironment;
    pluginName: string;
    platform: string;
    attempt: number;
}

export type LxPluginHostOperation = "load" | "invoke" | "unload" | "clear";

export interface LxPluginHostRequest {
    type: "request";
    requestId: string;
    operation: LxPluginHostOperation;
    payload: unknown;
}

export interface LxPluginHostResponse {
    type: "response";
    requestId: string;
    result?: unknown;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

export interface LxPluginHostUpdateAlert {
    type: "lx-update-alert";
    hash: string;
    log?: string;
    updateUrl?: string;
}

export type LxPluginHostMessage =
    | LxPluginHostResponse
    | PluginPlaybackLogEvent
    | LxPluginHostUpdateAlert;

export type LxPluginHostDescriptor = Omit<LxPluginDescriptor, "path" | "active" | "sourceUrl">;
