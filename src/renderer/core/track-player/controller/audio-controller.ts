/**
 * 播放音乐
 */
import { encodeUrlHeaders } from "@/common/normalize-util";
import albumImg from "@/assets/imgs/album-cover.jpg";
import getUrlExt from "@/renderer/utils/get-url-ext";
import { PlayerState } from "@/common/constant";
import ServiceManager from "@shared/service-manager/renderer";
import { fsUtil } from "@shared/utils/renderer";
import ControllerBase from "@renderer/core/track-player/controller/controller-base";
import { ErrorReason } from "@renderer/core/track-player/enum";
import voidCallback from "@/common/void-callback";
import { IAudioController } from "@/types/audio-controller";
import logger from "@shared/logger/renderer";
import {
    classifyHlsError,
    IHlsRecoveryState,
} from "../hls-error-policy";
import {
    normalizePitchSemitones,
    PITCH_SHIFTER_PARAMETER_NAME,
    PITCH_SHIFTER_PROCESSOR_NAME,
} from "./pitch-shifter";

interface ISinkSelectableAudioContext extends AudioContext {
    setSinkId?: (sinkId: string) => Promise<void>;
}


class AudioController extends ControllerBase implements IAudioController {
    private audio: HTMLAudioElement;
    private hls: import("hls.js").default | null = null;
    private sourceGeneration = 0;
    private sourceAbortController: AbortController | null = null;
    private playRequested = false;
    private audioContext: ISinkSelectableAudioContext | null = null;
    private mediaElementSource: MediaElementAudioSourceNode | null = null;
    private pitchShifterNode: AudioWorkletNode | null = null;
    private audioGraphSetupPromise: Promise<void> | null = null;
    private pitchSemitones = 0;
    private pitchShifterFailed = false;
    private sinkId = "";
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
        this.audio.crossOrigin = "anonymous";
        this.audio.preservesPitch = true;

