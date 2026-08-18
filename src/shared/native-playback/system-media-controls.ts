import fs from "fs";
import path from "path";
import type { BrowserWindow } from "electron";
import getResourcePath from "@/common/get-resource-path";
import { RepeatMode } from "@/common/constant";
import logger from "@shared/logger/main";
import type { INativePlaybackSnapshot } from "./common";
import createMprisBinding from "./mpris";

type SystemMediaAction =
    | { action: "play" | "pause" | "stop" | "next" | "previous" | "raise" | "quit" }
    | { action: "seek"; position: number }
    | { action: "volume"; volume: number }
    | { action: "rate"; rate: number }
    | { action: "repeat"; mode: RepeatMode };

export interface ISystemMediaControlsUpdate {
    mediaType: "music" | "video";
    title: string;
    artist: string;
    album: string;
    artwork: string;
    appMediaId: string;
    state: INativePlaybackSnapshot["state"];
    position: number;
    duration: number;
    playbackRate: number;
    volume: number;
    repeatMode: RepeatMode;
    nextEnabled: boolean;
    previousEnabled: boolean;
    updateMetadata: boolean;
}

interface ISystemMediaDescriptor {
    mediaType: "music" | "video";
    title: string;
    artist: string;
    album: string;
    artwork: string;
    appMediaId: string;
    nextEnabled: boolean;
    previousEnabled: boolean;
}

export interface ISystemMediaControlsBinding {
    isSupported: () => boolean;
    initialize: (
        windowHandle: Buffer,
        callback: (event: SystemMediaAction) => void,
    ) => void | Promise<void>;
    update: (value: ISystemMediaControlsUpdate) => void;
    clear: () => void;
    dispose: () => void;
}

function loadNativeBinding(nativePath: string): ISystemMediaControlsBinding {
    const nonWebpackRequire = (
        globalThis as typeof globalThis & {
            __non_webpack_require__?: NodeRequire;
        }
    ).__non_webpack_require__;
    if (typeof nonWebpackRequire === "function") {
        return nonWebpackRequire(nativePath) as ISystemMediaControlsBinding;
    }

    const nativeModule: { exports: ISystemMediaControlsBinding } = {
        exports: {} as ISystemMediaControlsBinding,
    };
    process.dlopen(nativeModule as unknown as NodeModule, nativePath);
    return nativeModule.exports;
}

