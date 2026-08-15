export const PLUGIN_PLAYBACK_LOG_LIMIT = 500;

export const pluginPlaybackLogLevels = [
    "debug",
    "log",
    "info",
    "warn",
    "error",
    "group",
    "groupEnd",
] as const;

export type PluginPlaybackLogLevel = (typeof pluginPlaybackLogLevels)[number];
export type PluginPlaybackLogKind = "plugin" | "lx";
export type PluginPlaybackLogPhase = "request" | "console" | "success" | "error";

export interface PluginPlaybackLogEvent {
    type: "playback-log";
    callId: string;
    timestamp: number;
    kind: PluginPlaybackLogKind;
    pluginHash: string;
    pluginName: string;
    platform: string;
    level: PluginPlaybackLogLevel;
    phase: PluginPlaybackLogPhase;
    message?: string;
    durationMs?: number;
    quality?: string;
    attempt?: number;
}

export interface PluginPlaybackLogEntry extends Omit<PluginPlaybackLogEvent, "type"> {
    id: string;
}

const levelSet = new Set<string>(pluginPlaybackLogLevels);
const kindSet = new Set<string>(["plugin", "lx"]);
const phaseSet = new Set<string>(["request", "console", "success", "error"]);

function isBoundedString(value: unknown, maxLength: number) {
    return typeof value === "string" && value.length <= maxLength;
}

export function isPluginPlaybackLogEvent(value: unknown): value is PluginPlaybackLogEvent {
    if (!value || typeof value !== "object") {
        return false;
    }
    const event = value as Partial<PluginPlaybackLogEvent>;
    return event.type === "playback-log"
        && isBoundedString(event.callId, 128)
        && typeof event.timestamp === "number"
        && Number.isFinite(event.timestamp)
        && kindSet.has(String(event.kind))
        && isBoundedString(event.pluginHash, 64)
        && isBoundedString(event.pluginName, 256)
        && isBoundedString(event.platform, 128)
        && levelSet.has(String(event.level))
        && phaseSet.has(String(event.phase))
        && (event.message === undefined || isBoundedString(event.message, 8192))
        && (event.durationMs === undefined
            || (typeof event.durationMs === "number"
                && Number.isFinite(event.durationMs)
                && event.durationMs >= 0))
        && (event.quality === undefined || isBoundedString(event.quality, 64))
        && (event.attempt === undefined
            || (typeof event.attempt === "number"
                && Number.isInteger(event.attempt)
                && event.attempt >= 1
                && event.attempt <= 10));
}

export function isPluginPlaybackLogEntry(value: unknown): value is PluginPlaybackLogEntry {
    if (!value || typeof value !== "object") {
        return false;
    }
    const entry = value as Partial<PluginPlaybackLogEntry>;
    return isBoundedString(entry.id, 160)
        && isPluginPlaybackLogEvent({ ...entry, type: "playback-log" });
}
