export type PlaybackEngine = "browser" | "libmpv";

export type NativePlaybackState =
    | "none"
    | "buffering"
    | "playing"
    | "paused"
    | "error";

export interface INativeMediaStream {
    index: number;
    type: "audio" | "video" | "subtitle" | "other";
    codec: string;
    profile?: string;
    channels?: number;
    channelLayout?: string;
    sampleRate?: number;
    width?: number;
    height?: number;
    pixelFormat?: string;
}

export interface INativeMediaProbe {
    engine: PlaybackEngine;
    nativeRuntimeAvailable: boolean;
    format: string[];
    duration?: number;
    bitRate?: number;
    streams: INativeMediaStream[];
    reason: "browser-default" | "native-codec" | "multichannel" | "runtime-missing";
}

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
    | { operation: "load"; sourceId: string; url: string }
    | { operation: "play"; sourceId: string }
    | { operation: "pause"; sourceId: string }
    | { operation: "stop"; sourceId: string }
    | { operation: "seek"; sourceId: string; seconds: number }
    | { operation: "volume"; sourceId: string; volume: number }
    | { operation: "speed"; sourceId: string; speed: number }
    | { operation: "loop"; sourceId: string; enabled: boolean }
    | { operation: "output-device"; sourceId: string; deviceId: string };

export type NativePlaybackRuntimeCommand =
    | Exclude<NativePlaybackCommand, { operation: "load" }>
    | {
        operation: "load";
        sourceId: string;
        url: string;
        sourceType: "path" | "location";
    };

export interface INativePlaybackCapabilities {
    available: boolean;
    engine: "libmpv";
    version?: string;
    clientApiVersion?: string;
    mediaBackend?: string;
    decoders?: string[];
}

const nativeAudioCodecs = new Set([
    "ac3",
    "ac4",
    "alac",
    "dca",
    "dts",
    "dts_hd",
    "eac3",
    "mlp",
    "truehd",
]);

export function shouldUseNativePlayback(streams: INativeMediaStream[]) {
    const audioStreams = streams.filter((stream) => stream.type === "audio");
    if (audioStreams.some((stream) => nativeAudioCodecs.has(stream.codec))) {
        return "native-codec" as const;
    }
    if (audioStreams.some((stream) => (stream.channels ?? 0) > 2)) {
        return "multichannel" as const;
    }
    return null;
}
