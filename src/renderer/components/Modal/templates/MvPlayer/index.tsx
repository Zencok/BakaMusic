import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { normalizeVideoUpstreamUrl } from "@/common/video-url";
import SvgAsset from "@renderer/components/SvgAsset";
import { getMediaPluginDelegate } from "@renderer/core/track-player/plugin-media";
import {
    startMusicVideoDownload,
    type IVideoDownloadTask,
} from "@renderer/utils/download-music-video";
import nativePlayback from "@shared/native-playback/renderer";
import nodeRuntime from "@shared/node-runtime/renderer";
import type {
    INativeVideoSource,
    INativeVideoSurfaceBounds,
    NativeVideoCommand,
} from "@shared/native-playback/common";
import PluginManager from "@shared/plugin-manager/renderer";
import { appWindowUtil, shellUtil } from "@shared/utils/renderer";
import Base from "../Base";
import "./index.scss";

export interface IMvPlayerAudioSession {
    initialVolume: number;
    initialMuted: boolean;
    suspendForVideo(): Promise<void>;
    restoreAfterVideo(): void | Promise<void>;
}

export interface IMvPlayerProps {
    musicItem: IMusic.IMusicItem;
    audioSession: IMvPlayerAudioSession;
    onClose(): void;
}

const VIDEO_SPEED_PRESETS = [2, 1.5, 1.25, 1, 0.75, 0.5] as const;

type VideoCandidate = IPlugin.IVideoQualityOption & {
    source?: IPlugin.IVideoSourceResult;
};

type PlayerVideoSource = INativeVideoSource & {
    actualKey: string;
    sourceFingerprint: string;
    size?: number | string;
    codec?: string;
    mimeType?: string;
    downloadSource: IPlugin.IVideoSourceResult;
};

type DownloadPhase = "idle" | "downloading" | "done" | "error";
type SourceSizeState = number | "loading" | "stream" | "unknown";

type VideoCommandInput = NativeVideoCommand extends infer Command
    ? Command extends { sourceId: string }
        ? Omit<Command, "sourceId">
        : never
    : never;

function getQualityHeight(option: IPlugin.IVideoQualityOption) {
    if (option.height) return option.height;
    const name = `${option.key} ${option.label ?? ""}`;
    if (/8k/i.test(name)) return 4320;
    if (/4k/i.test(name)) return 2160;
    return Number.parseInt(name, 10) || 0;
}

function isDolbyVision(option: IPlugin.IVideoQualityOption) {
    return option.dynamicRange === "dolby-vision"
        || /dolby[\s_-]*vision|dovi|dvhe|dvh1|杜比视界/i.test(
            `${option.key} ${option.label ?? ""} ${option.codec ?? ""}`,
        );
}

function getDynamicRange(option: VideoCandidate): IPlugin.VideoDynamicRange | undefined {
    if (option.source?.dynamicRange) return option.source.dynamicRange;
    if (option.dynamicRange) return option.dynamicRange;
    return isDolbyVision(option) ? "dolby-vision" : undefined;
}

function getQualityRank(option: VideoCandidate) {
    const dynamicRange = getDynamicRange(option);
    const rangeRank = dynamicRange === "dolby-vision" ? 3
        : dynamicRange === "hdr10" ? 2
            : dynamicRange === "sdr" ? 1 : 0;
    const hfrRank = /hfr|high[\s_-]*frame|高帧/i.test(
        `${option.key} ${option.label ?? ""}`,
    ) ? 1 : 0;
    return rangeRank * 100_000 + getQualityHeight(option) * 10 + hfrRank;
}

function mergeCandidates(...groups: VideoCandidate[][]) {
    const merged = new Map<string, VideoCandidate>();
    for (const candidate of groups.flat()) {
        if (!candidate.key) continue;
        const defined = Object.entries(candidate).filter(([, value]) => value !== undefined);
        merged.set(candidate.key, {
            ...merged.get(candidate.key),
            ...Object.fromEntries(defined),
            key: candidate.key,
        });
    }
    return [...merged.values()];
}

function getSourceHeaders(source: IPlugin.IVideoSourceResult) {
    const headers = { ...(source.headers ?? {}) };
    if (source.userAgent) {
        const existingName = Object.keys(headers).find(
            (name) => name.toLocaleLowerCase("en-US") === "user-agent",
        );
        headers[existingName ?? "User-Agent"] = source.userAgent;
    }
    return Object.keys(headers).length ? headers : undefined;
}

