import albumImg from "@/assets/imgs/album-cover.jpg";
import { PlayerState } from "@/common/constant";
import { fsUtil } from "@shared/utils/renderer";
import nativePlayback from "@shared/native-playback/renderer";
import type { INativePlaybackSnapshot } from "@shared/native-playback/common";
import logger from "@shared/logger/renderer";
import type { IAudioController } from "@/types/audio-controller";
import { normalizePitchSemitones } from "./pitch-shifter";
import { ErrorReason } from "../enum";
import ControllerBase from "./controller-base";

class LibmpvAudioController extends ControllerBase implements IAudioController {
    private readonly removeSnapshotListener: () => void;
    private sourceGeneration = 0;
    private sourceId = "";
    private sourceAssigned = false;
    private sourceLoaded = false;
    private destroyed = false;
    private playRequested = false;
    private pendingSeek: number | null = null;
    private volume = 1;
    private speed = 1;
    private pitch = 0;
    private loop = false;
    private sinkId = "";
    private _playerState = PlayerState.None;

    public musicItem: IMusic.IMusicItem | null = null;

    get hasSource() {
        return this.sourceAssigned;
    }

    get playerState() {
        return this._playerState;
    }

    set playerState(value: PlayerState) {
        if (value !== this._playerState) {
            this._playerState = value;
            this.onPlayerStateChanged?.(value);
        }
    }

    constructor() {
        super();
        this.removeSnapshotListener = nativePlayback.onSnapshot(
            (snapshot) => this.handleNativeSnapshot(snapshot),
        );
    }

