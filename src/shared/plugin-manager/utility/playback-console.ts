import { AsyncLocalStorage } from "async_hooks";
import { inspect } from "util";
import type {
    PluginPlaybackLogEvent,
    PluginPlaybackLogKind,
    PluginPlaybackLogLevel,
} from "../playback-log";

type PlaybackConsoleLevel = Extract<
    PluginPlaybackLogLevel,
    "debug" | "log" | "info" | "warn" | "error" | "group" | "groupEnd"
>;

export interface PlaybackLogContext {
    callId: string;
    kind: PluginPlaybackLogKind;
    pluginHash: string;
    pluginName: string;
    platform: string;
    quality?: string;
    attempt?: number;
}

type PlaybackLogEmitter = (event: PluginPlaybackLogEvent) => void;

const playbackContext = new AsyncLocalStorage<PlaybackLogContext>();
let playbackCallCounter = 0;

function formatConsoleValue(value: unknown) {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }
    return inspect(value, {
        breakLength: 120,
        colors: false,
        compact: 2,
        depth: 4,
        getters: false,
        maxArrayLength: 50,
        maxStringLength: 2048,
    });
}

function formatConsoleArgs(args: unknown[]) {
    return args.map(formatConsoleValue).join(" ").slice(0, 8192);
}

export function createPlaybackCallId(prefix: string) {
    playbackCallCounter = (playbackCallCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `${prefix}-${Date.now()}-${playbackCallCounter}`.slice(0, 128);
}

export function emitPlaybackLifecycle(
    emit: PlaybackLogEmitter,
    context: PlaybackLogContext,
    phase: "request" | "success" | "error",
    options: { durationMs?: number; message?: string } = {},
) {
    emit({
        type: "playback-log",
        ...context,
        timestamp: Date.now(),
        level: phase === "error" ? "error" : "info",
        phase,
        durationMs: options.durationMs,
        message: options.message?.slice(0, 8192),
    });
}

export function getPlaybackErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 4096);
}

export function runWithPlaybackLog<T>(
    context: PlaybackLogContext,
    action: () => T,
) {
    return playbackContext.run(context, action);
}

export function createPlaybackConsole(emit: PlaybackLogEmitter): Console {
    const methods = new Map<PropertyKey, (...args: unknown[]) => void>();
    const levels = new Set<PlaybackConsoleLevel>([
        "debug",
        "log",
        "info",
        "warn",
        "error",
        "group",
        "groupEnd",
    ]);
    return new Proxy(console, {
        get(target, property, receiver) {
            if (!levels.has(property as PlaybackConsoleLevel)) {
                const value = Reflect.get(target, property, receiver) as unknown;
                return typeof value === "function" ? value.bind(target) : value;
            }
            const existing = methods.get(property);
            if (existing) {
                return existing;
            }
            const level = property as PlaybackConsoleLevel;
            const method = (...args: unknown[]) => {
                const nativeMethod = target[level] as (...values: unknown[]) => void;
                nativeMethod.apply(target, args);
                const context = playbackContext.getStore();
                if (!context) {
                    return;
                }
                emit({
                    type: "playback-log",
                    ...context,
                    timestamp: Date.now(),
                    level,
                    phase: "console",
                    message: formatConsoleArgs(args),
                });
            };
            methods.set(property, method);
            return method;
        },
    });
}