function boundedText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function resolveArtworkUrl(value: unknown) {
    const artwork = boundedText(value, 32_768);
    if (!artwork) {
        return "";
    }
    try {
        const url = new URL(artwork);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

function mediaIdentity(musicItem: IMusic.IMusicItem | null) {
    return musicItem ? `${musicItem.platform}:${musicItem.id}` : "";
}

class SystemMediaControls {
    private binding: ISystemMediaControlsBinding | null = null;
    private initialized = false;
    private musicItem: IMusic.IMusicItem | null = null;
    private audioSnapshot: INativePlaybackSnapshot | null = null;
    private video: ISystemMediaDescriptor | null = null;
    private videoSnapshot: INativePlaybackSnapshot | null = null;
    private onAction: ((event: SystemMediaAction) => void) | null = null;
    private metadataDirty = true;
    private sessionActive = false;
    private repeatMode = RepeatMode.Queue;
    private bindingGeneration = 0;

    get available() {
        return this.initialized;
    }

    get active() {
        return this.initialized && this.sessionActive;
    }

    attachWindow(
        window: BrowserWindow,
        onAction: (event: SystemMediaAction) => void,
    ) {
        if (!(["win32", "darwin", "linux"] as NodeJS.Platform[]).includes(process.platform)) {
            return;
        }
        this.disposeBinding();
        this.onAction = onAction;
        try {
            const binding = process.platform === "linux"
                ? createMprisBinding()
                : this.loadNativeBinding();
            if (
                typeof binding.isSupported !== "function"
                || typeof binding.initialize !== "function"
                || typeof binding.update !== "function"
                || typeof binding.clear !== "function"
                || typeof binding.dispose !== "function"
                || !binding.isSupported()
            ) {
                throw new Error("System media controls binding does not expose the expected API");
            }
            const generation = this.bindingGeneration;
            this.binding = binding;
            const initialization = binding.initialize(window.getNativeWindowHandle(), (event) => {
                if (
                    !event
                    || typeof event !== "object"
                    || typeof event.action !== "string"
                ) {
                    return;
                }
                if (event.action === "seek") {
                    if (Number.isFinite(event.position) && event.position >= 0) {
                        this.onAction?.({ action: "seek", position: event.position });
                    }
                    return;
                }
                if (event.action === "volume") {
                    if (Number.isFinite(event.volume) && event.volume >= 0 && event.volume <= 1) {
                        this.onAction?.(event);
                    }
                    return;
                }
                if (event.action === "rate") {
                    if (Number.isFinite(event.rate) && event.rate >= 0.25 && event.rate <= 4) {
                        this.onAction?.(event);
                    }
                    return;
                }
                if (event.action === "repeat") {
                    if (Object.values(RepeatMode).includes(event.mode)) {
                        this.onAction?.(event);
                    }
                    return;
                }
                if ([
                    "play",
                    "pause",
                    "stop",
                    "next",
                    "previous",
                    "raise",
                    "quit",
                ].includes(event.action)) {
                    this.onAction?.(event as SystemMediaAction);
                }
            });
            const completeInitialization = () => {
                if (this.binding !== binding || this.bindingGeneration !== generation) {
                    binding.dispose();
                    return;
                }
                this.initialized = true;
                this.metadataDirty = true;
                this.sessionActive = false;
                this.sync();
            };
            if (initialization instanceof Promise) {
                void initialization.then(completeInitialization).catch((error) => {
                    if (this.binding === binding) {
                        this.disposeBinding();
                    }
                    logger.logError(
                        "System media controls initialization failed",
                        error instanceof Error ? error : new Error(String(error)),
                    );
                });
            } else {
                completeInitialization();
            }
        } catch (error) {
            this.disposeBinding();
            logger.logError(
                "System media controls initialization failed",
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    setMusicItem(musicItem: IMusic.IMusicItem | null) {
        const changed = mediaIdentity(this.musicItem) !== mediaIdentity(musicItem);
        this.musicItem = musicItem;
        if (!musicItem) {
            this.audioSnapshot = null;
            if (!this.video) {
                this.metadataDirty = true;
                this.clear();
            }
            return;
        }
        if (changed) {
            this.audioSnapshot = null;
        }
        if (!this.video) {
            this.metadataDirty = true;
            this.sync();
        }
    }

    setPlaybackSnapshot(snapshot: INativePlaybackSnapshot) {
        this.audioSnapshot = snapshot;
        if (!this.video) {
            this.sync();
        }
    }

    setRepeatMode(repeatMode: RepeatMode) {
        this.repeatMode = repeatMode;
        this.sync();
    }

    beginVideo(value: Omit<ISystemMediaDescriptor, "mediaType" | "nextEnabled" | "previousEnabled">) {
        this.video = {
            ...value,
            mediaType: "video",
            nextEnabled: false,
            previousEnabled: false,
        };
        this.videoSnapshot = null;
        this.metadataDirty = true;
        this.sync();
    }

    setVideoPlaybackSnapshot(snapshot: INativePlaybackSnapshot) {
        if (!this.video) {
            return;
        }
        this.videoSnapshot = snapshot;
        this.sync();
    }

    endVideo() {
        if (!this.video) {
            return;
        }
        this.video = null;
        this.videoSnapshot = null;
        this.metadataDirty = true;
        if (this.musicItem) {
            this.sync();
        } else {
            this.clear();
        }
    }

    clear() {
        this.sessionActive = false;
        if (!this.initialized || !this.binding) {
            return;
        }
        try {
            this.binding.clear();
        } catch (error) {
            logger.logError(
                "System media controls clear failed",
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    resetMedia() {
        this.musicItem = null;
        this.audioSnapshot = null;
        this.video = null;
        this.videoSnapshot = null;
        this.metadataDirty = true;
        this.clear();
    }

    dispose() {
        this.resetMedia();
        this.onAction = null;
        this.disposeBinding();
    }

    private sync() {
        const binding = this.binding;
        if (!this.initialized || !binding) {
            return;
        }
        const descriptor = this.video ?? this.getAudioDescriptor();
        if (!descriptor) {
            return;
        }
        const snapshot = this.video ? this.videoSnapshot : this.audioSnapshot;
        try {
            binding.update({
                mediaType: descriptor.mediaType,
                title: boundedText(descriptor.title, 512),
                artist: boundedText(descriptor.artist, 512),
                album: boundedText(descriptor.album, 512),
                artwork: resolveArtworkUrl(descriptor.artwork),
                appMediaId: boundedText(descriptor.appMediaId, 512),
                state: snapshot?.state ?? "buffering",
                position: snapshot?.currentTime ?? 0,
                duration: snapshot?.duration ?? 0,
                playbackRate: snapshot?.speed ?? 1,
                volume: snapshot?.volume ?? 1,
                repeatMode: this.repeatMode,
                nextEnabled: descriptor.nextEnabled,
                previousEnabled: descriptor.previousEnabled,
                updateMetadata: this.metadataDirty,
            });
            this.metadataDirty = false;
            this.sessionActive = true;
        } catch (error) {
            logger.logError(
                "System media controls update failed",
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    private getAudioDescriptor(): ISystemMediaDescriptor | null {
        const musicItem = this.musicItem;
        if (!musicItem) {
            return null;
        }
        const platform = boundedText(musicItem.platform, 128);
        const id = boundedText(`${musicItem.id ?? ""}`, 256);
        return {
            mediaType: "music",
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album ?? "",
            artwork: musicItem.artwork ?? musicItem.coverImg ?? "",
            appMediaId: `${platform}:${id}`.slice(0, 512),
            nextEnabled: true,
            previousEnabled: true,
        };
    }

    private loadNativeBinding() {
        const nativePath = getResourcePath(path.join(".service", "native", "smtc.node"));
        if (!fs.existsSync(nativePath)) {
            throw new Error(`System media controls module not found at ${nativePath}`);
        }
        return loadNativeBinding(nativePath);
    }

    private disposeBinding() {
        this.bindingGeneration += 1;
        if (this.binding) {
            try {
                this.binding.dispose();
            } catch {
                // The window or COM apartment may already be shutting down.
            }
        }
        this.binding = null;
        this.initialized = false;
        this.metadataDirty = true;
        this.sessionActive = false;
    }
}

export type { SystemMediaAction };
export default new SystemMediaControls();