        ////// events
        this.audio.onplaying = () => {
            this.playRequested = true;
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

        const markBuffering = () => {
            if (!this.audio.paused && !this.audio.ended) {
                this.playerState = PlayerState.Buffering;
            }
        };

        const restorePlaybackState = () => {
            if (
                !this.audio.paused
                && !this.audio.ended
                && this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
            ) {
                this.playerState = PlayerState.Playing;
            }
        };

        this.audio.onseeking = markBuffering;
        this.audio.onwaiting = markBuffering;
        this.audio.onseeked = () => {
            this.onProgressUpdate?.({
                currentTime: this.audio.currentTime,
                duration: this.audio.duration,
            });
            restorePlaybackState();
        };
        this.audio.oncanplay = restorePlaybackState;

        this.audio.onended = () => {
            this.playRequested = false;
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

    private async loadHlsSource(
        url: string,
        headers: Record<string, any> | null,
        generation: number,
        signal: AbortSignal,
    ) {
        try {
            const {
                default: Hls,
                Events: HlsEvents,
                XhrLoader,
            } = await import("hls.js");
            if (generation !== this.sourceGeneration || signal.aborted) {
                return;
            }
            if (!Hls.isSupported()) {
                this.onError?.(ErrorReason.UnsupportedResource);
                return;
            }

            this.destroyHls();
            const resolveRequestUrl = (requestUrl: string) =>
                this.resolvePlayableUrl(requestUrl, headers);
            class ForwardingHlsLoader extends XhrLoader {
                private readonly abortOnSignal = () => this.abort();

                constructor(config: any) {
                    super(config);
                    signal.addEventListener("abort", this.abortOnSignal, { once: true });
                }

                load(context: any, config: any, callbacks: any) {
                    const originalContext = context;
                    const forwardedContext = {
                        ...context,
                        url: resolveRequestUrl(context.url),
                    };
                    super.load(forwardedContext, config, {
                        ...callbacks,
                        onSuccess: (response: any, stats: any, _context: any, details: any) => {
                            response.url = details?.getResponseHeader?.(
                                "x-bakamusic-final-url",
                            ) || originalContext.url;
                            callbacks.onSuccess(response, stats, originalContext, details);
                        },
                        onError: (error: any, _context: any, details: any, stats: any) =>
                            callbacks.onError(error, originalContext, details, stats),
                        onTimeout: (stats: any, _context: any, details: any) =>
                            callbacks.onTimeout(stats, originalContext, details),
                        onProgress: (stats: any, _context: any, data: any, details: any) =>
                            callbacks.onProgress(stats, originalContext, data, details),
                    });
                }

                destroy() {
                    signal.removeEventListener("abort", this.abortOnSignal);
                    super.destroy();
                }
            }
            const hls = new Hls({
                loader: ForwardingHlsLoader,
            });
            const recoveryState: IHlsRecoveryState = {
                networkAttempts: 0,
                mediaAttempts: 0,
            };
            this.hls = hls;
            hls.attachMedia(this.audio);
            hls.on(HlsEvents.ERROR, (_event, error) => {
                if (generation !== this.sourceGeneration || signal.aborted) {
                    return;
                }
                switch (classifyHlsError(error, recoveryState)) {
                    case "ignore":
                        return;
                    case "restart-load":
                        recoveryState.networkAttempts++;
                        hls.startLoad();
                        return;
                    case "recover-media":
                        recoveryState.mediaAttempts++;
                        hls.recoverMediaError();
                        return;
                    case "fail":
                        this.destroyHls();
                        this.onError?.(ErrorReason.EmptyResource, error);
                }
            });
            hls.on(HlsEvents.MANIFEST_PARSED, () => {
                recoveryState.networkAttempts = 0;
                if (this.playRequested && generation === this.sourceGeneration) {
                    this.startAudioPlayback();
                }
            });
            hls.on(HlsEvents.FRAG_LOADED, () => {
                recoveryState.networkAttempts = 0;
                recoveryState.mediaAttempts = 0;
            });
            hls.loadSource(url);
        } catch (error) {
            if (generation === this.sourceGeneration && !signal.aborted) {
                this.onError?.(ErrorReason.EmptyResource, error);
            }
        }
    }

    private destroyHls() {
        if (this.hls) {
            this.hls.detachMedia();
            this.hls.destroy();
            this.hls = null;
        }
    }

    private clearTrackSource() {
        this.playRequested = false;
        this.sourceAbortController?.abort();
        this.sourceAbortController = null;
        this.sourceGeneration += 1;
        this.destroyHls();
        this.audio.pause();
        this.audio.src = "";
        this.audio.removeAttribute("src");
        this.audio.load();
    }

    destroy(): void {
        this.reset();
        this.pitchShifterNode?.disconnect();
        this.mediaElementSource?.disconnect();
        this.pitchShifterNode = null;
        this.mediaElementSource = null;
        const audioContext = this.audioContext;
        this.audioContext = null;
        this.audioGraphSetupPromise = null;
        if (audioContext && audioContext.state !== "closed") {
            void audioContext.close();
        }
    }

    pause(): void {
        this.playRequested = false;
        if (this.hasSource) {
            this.audio.pause();
        }
    }

    play(): void {
        this.playRequested = true;
        if (this.hasSource) {
            this.startAudioPlayback();
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
        this.sinkId = deviceId;
        return Promise.all([
            (this.audio as HTMLAudioElement & {
                setSinkId: (id: string) => Promise<void>;
            }).setSinkId(deviceId),
            this.setAudioContextSinkId(deviceId),
        ]).then(() => undefined);
    }

    setSpeed(speed: number): void {
        this.audio.defaultPlaybackRate = speed;
        this.audio.playbackRate = speed;
    }

    setPitch(semitones: number): void {
        const normalizedSemitones = this.pitchShifterFailed
            ? 0
            : normalizePitchSemitones(semitones);
        this.pitchSemitones = normalizedSemitones;

        if (normalizedSemitones === 0 && !this.audioGraphSetupPromise) {
            this.onPitchChange?.(0);
            return;
        }

        void this.ensureAudioGraph()
            .then(() => {
                this.updatePitchParameter();
                this.onPitchChange?.(this.pitchSemitones);
                void this.resumeAudioContext().catch((error) => {
                    logger.logInfo("pitch shifter is waiting for playback", error);
                });
            })
            .catch((error) => {
                logger.logError("pitch shifter setup failed", error);
                this.pitchSemitones = 0;
                this.onPitchChange?.(0);
            });
    }

    private startAudioPlayback() {
        const start = () => this.audio.play().catch(voidCallback);
        if (!this.audioGraphSetupPromise && this.pitchSemitones === 0) {
            start();
            return;
        }

        void this.ensureAudioGraph()
            .then(() => this.resumeAudioContext())
            .catch((error) => logger.logError("audio graph resume failed", error))
            .finally(start);
    }

    private ensureAudioGraph(): Promise<void> {
        if (this.pitchShifterNode) {
            return Promise.resolve();
        }
        this.audioGraphSetupPromise ??= this.setupAudioGraph();
        return this.audioGraphSetupPromise;
    }

    private async setupAudioGraph() {
        const audioContext = new AudioContext({
            latencyHint: "interactive",
        }) as ISinkSelectableAudioContext;
        try {
            const workletModuleUrl = new URL(
                "./pitch-shifter.worklet.js",
                import.meta.url,
            );
            await audioContext.audioWorklet.addModule(workletModuleUrl);

            const pitchShifterNode = new AudioWorkletNode(
                audioContext,
                PITCH_SHIFTER_PROCESSOR_NAME,
                {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                    channelCount: 2,
                    channelCountMode: "max",
                },
            );
            const mediaElementSource = audioContext.createMediaElementSource(this.audio);
            mediaElementSource.connect(pitchShifterNode).connect(audioContext.destination);

            pitchShifterNode.onprocessorerror = () => {
                logger.logError(
                    "pitch shifter processor failed",
                    new Error("AudioWorklet processor error"),
                );
                pitchShifterNode.disconnect();
                mediaElementSource.disconnect();
                mediaElementSource.connect(audioContext.destination);
                this.pitchShifterFailed = true;
                this.pitchSemitones = 0;
                this.onPitchChange?.(0);
            };

            this.audioContext = audioContext;
            this.mediaElementSource = mediaElementSource;
            this.pitchShifterNode = pitchShifterNode;
            this.updatePitchParameter();
            await this.setAudioContextSinkId(this.sinkId).catch((error) => {
                logger.logError("audio context output device setup failed", error);
            });
        } catch (error) {
            await audioContext.close().catch(voidCallback);
            this.audioGraphSetupPromise = null;
            throw error;
        }
    }

    private updatePitchParameter() {
        const parameter = this.pitchShifterNode?.parameters.get(
            PITCH_SHIFTER_PARAMETER_NAME,
        );
        if (parameter && this.audioContext) {
            parameter.setValueAtTime(
                this.pitchSemitones,
                this.audioContext.currentTime,
            );
        }
    }

    private resumeAudioContext() {
        if (this.audioContext?.state === "suspended") {
            return this.audioContext.resume();
        }
        return Promise.resolve();
    }

    private setAudioContextSinkId(deviceId: string) {
        if (!this.audioContext?.setSinkId) {
            return Promise.resolve();
        }
        return this.audioContext.setSinkId(deviceId);
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

    private resolvePlayableUrl(
        url: string,
        headers?: Record<string, string> | null,
    ) {
        if (!headers || Object.keys(headers).length === 0) {
            return url;
        }

        const forwardedUrl = ServiceManager.RequestForwarderService.forwardRequest(
            url,
            "GET",
            headers,
        );

        if (forwardedUrl) {
            return forwardedUrl;
        }

        if (!headers["Authorization"]) {
            return encodeUrlHeaders(url, headers);
        }

        throw new Error("request forwarder service unavailable");
    }

    setTrackSource(trackSource: IMusic.IMusicSource, musicItem: IMusic.IMusicItem): void {
        if (!trackSource.url) {
            this.onError?.(ErrorReason.EmptyResource, new Error("mediaSource.url is empty"));
            return;
        }
        this.musicItem = { ...musicItem };
        this.sourceAbortController?.abort();
        const sourceAbortController = new AbortController();
        this.sourceAbortController = sourceAbortController;
        const sourceGeneration = ++this.sourceGeneration;

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
        let url = trackSource.url.startsWith("file:")
            ? fsUtil.addFileScheme(trackSource.url)
            : trackSource.url;
        const urlObj = new URL(url);
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
        // 3. set real source
        if (getUrlExt(trackSource.url) === ".m3u8") {
            void this.loadHlsSource(
                url,
                headers,
                sourceGeneration,
                sourceAbortController.signal,
            );
        } else {
            this.destroyHls();
            try {
                this.audio.src = this.resolvePlayableUrl(url, headers);
            } catch (error) {
                this.onError?.(ErrorReason.EmptyResource, error);
            }
        }
    }

    setVolume(volume: number): void {
        this.audio.volume = volume;
    }
}

export default AudioController;