    private updateMediaSession(musicItem: IMusic.IMusicItem) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            artwork: [{
                src: musicItem.coverImg ?? musicItem.artwork ?? albumImg,
            }],
        });
    }

    private isCurrentSource(generation: number, sourceId: string) {
        return !this.destroyed
            && generation === this.sourceGeneration
            && sourceId === this.sourceId;
    }

    private async stopNativeSource(sourceId: string) {
        if (sourceId) {
            await nativePlayback.command({ operation: "stop", sourceId });
        }
    }

    private runNativeCommand(
        command: Parameters<typeof nativePlayback.command>[0],
        reportError = true,
    ) {
        return nativePlayback.command(command).catch((error) => {
            if (reportError && command.sourceId === this.sourceId) {
                logger.logError("libmpv playback command failed", error);
                this.onError?.(ErrorReason.EmptyResource, error);
            }
            throw error;
        });
    }

    private normalizeSourceUrl(url: string) {
        return url.startsWith("file:") ? fsUtil.addFileScheme(url) : url;
    }

    private normalizeHeaders(trackSource: IMusic.IMusicSource) {
        const headers = { ...(trackSource.headers ?? {}) };
        if (trackSource.userAgent) {
            const existingName = Object.keys(headers).find(
                (name) => name.toLocaleLowerCase("en-US") === "user-agent",
            );
            headers[existingName ?? "user-agent"] = trackSource.userAgent;
        }
        return Object.keys(headers).length ? headers : undefined;
    }

    private async activateNative(
        trackSource: IMusic.IMusicSource,
        generation: number,
        sourceId: string,
    ) {
        if (!this.isCurrentSource(generation, sourceId)) {
            return;
        }
        const url = this.normalizeSourceUrl(trackSource.url as string);
        await this.runNativeCommand({
            operation: "load",
            sourceId,
            url,
            headers: this.normalizeHeaders(trackSource),
        });
        if (!this.isCurrentSource(generation, sourceId)) {
            return;
        }
        this.sourceLoaded = true;
        await this.runNativeCommand({ operation: "volume", sourceId, volume: this.volume });
        await this.runNativeCommand({ operation: "speed", sourceId, speed: this.speed });
        await this.runNativeCommand({ operation: "loop", sourceId, enabled: this.loop });
        if (this.pitch !== 0) {
            try {
                await this.runNativeCommand({
                    operation: "pitch",
                    sourceId,
                    semitones: this.pitch,
                }, false);
            } catch (error) {
                logger.logInfo("libmpv pitch filter is unavailable", error);
                this.pitch = 0;
                this.onPitchChange?.(0);
            }
        }
        if (this.sinkId) {
            await this.runNativeCommand({
                operation: "output-device",
                sourceId,
                deviceId: this.sinkId,
            });
        }
        if (this.pendingSeek !== null) {
            await this.runNativeCommand({
                operation: "seek",
                sourceId,
                seconds: this.pendingSeek,
            });
            this.pendingSeek = null;
        }
        if (this.playRequested) {
            await this.runNativeCommand({ operation: "play", sourceId });
        } else {
            this.playerState = PlayerState.Paused;
        }
    }

    private handleNativeSnapshot(snapshot: INativePlaybackSnapshot) {
        if (!this.sourceAssigned || snapshot.sourceId !== this.sourceId) {
            return;
        }
        switch (snapshot.state) {
            case "none":
                this.playerState = PlayerState.None;
                navigator.mediaSession.playbackState = "none";
                break;
            case "buffering":
                this.playerState = PlayerState.Buffering;
                break;
            case "playing":
                this.playerState = PlayerState.Playing;
                navigator.mediaSession.playbackState = "playing";
                break;
            case "paused":
                this.playerState = PlayerState.Paused;
                navigator.mediaSession.playbackState = "paused";
                break;
            case "error":
                this.playerState = PlayerState.Paused;
                navigator.mediaSession.playbackState = "paused";
                this.onError?.(
                    ErrorReason.EmptyResource,
                    new Error(snapshot.error ?? "libmpv playback error"),
                );
                return;
        }
        if (snapshot.duration > 0 || snapshot.currentTime > 0) {
            this.onProgressUpdate?.({
                currentTime: snapshot.currentTime,
                duration: snapshot.duration || Infinity,
            });
        }
        if (snapshot.ended) {
            this.playRequested = false;
            this.onEnded?.();
        }
    }

    prepareTrack(musicItem: IMusic.IMusicItem) {
        const oldSourceId = this.sourceId;
        this.sourceGeneration += 1;
        this.sourceId = "";
        this.sourceAssigned = false;
        this.sourceLoaded = false;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = { ...musicItem };
        this.updateMediaSession(musicItem);
        this.playerState = PlayerState.None;
        void this.stopNativeSource(oldSourceId).catch((error) => {
            logger.logInfo("stale libmpv source cleanup finished with an error", error);
        });
    }

    setTrackSource(trackSource: IMusic.IMusicSource, musicItem: IMusic.IMusicItem) {
        if (!trackSource.url) {
            this.onError?.(ErrorReason.EmptyResource, new Error("mediaSource.url is empty"));
            return;
        }
        const oldSourceId = this.sourceId;
        const generation = ++this.sourceGeneration;
        const sourceId = `track-${generation}-${Date.now()}`;
        this.sourceId = sourceId;
        this.sourceAssigned = true;
        this.sourceLoaded = false;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = { ...musicItem };
        this.updateMediaSession(musicItem);
        void this.stopNativeSource(oldSourceId).catch(() => undefined);
        this.playerState = PlayerState.Buffering;
        void this.activateNative(trackSource, generation, sourceId).catch(() => {
            if (this.isCurrentSource(generation, sourceId)) {
                this.sourceLoaded = false;
                this.playerState = PlayerState.Paused;
            }
        });
    }

    play() {
        this.playRequested = true;
        if (this.sourceLoaded) {
            this.playerState = PlayerState.Buffering;
            void this.runNativeCommand({ operation: "play", sourceId: this.sourceId }).catch(() => undefined);
        } else if (this.sourceAssigned) {
            this.playerState = PlayerState.Buffering;
        }
    }

    pause() {
        this.playRequested = false;
        if (this.sourceLoaded) {
            void this.runNativeCommand({ operation: "pause", sourceId: this.sourceId }).catch(() => undefined);
            this.playerState = PlayerState.Paused;
        } else if (this.sourceAssigned) {
            this.playerState = PlayerState.Paused;
        }
    }

    seekTo(seconds: number) {
        if (!this.sourceAssigned || !Number.isFinite(seconds)) {
            return;
        }
        const normalized = Math.max(0, seconds);
        if (this.sourceLoaded) {
            void this.runNativeCommand({
                operation: "seek",
                sourceId: this.sourceId,
                seconds: normalized,
            }).catch(() => undefined);
        } else {
            this.pendingSeek = normalized;
        }
    }

    setVolume(volume: number) {
        this.volume = Math.min(1, Math.max(0, volume));
        if (this.sourceLoaded) {
            void this.runNativeCommand({
                operation: "volume",
                sourceId: this.sourceId,
                volume: this.volume,
            }).catch(() => undefined);
        }
        this.onVolumeChange?.(this.volume);
    }

    setSpeed(speed: number) {
        this.speed = speed;
        if (this.sourceLoaded) {
            void this.runNativeCommand({
                operation: "speed",
                sourceId: this.sourceId,
                speed,
            }).catch(() => undefined);
        }
        this.onSpeedChange?.(speed);
    }

    setPitch(semitones: number) {
        this.pitch = normalizePitchSemitones(semitones);
        this.onPitchChange?.(this.pitch);
        if (!this.sourceLoaded) {
            return;
        }
        void this.runNativeCommand({
            operation: "pitch",
            sourceId: this.sourceId,
            semitones: this.pitch,
        }, false).catch((error) => {
            logger.logInfo("libmpv pitch filter is unavailable", error);
            this.pitch = 0;
            this.onPitchChange?.(0);
        });
    }

    setLoop(isLoop: boolean) {
        this.loop = isLoop;
        if (this.sourceLoaded) {
            void this.runNativeCommand({
                operation: "loop",
                sourceId: this.sourceId,
                enabled: isLoop,
            }).catch(() => undefined);
        }
    }

    async setSinkId(deviceId: string) {
        this.sinkId = deviceId;
        if (this.sourceLoaded) {
            await this.runNativeCommand({
                operation: "output-device",
                sourceId: this.sourceId,
                deviceId,
            });
        }
    }

    reset() {
        const oldSourceId = this.sourceId;
        this.sourceGeneration += 1;
        this.sourceId = "";
        this.sourceAssigned = false;
        this.sourceLoaded = false;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = null;
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
        this.playerState = PlayerState.None;
        void this.stopNativeSource(oldSourceId).catch(() => undefined);
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.removeSnapshotListener();
        this.reset();
    }
}

export default LibmpvAudioController;
