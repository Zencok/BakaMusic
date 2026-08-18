export type NativePlaybackState =
    | "none"
    | "buffering"
    | "playing"
    | "paused"
    | "error";

/**
 * Why an `error` snapshot happened.
 * `audio-device` means the output endpoint went away (unplugged headphones,
 * disabled device); the media itself is still fine and must not be skipped.
 */
export type NativePlaybackErrorKind = "playback" | "audio-device";

export interface INativePlaybackSnapshot {
    sourceId: string;
    state: NativePlaybackState;
    currentTime: number;
    duration: number;
    volume: number;
    speed: number;
    ended?: boolean;
    error?: string;
    /** Only meaningful when `state` is `error`. Defaults to `playback`. */
    errorKind?: NativePlaybackErrorKind;
    /** One-shot: an audio output device disappeared since the previous snapshot. */
    audioDeviceRemoved?: boolean;
    /** One-shot: an audio output device appeared since the previous snapshot. */
    audioDeviceAdded?: boolean;
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
    | { operation: "output-device"; sourceId: string; deviceId: string }
    /** Windows WASAPI exclusive mode via mpv audio-exclusive */
    | { operation: "audio-exclusive"; sourceId: string; enabled: boolean };

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
    systemMediaControls?: boolean;
    systemMediaControlsActive?: boolean;
    version?: string;
    clientApiVersion?: string;
    mediaBackend?: string;
    decoders?: string[];
}

/** Entry from mpv `audio-device-list` (name is the value for `audio-device`). */
export interface INativeAudioOutputDevice {
    /** mpv device id, e.g. `auto` or `wasapi/{guid}` */
    id: string;
    description: string;
}

export interface INativeVideoSource {
    key: string;
    label: string;
    url: string;
    backupUrls?: string[];
    headers?: Record<string, string>;
    width?: number;
    height?: number;
    dynamicRange?: IPlugin.VideoDynamicRange;
}

export interface INativeVideoSurfaceBounds {
    /** CSS-pixel offset from the main BrowserWindow content area. */
    x: number;
    y: number;
    width: number;
    height: number;
    borderRadius: number;
}

export interface INativeVideoSurfaceUpdate {
    sourceId: string;
    bounds: INativeVideoSurfaceBounds;
    visible: boolean;
}

export type NativeVideoCommand =
    | { operation: "play"; sourceId: string }
    | { operation: "pause"; sourceId: string }
    | { operation: "seek"; sourceId: string; seconds: number }
    | { operation: "volume"; sourceId: string; volume: number }
    | { operation: "speed"; sourceId: string; speed: number };

export interface INativeVideoSourceSelect {
    sourceId: string;
    sourceKey: string;
}

export interface INativeVideoOpenRequest {
    sourceId: string;
    title: string;
    artist: string;
    album: string;
    artwork: string;
    appMediaId: string;
    sources: INativeVideoSource[];
    initialSourceKey: string;
    volume: number;
    surface: Omit<INativeVideoSurfaceUpdate, "sourceId">;
}

export interface INativeVideoSourcesUpdate {
    sourceId: string;
    sources: INativeVideoSource[];
}

export interface INativeVideoEvent {
    sourceId: string;
    type: "closed" | "error" | "snapshot";
    error?: string;
    snapshot?: INativePlaybackSnapshot;
}
