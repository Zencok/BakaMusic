import { PlayerState } from "@/common/constant";
import type { IAudioController } from "@/types/audio-controller";
import dlna from "@shared/dlna/renderer";
import type { DlnaCommand, DlnaDevice } from "@shared/dlna/common";
import { ErrorReason } from "../enum";
import ControllerBase from "./controller-base";
import i18next from "i18next";

export default class DlnaAudioController extends ControllerBase implements IAudioController {
    public hasSource = false;
    public musicItem: IMusic.IMusicItem | null = null;
    private state = PlayerState.None;
    private sourceId = "";
    private ready: Promise<unknown> = Promise.resolve();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private volume = 1;
    private wasPlaying = false;
    private destroyed = false;
    private failures = 0;
    private lastPosition = 0;
    private lastDuration = 0;
    private volumeAvailable: boolean;

    constructor(private device: DlnaDevice) {
        super();
        this.volumeAvailable = device.volumeSupported;
    }

    get playerState() {
        return this.state;
    }

    set playerState(value: PlayerState) {
        if (value !== this.state) {
            this.state = value;
            navigator.mediaSession.playbackState = value === PlayerState.Playing ? "playing"
                : value === PlayerState.None ? "none" : "paused";
            this.onPlayerStateChanged?.(value);
        }
    }

    private isCurrent(sourceId: string) {
        return !this.destroyed && this.sourceId === sourceId && this.hasSource;
    }

    private report(error: unknown, sourceId: string) {
        if (this.isCurrent(sourceId)) {
            this.hasSource = false;
            this.playerState = PlayerState.Paused;
            void dlna.command({ operation: "stop", sourceId }).catch(() => undefined);
            const message = error instanceof Error ? error.message : String(error);
            const key = message.includes("DLNA_SOURCE_HEADERS_UNSUPPORTED") ? "dlna.source_headers"
                : message.includes("DLNA_SOURCE_LOCAL_PROXY_UNSUPPORTED") ? "dlna.source_proxy" : "dlna.playback_error";
            this.onError?.(ErrorReason.UnsupportedResource, new Error(i18next.t(key)));
        }
    }

    setTrackSource(source: IMusic.IMusicSource, musicItem: IMusic.IMusicItem) {
        this.reset();
        const sourceId = crypto.randomUUID();
        this.sourceId = sourceId;
        this.musicItem = musicItem;
        this.hasSource = true;
        this.wasPlaying = false;
        this.failures = 0;
        this.lastPosition = 0;
        this.lastDuration = musicItem.duration ?? 0;
        this.playerState = PlayerState.Buffering;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title, artist: musicItem.artist, album: musicItem.album,
        });
        this.ready = dlna.command({ operation: "load", request: {
            deviceId: this.device.id, sourceId, url: source.url ?? "",
            title: musicItem.title, artist: musicItem.artist ?? "", album: musicItem.album ?? "",
            headers: source.headers, userAgent: source.userAgent,
        } }).then(async () => {
            if (this.isCurrent(sourceId)) {
                if (this.volumeAvailable) {
                    await dlna.command({ operation: "volume", sourceId, value: this.volume }).catch(() => {
                        this.volumeAvailable = false;
                    });
                }
                this.schedulePoll(sourceId);
            }
        });
        void this.ready.catch((error) => this.report(error, sourceId));
    }

    private dispatch(command: DlnaCommand) {
        const sourceId = this.sourceId;
        void this.ready.then(async () => {
            if (this.isCurrent(sourceId)) {
                await dlna.command(command);
            }
        }).catch((error) => {
            if (!this.isCurrent(sourceId)) {
                return;
            }
            if (command.operation === "volume" || command.operation === "seek") {
                if (command.operation === "volume") {
                    this.volumeAvailable = false;
                }
                this.onError?.(ErrorReason.UnsupportedResource, new Error(i18next.t(
                    command.operation === "volume" ? "dlna.volume_error" : "dlna.seek_error",
                )));
            } else {
                this.report(error, sourceId);
            }
        });
    }

    private schedulePoll(sourceId: string) {
        if (!this.isCurrent(sourceId)) {
            return;
        }
        this.timer = setTimeout(() => {
            void this.poll(sourceId);
        }, 1000);
    }

    private async poll(sourceId: string) {
        try {
            const snapshot = await dlna.command({ operation: "status", sourceId });
            if (!this.isCurrent(sourceId)) {
                return;
            }
            if (!snapshot) {
                throw new Error("DLNA session is unavailable");
            }
            this.failures = 0;
            const duration = snapshot.duration || this.musicItem?.duration || 0;
            this.onProgressUpdate?.({ currentTime: snapshot.currentTime, duration });
            if (snapshot.state === "PLAYING") {
                this.wasPlaying = true;
                this.lastPosition = snapshot.currentTime;
                this.lastDuration = duration;
                this.playerState = PlayerState.Playing;
            } else if (snapshot.state === "PAUSED_PLAYBACK") {
                this.playerState = PlayerState.Paused;
            } else if (snapshot.state === "TRANSITIONING") {
                this.playerState = PlayerState.Buffering;
            } else if (snapshot.state === "STOPPED" || snapshot.state === "NO_MEDIA_PRESENT") {
                this.playerState = PlayerState.Paused;
                if (this.wasPlaying && this.lastDuration > 0
                    && Math.max(this.lastPosition, snapshot.currentTime) >= this.lastDuration - 2) {
                    this.wasPlaying = false;
                    this.onEnded?.();
                }
            }
        } catch (error) {
            this.failures += 1;
            if (this.failures >= 3) {
                this.report(error, sourceId);
            }
        }
        this.schedulePoll(sourceId);
    }

    play() {
        if (this.hasSource) {
            this.playerState = PlayerState.Buffering;
            this.dispatch({ operation: "play", sourceId: this.sourceId });
        }
    }

    pause() {
        if (this.hasSource) {
            this.playerState = PlayerState.Paused;
            this.dispatch({ operation: "pause", sourceId: this.sourceId });
        }
    }

    seekTo(seconds: number) {
        if (this.hasSource && Number.isFinite(seconds)) {
            this.dispatch({ operation: "seek", sourceId: this.sourceId, value: Math.max(0, seconds) });
        }
    }

    setVolume(volume: number) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.hasSource && this.volumeAvailable) {
            this.dispatch({ operation: "volume", sourceId: this.sourceId, value: this.volume });
        }
        this.onVolumeChange?.(this.volume);
    }

    setSpeed(_speed: number) {
        this.onSpeedChange?.(1);
    }

    setPitch(_semitones: number) {
        this.onPitchChange?.(0);
    }

    setLoop(_isLoop: boolean) {
        return;
    }

    async setSinkId(_deviceId: string) {
        return;
    }

    async suspendForVideo() {
        this.pause();
    }

    async disconnect() {
        const sourceId = this.sourceId;
        this.reset(false);
        if (sourceId) {
            await dlna.command({ operation: "stop", sourceId }).catch(() => undefined);
        }
    }

    reset(stop = true) {
        const sourceId = this.sourceId;
        this.sourceId = "";
        this.hasSource = false;
        this.wasPlaying = false;
        this.musicItem = null;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.playerState = PlayerState.None;
        if (stop && sourceId) {
            void dlna.command({ operation: "stop", sourceId }).catch(() => undefined);
        }
    }

    destroy() {
        this.reset();
        this.destroyed = true;
    }
}
