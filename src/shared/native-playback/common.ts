export type NativePlaybackState =
    | "none"
    | "buffering"
    | "playing"
    | "paused"
    | "error";

export interface INativePlaybackSnapshot {
    sourceId: string;
    state: NativePlaybackState;
    currentTime: number;
    duration: number;
    volume: number;
    speed: number;
    ended?: boolean;
    error?: string;
}

export type NativePlaybackCommand =
    | {
        operation: "load";
        sourceId: string;
        url: string;
        headers?: Record<string, string>;
    }
    | { operation: "play"; sourceId: string }
    | { operation: "pause"; sourceId: string }
    | { operation: "stop"; sourceId: string }
    | { operation: "seek"; sourceId: string; seconds: number }
    | { operation: "volume"; sourceId: string; volume: number }
    | { operation: "speed"; sourceId: string; speed: number }
    | { operation: "pitch"; sourceId: string; semitones: number }
    | { operation: "loop"; sourceId: string; enabled: boolean }
    | { operation: "output-device"; sourceId: string; deviceId: string };

export type NativePlaybackRuntimeCommand =
    | Exclude<NativePlaybackCommand, { operation: "load" }>
    | {
        operation: "load";
        sourceId: string;
        url: string;
        sourceType: "path" | "location";
        headers?: Record<string, string>;
    };

export interface INativePlaybackCapabilities {
    available: boolean;
    engine: "libmpv";
    version?: string;
    clientApiVersion?: string;
    mediaBackend?: string;
    decoders?: string[];
}
