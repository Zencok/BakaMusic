/**
 * 播放音乐
 */
import { encodeUrlHeaders } from "@/common/normalize-util";
import albumImg from "@/assets/imgs/album-cover.jpg";
import getUrlExt from "@/renderer/utils/get-url-ext";
import Hls, { Events as HlsEvents, HlsConfig } from "hls.js";
import { isSameMedia } from "@/common/media-util";
import { PlayerState } from "@/common/constant";
import ServiceManager from "@shared/service-manager/renderer";
import ControllerBase from "@renderer/core/track-player/controller/controller-base";
import { ErrorReason } from "@renderer/core/track-player/enum";
import Dexie from "dexie";
import voidCallback from "@/common/void-callback";
import { IAudioController } from "@/types/audio-controller";
import Promise = Dexie.Promise;


class AudioController extends ControllerBase implements IAudioController {
    private audio: HTMLAudioElement;
    private hls: Hls;
    private currentObjectUrl: string | null = null;
    private sourceAbortController: AbortController | null = null;

    private _playerState: PlayerState = PlayerState.None;
    get playerState() {
        return this._playerState;
    }
    set playerState(value: PlayerState) {
        if (this._playerState !== value) {
            this.onPlayerStateChanged?.(value);
        }
        this._playerState = value;

    }

    public musicItem: IMusic.IMusicItem | null = null;

    get hasSource() {
        return !!this.audio.src;
    }

    constructor() {
        super();
        this.audio = new Audio();
        this.audio.preload = "metadata";
        this.audio.controls = false;

        ////// events
        this.audio.onplaying = () => {
            this.playerState = PlayerState.Playing;
            navigator.mediaSession.playbackState = "playing";
        };

        this.audio.onpause = () => {
            this.playerState = PlayerState.Paused;
            navigator.mediaSession.playbackState = "paused";
        };

        this.audio.onerror = (event) => {
            this.playerState = PlayerState.Paused;
            navigator.mediaSession.playbackState = "paused";
            this.onError?.(ErrorReason.EmptyResource, event as any);
        };

        this.audio.ontimeupdate = () => {
            this.onProgressUpdate?.({
                currentTime: this.audio.currentTime,
                duration: this.audio.duration, // 缓冲中是Infinity
            });
        };

        // this.audio.onseeking = () => {
        //     this.playerState = PlayerState.Buffering;
        // }
        //
        // this.audio.onseeked = () => {
        //     this.playerState = PlayerState.Playing;
        // }

        this.audio.onended = () => {
            this.playerState = PlayerState.Paused;
            this.onEnded?.();
        };

        this.audio.onvolumechange = () => {
            this.onVolumeChange?.(this.audio.volume);
        };

        this.audio.onratechange = () => {
            this.onSpeedChange?.(this.audio.playbackRate);
        };


        // @ts-ignore  isDev
        window.ad = this.audio;
    }

    private initHls(config?: Partial<HlsConfig>) {
        if (!this.hls) {
            this.hls = new Hls(config);
            this.hls.attachMedia(this.audio);
            this.hls.on(HlsEvents.ERROR, (evt, error) => {
                this.onError(ErrorReason.EmptyResource, error);
            });
        }
    }

    private destroyHls() {
        if (this.hls) {
            this.hls.detachMedia();
            this.hls.off(HlsEvents.ERROR);
            this.hls.destroy();
            this.hls = null;
        }
    }

    private revokeCurrentObjectUrl() {
        if (!this.currentObjectUrl) {
            return;
        }

        URL.revokeObjectURL(this.currentObjectUrl);
        this.currentObjectUrl = null;
    }

    private abortPendingSourceRequest() {
        if (!this.sourceAbortController) {
            return;
        }

        this.sourceAbortController.abort();
        this.sourceAbortController = null;
    }

    private clearTrackSource() {
        this.abortPendingSourceRequest();
        this.revokeCurrentObjectUrl();
        this.destroyHls();
        this.audio.pause();
        this.audio.src = "";
        this.audio.removeAttribute("src");
        this.audio.load();
    }

    destroy(): void {
        this.reset();
    }

    pause(): void {
        if (this.hasSource) {
            this.audio.pause();
        }
    }

