import albumImg from "@/assets/imgs/album-cover.jpg";
import { PlayerState } from "@/common/constant";
import { LOCAL_MEDIA_PROTOCOL } from "@shared/local-media/common";
import nativePlayback from "@shared/native-playback/renderer";
import type { INativePlaybackSnapshot } from "@shared/native-playback/common";
import logger from "@shared/logger/renderer";
import { getManagedMediaProxyServiceName } from "@shared/service-manager/common";
import type { IAudioController } from "@/types/audio-controller";
import { ErrorReason } from "../enum";
import AudioController from "./audio-controller";
import ControllerBase from "./controller-base";

type ActiveEngine = "browser" | "libmpv" | null;

class DualAudioController extends ControllerBase implements IAudioController {
    private readonly browserController = new AudioController();
    private readonly removeSnapshotListener: () => void;
    private activeEngine: ActiveEngine = null;
    private sourceGeneration = 0;
    private sourceId = "";
    private sourceAssigned = false;
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
        this.bindBrowserEvents();
        this.removeSnapshotListener = nativePlayback.onSnapshot(
            (snapshot) => this.handleNativeSnapshot(snapshot),
        );
    }

    private bindBrowserEvents() {
        this.browserController.onPlayerStateChanged = (state) => {
            if (this.activeEngine === "browser") {
                this.playerState = state;
            }
        };
        this.browserController.onProgressUpdate = (progress) => {
            if (this.activeEngine === "browser") {
                this.onProgressUpdate?.(progress);
            }
        };
        this.browserController.onError = (type, error) => {
            if (this.activeEngine === "browser") {
                this.onError?.(type, error);
            }
        };
        this.browserController.onEnded = () => {
            if (this.activeEngine === "browser") {
                this.onEnded?.();
            }
        };
        this.browserController.onVolumeChange = (volume) => {
            if (this.activeEngine === "browser") {
                this.volume = volume;
                this.onVolumeChange?.(volume);
            }
        };
        this.browserController.onSpeedChange = (speed) => {
            if (this.activeEngine === "browser") {
                this.speed = speed;
                this.onSpeedChange?.(speed);
            }
        };
        this.browserController.onPitchChange = (semitones) => {
            if (this.activeEngine === "browser") {
                this.pitch = semitones;
                this.onPitchChange?.(semitones);
            }
        };
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

    private classifyNativeCandidate(url: string) {
        try {
            if (new URL(url).protocol === `${LOCAL_MEDIA_PROTOCOL}:`) {
                return "local" as const;
            }
            if (getManagedMediaProxyServiceName(url)) {
                return "managed-proxy" as const;
            }
            return null;
        } catch {
            return null;
        }
    }

    private async stopNativeSource(sourceId: string) {
        if (!sourceId) {
            return;
        }
        await nativePlayback.command({ operation: "stop", sourceId });
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

    private async activateBrowser(
        trackSource: IMusic.IMusicSource,
        musicItem: IMusic.IMusicItem,
        generation: number,
        sourceId: string,
    ) {
        if (!this.isCurrentSource(generation, sourceId)) {
            return;
        }
        this.activeEngine = "browser";
        this.browserController.setVolume(this.volume);
        this.browserController.setSpeed(this.speed);
        this.browserController.setLoop(this.loop);
        this.browserController.setPitch(this.pitch);
        this.browserController.setTrackSource(trackSource, musicItem);
        if (this.pendingSeek !== null) {
            this.browserController.seekTo(this.pendingSeek);
            this.pendingSeek = null;
        }
        if (this.playRequested) {
            this.browserController.play();
        }
    }

    private async activateNative(
        trackSource: IMusic.IMusicSource & { url: string },
        generation: number,
        sourceId: string,
    ) {
        if (!this.isCurrentSource(generation, sourceId)) {
            return;
        }
        await this.runNativeCommand({
            operation: "load",
            sourceId,
            url: trackSource.url,
        });
        if (!this.isCurrentSource(generation, sourceId)) {
            return;
        }
        this.activeEngine = "libmpv";
        await this.runNativeCommand({ operation: "volume", sourceId, volume: this.volume });
        await this.runNativeCommand({ operation: "speed", sourceId, speed: this.speed });
        await this.runNativeCommand({ operation: "loop", sourceId, enabled: this.loop });
        if (this.sinkId) {
            await this.runNativeCommand({
                operation: "output-device",
                sourceId,
                deviceId: this.sinkId,
            });
        }
        if (this.pitch !== 0) {
            this.pitch = 0;
            this.onPitchChange?.(0);
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
        if (
            this.activeEngine !== "libmpv"
            || snapshot.sourceId !== this.sourceId
        ) {
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
        this.activeEngine = null;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = { ...musicItem };
        this.browserController.prepareTrack(musicItem);
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
        this.activeEngine = null;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = { ...musicItem };
        this.browserController.prepareTrack(musicItem);
        this.updateMediaSession(musicItem);
        void this.stopNativeSource(oldSourceId).catch(() => undefined);

        const nativeCandidate = this.classifyNativeCandidate(trackSource.url);
        if (!nativeCandidate) {
            void this.activateBrowser(trackSource, musicItem, generation, sourceId);
            return;
        }

        this.playerState = PlayerState.Buffering;
        const playableTrackSource = trackSource as IMusic.IMusicSource & { url: string };
        void nativePlayback.probe(trackSource.url).then(
            async (probe) => {
                if (!this.isCurrentSource(generation, sourceId)) {
                    return;
                }
                if (probe.engine === "libmpv") {
                    await this.activateNative(playableTrackSource, generation, sourceId);
                } else {
                    await this.activateBrowser(trackSource, musicItem, generation, sourceId);
                }
            },
            async (error) => {
                if (!this.isCurrentSource(generation, sourceId)) {
                    return;
                }
                if (nativeCandidate === "managed-proxy") {
                    logger.logInfo("managed media probe fell back to libmpv playback", error);
                    await this.activateNative(playableTrackSource, generation, sourceId);
                } else {
                    logger.logInfo("native media probe fell back to browser playback", error);
                    await this.activateBrowser(trackSource, musicItem, generation, sourceId);
                }
            },
        ).catch((error) => {
            if (this.isCurrentSource(generation, sourceId)) {
                this.onError?.(ErrorReason.EmptyResource, error);
            }
        });
    }

    play() {
        this.playRequested = true;
        if (this.activeEngine === "browser") {
            this.browserController.play();
        } else if (this.activeEngine === "libmpv") {
            this.playerState = PlayerState.Buffering;
            void this.runNativeCommand({
                operation: "play",
                sourceId: this.sourceId,
            }).catch(() => undefined);
        } else if (this.sourceAssigned) {
            this.playerState = PlayerState.Buffering;
        }
    }

    pause() {
        this.playRequested = false;
        if (this.activeEngine === "browser") {
            this.browserController.pause();
        } else if (this.activeEngine === "libmpv") {
            void this.runNativeCommand({
                operation: "pause",
                sourceId: this.sourceId,
            }).catch(() => undefined);
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
        if (this.activeEngine === "browser") {
            this.browserController.seekTo(normalized);
        } else if (this.activeEngine === "libmpv") {
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
        if (this.activeEngine === "browser") {
            this.browserController.setVolume(this.volume);
        } else {
            if (this.activeEngine === "libmpv") {
                void this.runNativeCommand({
                    operation: "volume",
                    sourceId: this.sourceId,
                    volume: this.volume,
                }).catch(() => undefined);
            }
            this.onVolumeChange?.(this.volume);
        }
    }

    setSpeed(speed: number) {
        this.speed = speed;
        if (this.activeEngine === "browser") {
            this.browserController.setSpeed(speed);
        } else {
            if (this.activeEngine === "libmpv") {
                void this.runNativeCommand({
                    operation: "speed",
                    sourceId: this.sourceId,
                    speed,
                }).catch(() => undefined);
            }
            this.onSpeedChange?.(speed);
        }
    }

    setPitch(semitones: number) {
        this.pitch = semitones;
        if (this.activeEngine === "browser") {
            this.browserController.setPitch(semitones);
        } else if (this.activeEngine === "libmpv") {
            this.pitch = 0;
            this.onPitchChange?.(0);
        } else {
            this.onPitchChange?.(semitones);
        }
    }

    setLoop(isLoop: boolean) {
        this.loop = isLoop;
        this.browserController.setLoop(isLoop);
        if (this.activeEngine === "libmpv") {
            void this.runNativeCommand({
                operation: "loop",
                sourceId: this.sourceId,
                enabled: isLoop,
            }).catch(() => undefined);
        }
    }

    async setSinkId(deviceId: string) {
        this.sinkId = deviceId;
        await this.browserController.setSinkId(deviceId);
        if (this.activeEngine === "libmpv") {
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
        this.activeEngine = null;
        this.playRequested = false;
        this.pendingSeek = null;
        this.musicItem = null;
        this.browserController.reset();
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
        this.browserController.destroy();
    }
}

export default DualAudioController;