function getVideoSourceFingerprint(source: IPlugin.IVideoSourceResult): string {
    try {
        const parsed = new URL(source.url ?? "");
        return `${parsed.origin}${parsed.pathname}`.toLocaleLowerCase("en-US");
    } catch {
        return source.url?.split(/[?#]/, 1)[0]?.toLocaleLowerCase("en-US") || "";
    }
}

function getActualQuality(candidate: VideoCandidate) {
    return candidate.source?.videoQuality
        || (candidate.source?.height
            ? `${candidate.source.height}p`
            : candidate.label || candidate.key);
}

function toNativeSource(candidate: VideoCandidate): PlayerVideoSource | null {
    const source = candidate.source;
    if (!source?.url) return null;
    const normalizedUrl: string = normalizeVideoUpstreamUrl(source.url);
    const normalizedSource: IPlugin.IVideoSourceResult = {
        ...source,
        url: normalizedUrl,
        backupUrls: source.backupUrls?.map(normalizeVideoUpstreamUrl),
    };
    const actualKey = getActualQuality(candidate);
    return {
        key: candidate.key,
        label: actualKey,
        actualKey,
        sourceFingerprint: getVideoSourceFingerprint(normalizedSource),
        url: normalizedUrl,
        backupUrls: normalizedSource.backupUrls,
        headers: getSourceHeaders(normalizedSource),
        width: normalizedSource.width || candidate.width,
        height: normalizedSource.height || candidate.height,
        dynamicRange: getDynamicRange(candidate),
        size: normalizedSource.size || candidate.size,
        codec: normalizedSource.codec || candidate.codec,
        mimeType: normalizedSource.mimeType || candidate.mimeType,
        downloadSource: normalizedSource,
    };
}

function getSourceMetadataScore(source: PlayerVideoSource) {
    return [
        source.width,
        source.height,
        source.size,
        source.codec,
        source.mimeType,
        source.dynamicRange,
    ].filter((value) => value !== undefined && value !== "").length;
}

function dedupeSources(candidates: VideoCandidate[], activeRequestKey = "") {
    const deduped: PlayerVideoSource[] = [];
    const sorted = [...candidates]
        .sort((left, right) => getQualityRank(right) - getQualityRank(left));
    for (const candidate of sorted) {
        const source = toNativeSource(candidate);
        if (!source) continue;
        const normalizedActualKey = source.actualKey.trim().toLocaleLowerCase("en-US");
        const duplicateIndex = deduped.findIndex((item) => (
            Boolean(
                normalizedActualKey
                && item.actualKey.trim().toLocaleLowerCase("en-US") === normalizedActualKey,
            )
            || Boolean(
                source.sourceFingerprint
                && item.sourceFingerprint === source.sourceFingerprint,
            )
        ));
        if (duplicateIndex < 0) {
            deduped.push(source);
            continue;
        }
        const current = deduped[duplicateIndex];
        const preferSource = source.key === activeRequestKey
            || (
                current.key !== activeRequestKey
                && getSourceMetadataScore(source) > getSourceMetadataScore(current)
            );
        if (preferSource) deduped[duplicateIndex] = source;
    }
    return deduped;
}

function formatVideoTime(value: number) {
    const seconds = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
        : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatVideoSize(value: number | string | undefined) {
    if (typeof value === "string") return value.trim() || "";
    if (!Number.isFinite(value) || value === undefined || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 100 || index === 0 ? size.toFixed(0) : size.toFixed(1)}${units[index]}`;
}

function getSurfaceBounds(
    element: HTMLElement | null,
    player: HTMLElement | null,
): INativeVideoSurfaceBounds {
    const rect = element?.getBoundingClientRect();
    if (!rect) {
        return { x: 0, y: 0, width: 1, height: 1, borderRadius: 0 };
    }
    // Keep the near edge stable and round only to the physical CSS-pixel
    // boundary. The native popup, clip-path hole, and player card must share
    // the same far edge; expanding it exposes the surface beneath the overlay.
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    const right = Math.ceil(rect.right);
    const bottom = Math.ceil(rect.bottom);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const radiusValue = Number.parseFloat(
        player ? window.getComputedStyle(player).borderTopLeftRadius : "0",
    );
    const borderRadius = Math.max(0, Math.min(
        Number.isFinite(radiusValue) ? radiusValue : 0,
        width / 2,
        height / 2,
    ));
    return {
        x: left,
        y: top,
        width,
        height,
        borderRadius,
    };
}

function waitForRendererPaint() {
    return new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
}

function waitForOpacityTransition(element: HTMLElement | null, fallbackMs: number) {
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return waitForRendererPaint();
    }
    return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            element.removeEventListener("transitionend", onTransitionEnd);
            resolve();
        };
        const onTransitionEnd = (event: TransitionEvent) => {
            if (event.target === element && event.propertyName === "opacity") finish();
        };
        const timer = window.setTimeout(finish, fallbackMs);
        element.addEventListener("transitionend", onTransitionEnd);
    });
}

function handleMenuNavigation(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[role^='menuitem']",
    )];
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
        nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
        nextIndex = 0;
    } else if (event.key === "End") {
        nextIndex = items.length - 1;
    }
    if (nextIndex !== null && items[nextIndex]) {
        event.preventDefault();
        items[nextIndex].focus();
    }
}

export default function MvPlayer({ musicItem, audioSession, onClose }: IMvPlayerProps) {
    const { t } = useTranslation();
    const playerRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<HTMLDivElement>(null);
    const closeCurtainRef = useRef<HTMLDivElement>(null);
    const qualityMenuRef = useRef<HTMLDivElement>(null);
    const downloadMenuRef = useRef<HTMLDivElement>(null);
    const downloadTaskRef = useRef<IVideoDownloadTask | null>(null);
    const downloadRequestIdRef = useRef(0);
    const sizeProbeGenerationRef = useRef(0);
    const probedSizeKeysRef = useRef(new Set<string>());
    const mountedRef = useRef(true);
    const closingRef = useRef(false);
    const fullscreenRef = useRef(false);
    const fullscreenRequestedRef = useRef(false);
    const controlsTimerRef = useRef<number | null>(null);
    const stageClickTimerRef = useRef<number | null>(null);
    const wheelVolumeTimerRef = useRef<number | null>(null);
    const sessionBase = useRef(
        `video-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ).current;
    const activeSessionRef = useRef("");
    const previousVolumeRef = useRef(Math.max(audioSession.initialVolume, 0.82));
    const currentVolumeRef = useRef(
        audioSession.initialMuted ? 0 : audioSession.initialVolume,
    );
    const [retryToken, setRetryToken] = useState(0);
    const sessionId = `${sessionBase}-${retryToken}`;
    const [nativeSessionId, setNativeSessionId] = useState("");
    const [nativeOpened, setNativeOpened] = useState(false);
    const [nativeFrameReady, setNativeFrameReady] = useState(false);
    const [nativeSurfaceRevealed, setNativeSurfaceRevealed] = useState(false);
    const [sources, setSources] = useState<PlayerVideoSource[]>([]);
    const [activeSourceKey, setActiveSourceKey] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(audioSession.initialVolume);
    const [muted, setMuted] = useState(audioSession.initialMuted);
    const [speed, setSpeed] = useState(1);
    const [fullscreen, setFullscreen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [closeCovered, setCloseCovered] = useState(false);
    const [exiting, setExiting] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
    const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
    const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>("idle");
    const [downloadPercent, setDownloadPercent] = useState(0);
    const [downloadedPath, setDownloadedPath] = useState("");
    const [sourceSizeState, setSourceSizeState] = useState<Record<string, SourceSizeState>>({});
    const [seekPreview, setSeekPreview] = useState<{ percent: number; time: number } | null>(null);
    const [wheelVolume, setWheelVolume] = useState(0);
    const [wheelVolumeVisible, setWheelVolumeVisible] = useState(false);

    const clearControlsTimer = useCallback(() => {
        if (controlsTimerRef.current !== null) {
            window.clearTimeout(controlsTimerRef.current);
            controlsTimerRef.current = null;
        }
    }, []);

    const revealControls = useCallback(() => {
        clearControlsTimer();
        setControlsVisible(true);
        if (playing && !qualityMenuOpen && !speedMenuOpen && !downloadMenuOpen) {
            controlsTimerRef.current = window.setTimeout(() => {
                setControlsVisible(false);
                controlsTimerRef.current = null;
            }, 2600);
        }
    }, [clearControlsTimer, downloadMenuOpen, playing, qualityMenuOpen, speedMenuOpen]);

    const sendVideoCommand = useCallback((command: VideoCommandInput) => {
        if (!nativeSessionId || !nativeOpened) return Promise.resolve();
        return nativePlayback.videoCommand({
            ...command,
            sourceId: nativeSessionId,
        } as Parameters<typeof nativePlayback.videoCommand>[0]);
    }, [nativeOpened, nativeSessionId]);

    const togglePlayback = useCallback(() => {
        if (!nativeOpened) return;
        const nextPlaying = !playing;
        setPlaying(nextPlaying);
        setLoading(false);
        revealControls();
        void sendVideoCommand({ operation: nextPlaying ? "play" : "pause" }).catch((reason) => {
            setPlaying(!nextPlaying);
            toast.error(reason instanceof Error ? reason.message : t("mv_player.error"));
        });
    }, [nativeOpened, playing, revealControls, sendVideoCommand, t]);

    const updateVolume = useCallback((nextValue: number) => {
        const nextVolume = Math.max(0, Math.min(1, nextValue));
        if (nextVolume > 0) previousVolumeRef.current = nextVolume;
        currentVolumeRef.current = nextVolume;
        setVolume(nextVolume);
        setMuted(nextVolume === 0);
        void sendVideoCommand({ operation: "volume", volume: nextVolume }).catch(() => undefined);
    }, [sendVideoCommand]);

    const showWheelVolume = useCallback((nextVolume: number) => {
        if (wheelVolumeTimerRef.current !== null) {
            window.clearTimeout(wheelVolumeTimerRef.current);
        }
        setWheelVolume(nextVolume);
        setWheelVolumeVisible(true);
        wheelVolumeTimerRef.current = window.setTimeout(() => {
            setWheelVolumeVisible(false);
            wheelVolumeTimerRef.current = null;
        }, 900);
    }, []);

    const toggleMuted = useCallback(() => {
        if (muted || volume === 0) {
            updateVolume(previousVolumeRef.current || 0.82);
        } else {
            previousVolumeRef.current = volume;
            updateVolume(0);
        }
    }, [muted, updateVolume, volume]);

    const updateSpeed = useCallback((nextSpeed: number) => {
        const previousSpeed = speed;
        setSpeed(nextSpeed);
        setSpeedMenuOpen(false);
        revealControls();
        void sendVideoCommand({ operation: "speed", speed: nextSpeed }).catch((reason) => {
            setSpeed(previousSpeed);
            toast.error(reason instanceof Error ? reason.message : t("mv_player.error"));
        });
    }, [revealControls, sendVideoCommand, speed, t]);

    const setFullscreenState = useCallback((next: boolean) => {
        fullscreenRef.current = next;
        setFullscreen(next);
    }, []);

    const exitFullscreen = useCallback(() => {
        fullscreenRequestedRef.current = false;
        appWindowUtil.setMainWindowFullScreen?.(false);
        setFullscreenState(false);
        revealControls();
    }, [revealControls, setFullscreenState]);

    const enterFullscreen = useCallback(() => {
        fullscreenRequestedRef.current = true;
        setFullscreenState(true);
        revealControls();
        appWindowUtil.setMainWindowFullScreen?.(true);
    }, [revealControls, setFullscreenState]);

    const toggleFullscreen = useCallback(() => {
        if (fullscreenRef.current) {
            exitFullscreen();
        } else {
            enterFullscreen();
        }
    }, [enterFullscreen, exitFullscreen]);

    const requestClose = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setClosing(true);
        clearControlsTimer();

        void (async () => {
            // Fade Chromium's curtain over the still-playing native HWND first.
            // Once opaque, the popup and transparent cutout can be removed
            // without exposing either DWM or the HWND teardown frame.
            await waitForOpacityTransition(closeCurtainRef.current, 120);
            setCloseCovered(true);
            await waitForRendererPaint();
            const sourceId = nativeSessionId || activeSessionRef.current;
            if (sourceId) {
                await nativePlayback.updateVideoSurface({
                    sourceId,
                    bounds: getSurfaceBounds(surfaceRef.current, playerRef.current),
                    visible: false,
                }).catch(() => undefined);
                // Hiding the HWND is the visual boundary. Runtime teardown can
                // finish after the modal starts leaving instead of stalling the
                // close animation on the utility-process exit.
                void nativePlayback.closeVideo(sourceId).catch(() => undefined);
            }
            setExiting(true);
            await waitForOpacityTransition(playerRef.current, 150);
            onClose();
        })();
    }, [clearControlsTimer, nativeSessionId, onClose]);

    const handleWheelVolume = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (qualityMenuOpen || speedMenuOpen || downloadMenuOpen) return;
        event.preventDefault();
        if (event.deltaY === 0) return;
        const nextVolume = Math.max(0, Math.min(
            1,
            currentVolumeRef.current + (event.deltaY < 0 ? 0.05 : -0.05),
        ));
        updateVolume(nextVolume);
        showWheelVolume(nextVolume);
        revealControls();
    }, [
        downloadMenuOpen,
        qualityMenuOpen,
        revealControls,
        showWheelVolume,
        speedMenuOpen,
        updateVolume,
    ]);

    useEffect(() => {
        const unsubscribe = appWindowUtil.onMainWindowFullScreenChanged?.((enabled) => {
            const next = Boolean(enabled);
            setFullscreenState(next);
            revealControls();
            if (!next) {
                fullscreenRequestedRef.current = false;
            }
        });
        return () => {
            unsubscribe?.();
        };
    }, [revealControls, setFullscreenState]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.matches("input") && (target as HTMLInputElement).type !== "range") return;
            if (target?.matches("input") && (target as HTMLInputElement).type === "range" && event.code !== "Space") return;
            if (target?.matches("[role='menuitemradio']")) return;
            if (target?.matches("button") && event.code !== "Space") return;
            if (event.code === "Space" || event.key.toLocaleLowerCase("en-US") === "k") {
                event.preventDefault();
                togglePlayback();
            } else if (event.key.toLocaleLowerCase("en-US") === "m") {
                event.preventDefault();
                toggleMuted();
            } else if (event.key.toLocaleLowerCase("en-US") === "f") {
                event.preventDefault();
                toggleFullscreen();
            } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const nextTime = Math.max(0, Math.min(
                    duration || Number.POSITIVE_INFINITY,
                    currentTime + (event.key === "ArrowLeft" ? -5 : 5),
                ));
                setCurrentTime(nextTime);
                void sendVideoCommand({ operation: "seek", seconds: nextTime });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [currentTime, duration, sendVideoCommand, toggleFullscreen, toggleMuted, togglePlayback]);

    useEffect(() => {
        if (!qualityMenuOpen && !speedMenuOpen && !downloadMenuOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (
                target instanceof Element
                && !target.closest(".mv-player-quality-picker")
                && !target.closest(".mv-player-speed-picker")
                && !target.closest(".mv-player-download-picker")
            ) {
                setQualityMenuOpen(false);
                setSpeedMenuOpen(false);
                setDownloadMenuOpen(false);
            }
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [downloadMenuOpen, qualityMenuOpen, speedMenuOpen]);

    useEffect(() => {
        clearControlsTimer();
        if (playing) revealControls();
        else setControlsVisible(true);
        return clearControlsTimer;
    }, [clearControlsTimer, playing, revealControls]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            downloadRequestIdRef.current = Number.MAX_SAFE_INTEGER;
            void downloadTaskRef.current?.cancel();
            downloadTaskRef.current = null;
            clearControlsTimer();
            if (stageClickTimerRef.current !== null) {
                window.clearTimeout(stageClickTimerRef.current);
            }
            if (wheelVolumeTimerRef.current !== null) {
                window.clearTimeout(wheelVolumeTimerRef.current);
            }
            if (fullscreenRequestedRef.current) {
                fullscreenRequestedRef.current = false;
                appWindowUtil.setMainWindowFullScreen?.(false);
            }
        };
    }, [clearControlsTimer]);

    useEffect(() => {
        let canceled = false;
        let videoOpened = false;
        let audioSuspended = false;
        let audioRestored = false;

        setNativeOpened(false);
        setNativeFrameReady(false);
        setNativeSurfaceRevealed(false);
        setNativeSessionId("");
        setSources([]);
        setActiveSourceKey("");
        setLoading(true);
        setError(false);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setQualityMenuOpen(false);
        setSpeedMenuOpen(false);
        setDownloadMenuOpen(false);
        setDownloadPhase("idle");
        setDownloadPercent(0);
        setDownloadedPath("");
        sizeProbeGenerationRef.current += 1;
        probedSizeKeysRef.current.clear();
        setSourceSizeState({});

        const restoreAudio = () => {
            if (!audioSuspended || audioRestored) return;
            audioRestored = true;
            void audioSession.restoreAfterVideo();
        };

        const removeVideoListener = nativePlayback.onVideoEvent((event) => {
            if (event.sourceId !== sessionId || canceled) return;
            if (event.type === "snapshot" && event.snapshot) {
                const snapshot = event.snapshot;
                setCurrentTime(snapshot.currentTime);
                setDuration(snapshot.duration);
                if (snapshot.state === "playing") {
                    setPlaying(true);
                    const frameReady = snapshot.currentTime > 0;
                    if (frameReady) setNativeFrameReady(true);
                    setLoading(!frameReady);
                    setError(false);
                } else if (snapshot.state === "buffering") {
                    setLoading(true);
                } else if (snapshot.state === "paused") {
                    setPlaying(false);
                    setLoading(false);
                }
                return;
            }
            if (event.type === "error") {
                setLoading(false);
                setNativeFrameReady(false);
                setNativeSurfaceRevealed(false);
                setError(true);
                setPlaying(false);
                toast.error(event.error || t("mv_player.error"));
                return;
            }
            if (event.type === "closed" && videoOpened) {
                restoreAudio();
                if (!closingRef.current) {
                    setNativeOpened(false);
                    setLoading(false);
                    setError(true);
                    setPlaying(false);
                }
            }
        });

        const openNativeVideo = async () => {
            const previousSessionId = activeSessionRef.current;
            if (previousSessionId && previousSessionId !== sessionId) {
                await nativePlayback.closeVideo(previousSessionId).catch(() => undefined);
            }
            if (canceled) return;

            // Reserve the single native overlay session before resolving its
            // sources and warming the libmpv popup below this transparent window.
            activeSessionRef.current = sessionId;
            await nativePlayback.prepareVideoOverlay(sessionId);
            await waitForRendererPaint();
            if (canceled) {
                await nativePlayback.closeVideo(sessionId).catch(() => undefined);
                return;
            }

            const pluginReference = getMediaPluginDelegate(musicItem);
            const plugin = (pluginReference.hash
                ? PluginManager.getPluginByHash(pluginReference.hash)
                : undefined)
                ?? PluginManager.getPluginByPlatform(pluginReference.platform ?? "");
            const declaredCandidates: VideoCandidate[] = (plugin?.supportedVideoQualities ?? [])
                .map((key) => ({ key, label: key }));
            const initialCandidate = [...declaredCandidates]
                .sort((left, right) => getQualityHeight(right) - getQualityHeight(left))[0];
            const initialKey = musicItem.videoQuality || initialCandidate?.key || "1080p";
            const initialResult = await PluginManager.callPluginDelegateMethod(
                pluginReference,
                "getMvSource",
                musicItem,
                initialKey,
            );
            if (!initialResult?.url) throw new Error("MV source unavailable");

            let candidates = mergeCandidates(
                declaredCandidates,
                initialResult.availableVideoQualities ?? [],
                [{
                    key: initialKey,
                    label: initialResult.videoQuality || initialKey,
                    source: initialResult,
                    width: initialResult.width,
                    height: initialResult.height,
                    codec: initialResult.codec,
                    dynamicRange: initialResult.dynamicRange,
                }],
            );
            const explicitCandidate = musicItem.videoQuality
                ? candidates.find((candidate) => candidate.key === musicItem.videoQuality)
                : undefined;
            const preferredCandidate = explicitCandidate
                ?? [...candidates].sort((left, right) => getQualityRank(right) - getQualityRank(left))[0];
            if (preferredCandidate && !preferredCandidate.source) {
                const preferredResult = await PluginManager.callPluginDelegateMethod(
                    pluginReference,
                    "getMvSource",
                    musicItem,
                    preferredCandidate.key,
                ).catch(() => null);
                if (preferredResult?.url) {
                    candidates = mergeCandidates(candidates, [{
                        ...preferredCandidate,
                        source: preferredResult,
                        label: preferredResult.videoQuality || preferredCandidate.label,
                        width: preferredResult.width || preferredCandidate.width,
                        height: preferredResult.height || preferredCandidate.height,
                        codec: preferredResult.codec || preferredCandidate.codec,
                        dynamicRange: preferredResult.dynamicRange || preferredCandidate.dynamicRange,
                    }]);
                }
            }
            if (canceled) return;
            const availablePreferred = candidates.find(
                (candidate) => candidate.key === preferredCandidate?.key && candidate.source?.url,
            ) ?? candidates.find((candidate) => candidate.source?.url);
            const initialSource = availablePreferred ? toNativeSource(availablePreferred) : null;
            if (!initialSource) throw new Error("MV source unavailable");

            await audioSession.suspendForVideo();
            audioSuspended = true;
            if (canceled) {
                restoreAudio();
                return;
            }

            await nativePlayback.openVideo({
                sourceId: sessionId,
                title: musicItem.title,
                artist: musicItem.artist,
                album: musicItem.album ?? "",
                artwork: musicItem.artwork ?? musicItem.coverImg ?? "",
                appMediaId: `video:${musicItem.platform}:${
                    musicItem.videoId ?? musicItem.mv ?? musicItem.id
                }`,
                sources: [initialSource],
                initialSourceKey: initialSource.key,
                volume: muted ? 0 : volume,
                surface: {
                    bounds: getSurfaceBounds(surfaceRef.current, playerRef.current),
                    visible: false,
                },
            });
            videoOpened = true;
            if (speed !== 1) {
                await nativePlayback.videoCommand({
                    operation: "speed",
                    sourceId: sessionId,
                    speed,
                });
            }
            if (canceled) {
                await nativePlayback.closeVideo(sessionId);
                restoreAudio();
                return;
            }
            setNativeSessionId(sessionId);
            setNativeOpened(true);
            setSources([initialSource]);
            setActiveSourceKey(initialSource.key);
            // The runtime has accepted play, but the Win32 swap chain may not
            // contain a decoded frame yet. Snapshot time advancing is the
            // readiness signal that removes the loading cover.
            setLoading(true);
            setPlaying(true);

            let nextIndex = 0;
            const hydrateCandidate = async () => {
                while (!canceled && nextIndex < candidates.length) {
                    const candidate = candidates[nextIndex++];
                    if (!candidate || candidate.source?.url) continue;
                    const result = await PluginManager.callPluginDelegateMethod(
                        pluginReference,
                        "getMvSource",
                        musicItem,
                        candidate.key,
                    ).catch(() => null);
                    if (!result?.url || canceled) continue;
                    candidate.source = result;
                    candidate.label = result.videoQuality || candidate.label;
                    candidate.width = result.width || candidate.width;
                    candidate.height = result.height || candidate.height;
                    candidate.codec = result.codec || candidate.codec;
                    candidate.dynamicRange = result.dynamicRange || candidate.dynamicRange;
                }
            };
            await Promise.all(Array.from(
                { length: Math.min(3, candidates.length) },
                () => hydrateCandidate(),
            ));
            if (canceled) return;
            const hydratedSources = dedupeSources(candidates, initialSource.key);
            if (hydratedSources.some((source) => source.key === initialSource.key)) {
                await nativePlayback.updateVideoSources({
                    sourceId: sessionId,
                    sources: hydratedSources,
                });
                setSources(hydratedSources);
            }
        };

        void openNativeVideo().catch(async (reason) => {
            if (canceled) return;
            await nativePlayback.closeVideo(sessionId).catch(() => undefined);
            restoreAudio();
            setNativeOpened(false);
            setLoading(false);
            setPlaying(false);
            setError(true);
            toast.error(reason instanceof Error ? reason.message : t("mv_player.error"));
        });

        return () => {
            canceled = true;
            removeVideoListener();
            if (activeSessionRef.current === sessionId) {
                activeSessionRef.current = "";
            }
            if (videoOpened) {
                void nativePlayback.closeVideo(sessionId).finally(restoreAudio);
            } else {
                void nativePlayback.closeVideo(sessionId);
                restoreAudio();
            }
        };
    // Session settings are captured when this playback session starts; later changes use videoCommand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioSession, musicItem, retryToken, sessionId, t]);

    // Keep the native HWND mounted for pause, seek, source switching and menu
    // interactions. Hiding it discards the last presented frame and exposes the
    // black modal background, which makes every control action look like a
    // playback failure.
    const surfaceVisible = nativeOpened && nativeFrameReady && !error && !closeCovered;

    useEffect(() => {
        if (!nativeOpened || !nativeSessionId) return;
        let frame = 0;
        let disposed = false;
        let syncVersion = 0;
        const root = document.documentElement;
        const clearRendererOverlay = () => {
            delete root.dataset.nativeVideoOverlay;
            for (const property of [
                "--native-video-left",
                "--native-video-top",
                "--native-video-right",
                "--native-video-bottom",
                "--native-video-radius",
                "--native-video-radius-near",
                "--native-video-radius-mid",
                "--native-video-radius-far",
            ]) {
                root.style.removeProperty(property);
            }
        };
        const syncSurface = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                const version = ++syncVersion;
                const bounds = getSurfaceBounds(surfaceRef.current, playerRef.current);
                // Chromium anti-aliases the clip-path hole on its far edges.
                // Keep the hole aligned to the visible card, while letting the
                // native popup extend one CSS pixel underneath that edge so the
                // compositor never exposes the light main-window surface.
                const nativeBounds: INativeVideoSurfaceBounds = {
                    ...bounds,
                    width: bounds.width + 1,
                    height: bounds.height + 1,
                };
                const sync = async () => {
                    if (surfaceVisible) {
                        const clipRadius = bounds.borderRadius > 0
                            ? Math.min(
                                bounds.borderRadius,
                                bounds.width / 2,
                                bounds.height / 2,
                            )
                            : 0;
                        root.style.setProperty("--native-video-left", `${bounds.x}px`);
                        root.style.setProperty("--native-video-top", `${bounds.y}px`);
                        root.style.setProperty(
                            "--native-video-right",
                            `${bounds.x + bounds.width}px`,
                        );
                        root.style.setProperty(
                            "--native-video-bottom",
                            `${bounds.y + bounds.height}px`,
                        );
                        root.style.setProperty("--native-video-radius", `${clipRadius}px`);
                        root.style.setProperty(
                            "--native-video-radius-near",
                            `${clipRadius * 0.07612}px`,
                        );
                        root.style.setProperty(
                            "--native-video-radius-mid",
                            `${clipRadius * 0.29289}px`,
                        );
                        root.style.setProperty(
                            "--native-video-radius-far",
                            `${clipRadius * 0.61732}px`,
                        );
                        // Install the cutout before asking the main process to
                        // show the HWND. Waiting for a renderer paint makes the
                        // first visible compositor frame a real surface frame,
                        // rather than the opaque modal canvas.
                        root.dataset.nativeVideoOverlay = "true";
                        await waitForRendererPaint();
                        if (disposed || version !== syncVersion) return;
                        await nativePlayback.updateVideoSurface({
                            sourceId: nativeSessionId,
                            bounds: nativeBounds,
                            visible: true,
                        });
                        if (disposed || version !== syncVersion) return;
                        // The HWND was primed behind the opaque player and has a
                        // decoded frame already. One renderer paint barrier is
                        // enough to expose the prepared surface atomically.
                        await waitForRendererPaint();
                        if (disposed || version !== syncVersion) return;
                        setNativeSurfaceRevealed(true);
                    } else {
                        clearRendererOverlay();
                        setNativeSurfaceRevealed(false);
                        await nativePlayback.updateVideoSurface({
                            sourceId: nativeSessionId,
                            bounds: nativeBounds,
                            visible: false,
                        }).catch(() => undefined);
                    }
                };
                void sync().catch(() => {
                    if (disposed || version !== syncVersion) return;
                    clearRendererOverlay();
                    setNativeSurfaceRevealed(false);
                });
            });
        };
        const observer = new ResizeObserver(syncSurface);
        if (surfaceRef.current) observer.observe(surfaceRef.current);
        window.addEventListener("resize", syncSurface);
        document.addEventListener("fullscreenchange", syncSurface);
        syncSurface();
        return () => {
            disposed = true;
            observer.disconnect();
            window.removeEventListener("resize", syncSurface);
            document.removeEventListener("fullscreenchange", syncSurface);
            window.cancelAnimationFrame(frame);
            clearRendererOverlay();
        };
    }, [nativeFrameReady, nativeOpened, nativeSessionId, surfaceVisible]);

    useEffect(() => {
        const generation = sizeProbeGenerationRef.current;
        for (const source of sources) {
            if (formatVideoSize(source.size) || probedSizeKeysRef.current.has(source.key)) {
                continue;
            }
            probedSizeKeysRef.current.add(source.key);
            setSourceSizeState((current) => ({ ...current, [source.key]: "loading" }));
            void nodeRuntime.probeMediaSize(source.downloadSource).then((size) => {
                if (!mountedRef.current || generation !== sizeProbeGenerationRef.current) return;
                setSourceSizeState((current) => ({
                    ...current,
                    [source.key]: size && size > 0 ? size : "stream",
                }));
            }).catch(() => {
                if (!mountedRef.current || generation !== sizeProbeGenerationRef.current) return;
                setSourceSizeState((current) => ({ ...current, [source.key]: "unknown" }));
            });
        }
    }, [sources]);

    const handleDownloadButton = async () => {
        if (downloadPhase === "done" && downloadedPath) {
            await shellUtil.showItemInFolder(downloadedPath);
            return;
        }
        if (downloadPhase === "downloading") {
            downloadRequestIdRef.current += 1;
            await downloadTaskRef.current?.cancel();
            downloadTaskRef.current = null;
            setDownloadPhase("idle");
            setDownloadPercent(0);
            toast.info(t("mv_player.download_canceled"));
            return;
        }
        setQualityMenuOpen(false);
        setSpeedMenuOpen(false);
        setDownloadMenuOpen((open) => !open);
    };

    const handleDownload = async (source: PlayerVideoSource) => {
        const requestId = ++downloadRequestIdRef.current;
        setDownloadMenuOpen(false);
        setDownloadPhase("downloading");
        setDownloadPercent(0);
        setDownloadedPath("");
        try {
            const downloadSource = source.downloadSource;
            const task = startMusicVideoDownload(
                musicItem,
                {
                    url: source.url,
                    headers: downloadSource.headers,
                    userAgent: downloadSource.userAgent,
                },
                downloadSource.videoQuality || source.label || source.key,
                (progress) => {
                    if (!mountedRef.current || requestId !== downloadRequestIdRef.current) return;
                    if (progress.total && progress.downloaded !== undefined) {
                        setDownloadPercent(Math.min(
                            100,
                            Math.round(progress.downloaded / progress.total * 100),
                        ));
                    }
                },
            );
            downloadTaskRef.current = task;
            const filePath = await task.completion;
            if (downloadTaskRef.current === task) downloadTaskRef.current = null;
            if (mountedRef.current && requestId === downloadRequestIdRef.current) {
                setDownloadedPath(filePath);
                setDownloadPercent(100);
                setDownloadPhase("done");
                toast.success(t("mv_player.download_complete"));
            }
        } catch (downloadError) {
            if (downloadError instanceof DOMException && downloadError.name === "AbortError") {
                return;
            }
            if (mountedRef.current && requestId === downloadRequestIdRef.current) {
                downloadTaskRef.current = null;
                setDownloadPhase("error");
                toast.error(t("mv_player.download_failed"));
            }
        }
    };

    const sortedSources = useMemo(() => [...sources].sort((left, right) => {
        const leftHeight = left.height ?? 0;
        const rightHeight = right.height ?? 0;
        return rightHeight - leftHeight;
    }), [sources]);
    const activeSource = sources.find((source) => source.key === activeSourceKey);
    const activeQualityLabel = (activeSource?.label || activeSourceKey || "—")
        .toLocaleUpperCase("en-US");
    const displayLoading = loading
        || (nativeOpened && (!nativeFrameReady || !nativeSurfaceRevealed));
    const seekProgress = duration > 0 ? currentTime / duration * 100 : 0;
    const silent = muted || volume === 0;
    const downloadButtonTitle = downloadPhase === "downloading"
        ? t("mv_player.cancel_download")
        : downloadPhase === "done"
            ? t("mv_player.show_download")
            : downloadPhase === "error"
                ? t("mv_player.retry_download")
                : t("mv_player.download");
    const getSourceSizeLabel = (source: PlayerVideoSource) => {
        const declaredSize = formatVideoSize(source.size);
        if (declaredSize) return declaredSize;
        const state = sourceSizeState[source.key];
        if (typeof state === "number") return formatVideoSize(state);
        if (state === "loading") return t("mv_player.size_loading");
        if (state === "stream") return t("mv_player.size_stream");
        return t("mv_player.size_unknown");
    };
    const progressStyle = {
        "--mv-progress": `${seekProgress}%`,
        "--mv-buffered": `${seekProgress}%`,
    } as CSSProperties;
    const volumeStyle = {
        "--mv-volume": `${silent ? 0 : volume * 100}%`,
    } as CSSProperties;

    return (
        <Base
            animated={false}
            withBlur={false}
            onRequestClose={requestClose}
            initialFocusRef={playerRef}
        >
            <div
                ref={playerRef}
                className="modal--mv-player"
                tabIndex={-1}
                data-fullscreen={fullscreen ? "true" : "false"}
                data-native-surface-visible={surfaceVisible ? "true" : "false"}
                data-closing={closing ? "true" : undefined}
                data-exiting={exiting ? "true" : undefined}
                data-controls-visible={controlsVisible ? "true" : "false"}
                data-modal-layer-open={
                    qualityMenuOpen || speedMenuOpen || downloadMenuOpen ? "true" : undefined
                }
                onPointerMove={revealControls}
                onPointerDownCapture={(event) => {
                    revealControls();
                    const target = event.target as HTMLElement | null;
                    if (!target?.closest("button, input, [role^='menuitem']")) {
                        playerRef.current?.focus();
                    }
                }}
                onMouseLeave={() => {
                    if (!playing || qualityMenuOpen || speedMenuOpen || downloadMenuOpen) return;
                    clearControlsTimer();
                    setControlsVisible(false);
                }}
                onFocusCapture={revealControls}
            >
                {musicItem.coverImg || musicItem.artwork ? (
                    <img
                        className="mv-player-backdrop"
                        src={musicItem.coverImg || musicItem.artwork}
                        alt=""
                        aria-hidden="true"
                    ></img>
                ) : null}
                <div className="mv-player-scrim"></div>
                <div
                    ref={closeCurtainRef}
                    className="mv-player-close-curtain"
                    aria-hidden="true"
                ></div>
                <div className="mv-player-topbar">
                    <div className="mv-player-heading">
                        <span className="mv-player-kicker">
                            <span
                                className={`mv-player-status-dot${
                                    displayLoading ? " is-loading" : error ? " is-error" : ""
                                }`}
                                aria-hidden="true"
                            ></span>
                            <span>{t("mv_player.now_playing")}</span>
                        </span>
                        <strong title={musicItem.title}>{musicItem.title}</strong>
                        <span className="mv-player-subtitle">
                            <span title={musicItem.artist}>{musicItem.artist || musicItem.platform}</span>
                            <i aria-hidden="true">·</i>
                            <span className="mv-player-heading-quality">{activeQualityLabel}</span>
                        </span>
                    </div>
                    <div className="mv-player-topbar-actions">
                        <button
                            type="button"
                            className="mv-player-icon-button mv-player-close"
                            title={t("common.close")}
                            aria-label={t("common.close")}
                            disabled={closing}
                            onClick={requestClose}
                        >
                            <SvgAsset iconName="x-mark"></SvgAsset>
                        </button>
                    </div>
                </div>

                <div
                    className="mv-player-stage"
                    role="presentation"
                    onWheel={handleWheelVolume}
                    onClick={(event) => {
                        if (event.detail > 1) return;
                        if (stageClickTimerRef.current !== null) {
                            window.clearTimeout(stageClickTimerRef.current);
                        }
                        stageClickTimerRef.current = window.setTimeout(() => {
                            togglePlayback();
                            stageClickTimerRef.current = null;
                        }, 180);
                    }}
                    onDoubleClick={() => {
                        if (stageClickTimerRef.current !== null) {
                            window.clearTimeout(stageClickTimerRef.current);
                            stageClickTimerRef.current = null;
                        }
                        toggleFullscreen();
                    }}
                >
                    <div ref={surfaceRef} className="mv-player-native-surface" aria-hidden="true"></div>
                    {displayLoading && !error ? (
                        <div className="mv-player-state" aria-live="polite">
                            <span className="mv-player-spinner"></span>
                            <strong>{t("mv_player.loading")}</strong>
                        </div>
                    ) : null}
                    {error ? (
                        <div className="mv-player-state mv-player-error" aria-live="assertive">
                            <span className="mv-player-error-mark">!</span>
                            <strong>{t("mv_player.error")}</strong>
                            <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
                                {t("mv_player.retry")}
                            </button>
                        </div>
                    ) : null}
                    <output
                        className="mv-player-volume-indicator"
                        data-visible={wheelVolumeVisible ? "true" : "false"}
                        aria-hidden={wheelVolumeVisible ? undefined : "true"}
                        aria-label={!wheelVolumeVisible
                            ? undefined
                            : `${t("music_bar.volume")}: ${Math.round(wheelVolume * 100)}%`}
                    >
                        <SvgAsset
                            iconName={wheelVolume === 0 ? "speaker-x-mark" : "speaker-wave"}
                        ></SvgAsset>
                        <strong>{Math.round((wheelVolume ?? 0) * 100)}%</strong>
                    </output>
                    {!playing && !displayLoading && !error && !wheelVolumeVisible ? (
                        <button
                            type="button"
                            className="mv-player-center-play"
                            aria-label={t("music_bar.play")}
                            aria-keyshortcuts="Space K"
                            onClick={(event) => {
                                event.stopPropagation();
                                togglePlayback();
                            }}
                        >
                            <SvgAsset iconName="play"></SvgAsset>
                        </button>
                    ) : null}
                </div>

                <div className="mv-player-controls" onClick={(event) => event.stopPropagation()}>
                    <label
                        className="mv-player-progress"
                        style={progressStyle}
                        onPointerMove={(event) => {
                            if (duration <= 0) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            const percent = Math.max(0, Math.min(
                                1,
                                (event.clientX - rect.left) / rect.width,
                            ));
                            setSeekPreview({ percent: percent * 100, time: percent * duration });
                        }}
                        onPointerLeave={() => setSeekPreview(null)}
                    >
                        {seekPreview ? (
                            <output
                                className="mv-player-seek-preview"
                                style={{ left: `${seekPreview.percent}%` }}
                            >
                                {formatVideoTime(seekPreview.time)}
                            </output>
                        ) : null}
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.1}
                            value={Math.min(currentTime, duration || 0)}
                            aria-label={t("mv_player.playback_progress")}
                            aria-valuetext={`${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`}
                            onChange={(event) => {
                                const nextTime = Number(event.target.value);
                                setCurrentTime(nextTime);
                                void sendVideoCommand({ operation: "seek", seconds: nextTime });
                            }}
                        ></input>
                    </label>
                    <div className="mv-player-control-row">
                        <div className="mv-player-control-group">
                            <button
                                type="button"
                                className="mv-player-icon-button mv-player-transport"
                                title={playing ? t("music_bar.pause") : t("music_bar.play")}
                                aria-label={playing ? t("music_bar.pause") : t("music_bar.play")}
                                aria-keyshortcuts="Space K"
                                disabled={!nativeOpened}
                                onClick={togglePlayback}
                            >
                                <SvgAsset iconName={playing ? "pause" : "play"}></SvgAsset>
                            </button>
                            <div className="mv-player-volume-control">
                                <button
                                    type="button"
                                    className="mv-player-icon-button"
                                    title={silent ? t("music_bar.unmute") : t("music_bar.mute")}
                                    aria-label={silent ? t("music_bar.unmute") : t("music_bar.mute")}
                                    aria-keyshortcuts="M"
                                    onClick={toggleMuted}
                                >
                                    <SvgAsset iconName={silent ? "speaker-x-mark" : "speaker-wave"}></SvgAsset>
                                </button>
                                <label className="mv-player-volume" style={volumeStyle}>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={silent ? 0 : volume}
                                        aria-label={t("music_bar.volume")}
                                        aria-valuetext={`${Math.round((silent ? 0 : volume) * 100)}%`}
                                        onChange={(event) => updateVolume(Number(event.target.value))}
                                    ></input>
                                </label>
                            </div>
                            <span className="mv-player-time">
                                {formatVideoTime(currentTime)} <i>/</i> {formatVideoTime(duration)}
                            </span>
                        </div>
                        <div className="mv-player-control-group mv-player-control-group--right">
                            <div className={`mv-player-speed-picker${speedMenuOpen ? " is-open" : ""}`}>
                                <button
                                    type="button"
                                    className="mv-player-icon-button mv-player-speed-trigger"
                                    title={`${t("mv_player.playback_speed")}: ${speed}×`}
                                    aria-label={`${t("mv_player.playback_speed")}: ${speed}×`}
                                    aria-haspopup="menu"
                                    aria-expanded={speedMenuOpen}
                                    disabled={!nativeOpened}
                                    onClick={() => {
                                        setQualityMenuOpen(false);
                                        setDownloadMenuOpen(false);
                                        setSpeedMenuOpen((open) => !open);
                                    }}
                                >
                                    <SvgAsset iconName="mv-speed"></SvgAsset>
                                </button>
                                {speedMenuOpen ? (
                                    <div
                                        className="mv-player-quality-menu mv-player-speed-menu"
                                        role="menu"
                                        aria-label={t("mv_player.playback_speed")}
                                        onKeyDown={handleMenuNavigation}
                                    >
                                        {VIDEO_SPEED_PRESETS.map((preset) => (
                                            <button
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={preset === speed}
                                                className={`mv-player-quality-option mv-player-speed-option${
                                                    preset === speed ? " is-selected" : ""
                                                }`}
                                                key={preset}
                                                onClick={() => updateSpeed(preset)}
                                            >
                                                <span className="mv-player-quality-option-copy">
                                                    <strong>{preset}×</strong>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <div className={`mv-player-download-picker${downloadMenuOpen ? " is-open" : ""}`}>
                                <button
                                    type="button"
                                    className={`mv-player-icon-button mv-player-download mv-player-download--${
                                        downloadPhase
                                    }`}
                                    style={downloadPhase === "downloading"
                                        ? {
                                            "--download-progress": `${downloadPercent * 3.6}deg`,
                                        } as CSSProperties
                                        : undefined}
                                    title={downloadButtonTitle}
                                    aria-label={downloadButtonTitle}
                                    aria-haspopup="menu"
                                    aria-expanded={downloadMenuOpen}
                                    disabled={sources.length === 0 && downloadPhase !== "done"}
                                    onClick={() => void handleDownloadButton()}
                                >
                                    <SvgAsset iconName={
                                        downloadPhase === "done" ? "check" : "array-download-tray"
                                    }></SvgAsset>
                                    {downloadPhase === "downloading" ? (
                                        <span>{downloadPercent || "…"}</span>
                                    ) : null}
                                </button>
                                {downloadMenuOpen ? (
                                    <div
                                        ref={downloadMenuRef}
                                        className="mv-player-quality-menu mv-player-download-menu"
                                        role="menu"
                                        aria-label={t("mv_player.download")}
                                        onKeyDown={handleMenuNavigation}
                                    >
                                        {sortedSources.map((source) => {
                                            const dimensions = source.width && source.height
                                                ? `${source.width} × ${source.height}`
                                                : source.height ? `${source.height}p` : "";
                                            const range = source.dynamicRange === "dolby-vision"
                                                ? "Dolby Vision"
                                                : source.dynamicRange === "hdr10" ? "HDR10" : "";
                                            const optionMeta = [
                                                dimensions,
                                                source.codec,
                                                range,
                                            ].filter(Boolean).join(" · ");
                                            const sizeLabel = getSourceSizeLabel(source);
                                            return (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    aria-label={[
                                                        source.label,
                                                        sizeLabel,
                                                        optionMeta,
                                                    ].filter(Boolean).join(", ")}
                                                    className="mv-player-quality-option mv-player-download-option"
                                                    key={source.key}
                                                    onClick={() => void handleDownload(source)}
                                                >
                                                    <span className="mv-player-quality-option-copy">
                                                        <strong>{source.label.toLocaleUpperCase("en-US")}</strong>
                                                        {optionMeta ? <small>{optionMeta}</small> : null}
                                                    </span>
                                                    <span className="mv-player-quality-size">
                                                        {sizeLabel}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                            <div className={`mv-player-quality-picker${qualityMenuOpen ? " is-open" : ""}`}>
                                <button
                                    type="button"
                                    className="mv-player-icon-button mv-player-quality-trigger"
                                    title={`${t("mv_player.video_quality")}: ${activeQualityLabel}`}
                                    aria-label={`${t("mv_player.video_quality")}: ${activeQualityLabel}`}
                                    aria-haspopup="menu"
                                    aria-expanded={qualityMenuOpen}
                                    disabled={displayLoading || sources.length < 2}
                                    onClick={() => {
                                        setSpeedMenuOpen(false);
                                        setDownloadMenuOpen(false);
                                        setQualityMenuOpen((open) => !open);
                                    }}
                                >
                                    <SvgAsset iconName="cog-8-tooth"></SvgAsset>
                                </button>
                                {qualityMenuOpen ? (
                                    <div
                                        ref={qualityMenuRef}
                                        className="mv-player-quality-menu"
                                        role="menu"
                                        aria-label={t("mv_player.video_quality")}
                                        onKeyDown={handleMenuNavigation}
                                    >
                                        {sortedSources.map((source) => {
                                            const selected = source.key === activeSourceKey;
                                            const dimensions = source.width && source.height
                                                ? `${source.width} × ${source.height}`
                                                : source.height ? `${source.height}p` : "";
                                            const range = source.dynamicRange === "dolby-vision"
                                                ? "Dolby Vision"
                                                : source.dynamicRange === "hdr10" ? "HDR10" : "";
                                            const optionMeta = [
                                                dimensions,
                                                source.codec,
                                                range,
                                            ].filter(Boolean).join(" · ");
                                            const sizeLabel = getSourceSizeLabel(source);
                                            return (
                                                <button
                                                    type="button"
                                                    role="menuitemradio"
                                                    aria-checked={selected}
                                                    className={`mv-player-quality-option${selected ? " is-selected" : ""}`}
                                                    key={source.key}
                                                    onClick={() => {
                                                        setQualityMenuOpen(false);
                                                        if (selected || !nativeSessionId) return;
                                                        setLoading(true);
                                                        void nativePlayback.selectVideoSource({
                                                            sourceId: nativeSessionId,
                                                            sourceKey: source.key,
                                                        }).then(() => {
                                                            setActiveSourceKey(source.key);
                                                            setLoading(false);
                                                        }).catch((reason) => {
                                                            setLoading(false);
                                                            toast.error(reason instanceof Error
                                                                ? reason.message
                                                                : t("mv_player.error"));
                                                        });
                                                    }}
                                                >
                                                    <span className="mv-player-quality-option-copy">
                                                        <strong>{source.label.toLocaleUpperCase("en-US")}</strong>
                                                        {optionMeta ? <small>{optionMeta}</small> : null}
                                                    </span>
                                                    <span className="mv-player-quality-size">
                                                        {sizeLabel}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="mv-player-icon-button"
                                title={fullscreen ? t("mv_player.exit_fullscreen") : t("mv_player.fullscreen")}
                                aria-label={fullscreen ? t("mv_player.exit_fullscreen") : t("mv_player.fullscreen")}
                                aria-keyshortcuts="F"
                                onClick={toggleFullscreen}
                            >
                                <SvgAsset iconName={fullscreen ? "arrows-pointing-in" : "arrows-pointing-out"}></SvgAsset>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Base>
    );
}