    play(): void {
        if (this.hasSource) {
            this.audio.play().catch(voidCallback);
        }
    }

    reset(): void {
        this.playerState = PlayerState.None;
        this.clearTrackSource();
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
    }

    seekTo(seconds: number): void {
        if (this.hasSource && isFinite(seconds)) {
            const duration = this.audio.duration;
            this.audio.currentTime = Math.min(
                seconds,
                isNaN(duration) ? Infinity : duration,
            );
        }
    }

    setLoop(isLoop: boolean): void {
        this.audio.loop = isLoop;
    }

    setSinkId(deviceId: string): Promise<void> {
        return (this.audio as any).setSinkId(deviceId);
    }

    setSpeed(speed: number): void {
        this.audio.defaultPlaybackRate = speed;
        this.audio.playbackRate = speed;
    }

    prepareTrack(musicItem: IMusic.IMusicItem) {
        this.musicItem = { ...musicItem };

        // 1. update metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            artwork: [
                {
                    src: musicItem.coverImg ?? musicItem.artwork ?? albumImg,
                },
            ],
        });

        // 2. reset track
        this.playerState = PlayerState.None;
        this.clearTrackSource();
        navigator.mediaSession.playbackState = "none";
    }

    setTrackSource(trackSource: IMusic.IMusicSource, musicItem: IMusic.IMusicItem): void {
        this.musicItem = { ...musicItem };
        this.abortPendingSourceRequest();
        this.revokeCurrentObjectUrl();

        // 1. update metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
            artwork: [
                {
                    src: musicItem.coverImg ?? musicItem.artwork ?? albumImg,
                },
            ],
        });


        // 2. convert url and headers
        let url = trackSource.url;
        const urlObj = new URL(trackSource.url);
        let headers: Record<string, any> | null = null;

        // 2.1 convert user agent
        if (trackSource.headers || trackSource.userAgent) {
            headers = { ...(trackSource.headers ?? {}) };
            if (trackSource.userAgent) {
                headers["user-agent"] = trackSource.userAgent;
            }
        }

        // 2.2 convert auth header
        if (urlObj.username && urlObj.password) {
            const authHeader = `Basic ${btoa(
                `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
                    urlObj.password,
                )}`,
            )}`;
            urlObj.username = "";
            urlObj.password = "";
            headers = {
                ...(headers || {}),
                Authorization: authHeader,
            };
            url = urlObj.toString();
        }

        // 2.3 hack url with headers
        if (headers) {
            const forwardedUrl = ServiceManager.RequestForwarderService.forwardRequest(url, "GET", headers);
            if (forwardedUrl) {
                url = forwardedUrl;
                headers = null;
            } else if (!headers["Authorization"]) {
                url = encodeUrlHeaders(url, headers);
                headers = null;
            }
        }

        if (!url) {
            this.onError(ErrorReason.EmptyResource, new Error("url is empty"));
            return;
        }

        // 3. set real source
        if (getUrlExt(trackSource.url) === ".m3u8") {
            if (Hls.isSupported()) {
                this.initHls();
                this.hls.loadSource(url);
            } else {
                this.onError(ErrorReason.UnsupportedResource);
                return;
            }
        } else if (headers) {
            this.destroyHls();
            this.sourceAbortController = new AbortController();
            fetch(url, {
                method: "GET",
                headers: {
                    ...trackSource.headers,
                },
                signal: this.sourceAbortController.signal,
            })
                .then(async (res) => {
                    const blob = await res.blob();
                    if (isSameMedia(this.musicItem, musicItem)) {
                        this.revokeCurrentObjectUrl();
                        this.currentObjectUrl = URL.createObjectURL(blob);
                        this.audio.src = this.currentObjectUrl;
                    }
                    this.sourceAbortController = null;
                })
                .catch((error) => {
                    if (error?.name === "AbortError") {
                        return;
                    }

                    this.onError?.(ErrorReason.EmptyResource, error);
                    this.sourceAbortController = null;
                });
        } else {
            this.destroyHls();
            this.audio.src = url;
        }
    }

    setVolume(volume: number): void {
        this.audio.volume = volume;
    }
}

export default AudioController;
