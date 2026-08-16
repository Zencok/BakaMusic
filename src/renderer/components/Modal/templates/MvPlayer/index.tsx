import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Hls from "hls.js";
import { secondsToDuration } from "@/common/time-util";
import SvgAsset from "@renderer/components/SvgAsset";
import trackPlayer from "@renderer/core/track-player";
import { getMediaPluginDelegate } from "@renderer/core/track-player/plugin-media";
import {
    startMusicVideoDownload,
    type IVideoDownloadTask,
} from "@renderer/utils/download-music-video";
import PluginManager from "@shared/plugin-manager/renderer";
import videoProxy from "@shared/video-proxy/renderer";
import { appWindowUtil, shellUtil } from "@shared/utils/renderer";
import Base from "../Base";
import { hideModal } from "../..";
import "./index.scss";

interface IMvPlayerProps {
    musicItem: IMusic.IMusicItem;
}

type PlayerSource = IPlugin.IVideoSourceResult & {
    url: string;
    downloadUrl: string;
    isHls: boolean;
};

type DownloadPhase = "idle" | "downloading" | "done" | "error";
type QualitySizeState = "loading" | "stream" | "unknown";
type PlayerQualityOption = IPlugin.IVideoQualityOption & {
    actualKey?: string;
    sourceFingerprint?: string;
};

const CONTROLS_IDLE_MS = 2400;

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

function getQualityLabel(option: IPlugin.IVideoQualityOption | undefined, key: string) {
    return (option?.label || key).toLocaleUpperCase("en-US");
}

function getQualityRank(option: IPlugin.IVideoQualityOption) {
    const qualityName = option.label || option.key;
    const labelHeight = /8k/i.test(qualityName)
        ? 4320
        : /4k/i.test(qualityName)
            ? 2160
            : Number.parseInt(qualityName, 10);
    return option.height
        || (Number.isFinite(labelHeight) ? labelHeight : 0)
        || option.width
        || option.bitrate
        || 0;
}

function formatVideoTime(value: number) {
    return Number.isFinite(value) && value >= 0 ? secondsToDuration(value) : "--:--";
}

function getBufferedPercent(video: HTMLVideoElement) {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.buffered.length === 0) {
        return 0;
    }
    return Math.min(100, video.buffered.end(video.buffered.length - 1) / video.duration * 100);
}

function isHlsVideoSource(source: IPlugin.IVideoSourceResult) {
    return /mpegurl|m3u8/i.test(source.mimeType ?? "")
        || /\.m3u8(?:$|[?#])/i.test(source.url ?? "");
}

function mergeVideoQualityOptions(
    ...groups: PlayerQualityOption[][]
): PlayerQualityOption[] {
    const merged = new Map<string, PlayerQualityOption>();
    for (const option of groups.flat()) {
        if (!option.key) continue;
        const definedEntries = Object.entries(option).filter(([, value]) => value !== undefined);
        merged.set(option.key, {
            ...merged.get(option.key),
            ...Object.fromEntries(definedEntries),
            key: option.key,
        });
    }
    return [...merged.values()];
}

function getVideoSourceFingerprint(source: IPlugin.IVideoSourceResult) {
    try {
        const parsed = new URL(source.url ?? "");
        return `${parsed.origin}${parsed.pathname}`.toLocaleLowerCase("en-US");
    } catch {
        return source.url?.split(/[?#]/, 1)[0]?.toLocaleLowerCase("en-US") || "";
    }
}

function dedupeVerifiedQualityOptions(
    options: PlayerQualityOption[],
    activeRequestKey: string,
) {
    const deduped: PlayerQualityOption[] = [];
    for (const option of options) {
        const duplicateIndex = deduped.findIndex((item) => (
            Boolean(option.actualKey && item.actualKey === option.actualKey)
            || Boolean(
                option.sourceFingerprint
                && item.sourceFingerprint === option.sourceFingerprint,
            )
        ));
        if (duplicateIndex < 0) {
            deduped.push(option);
            continue;
        }
        const current = deduped[duplicateIndex];
        const preferOption = option.key === activeRequestKey
            || (current.key !== activeRequestKey && !formatVideoSize(current.size));
        deduped[duplicateIndex] = preferOption
            ? mergeVideoQualityOptions([current], [option])[0]
            : mergeVideoQualityOptions([option], [current])[0];
    }
    return deduped;
}

async function probeProxyVideoSize(url: string) {
    const request = async (method: "HEAD" | "GET", headers?: HeadersInit) => fetch(url, {
        method,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
    });
    try {
        const head = await request("HEAD");
        const contentLength = Number(head.headers.get("content-length"));
        if (head.ok && Number.isFinite(contentLength) && contentLength > 0) return contentLength;

        const ranged = await request("GET", { Range: "bytes=0-0" });
        const total = Number(ranged.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]);
        await ranged.body?.cancel();
        return ranged.ok && Number.isFinite(total) && total > 0 ? total : undefined;
    } catch {
        return undefined;
    }
}

export default function MvPlayer({ musicItem }: IMvPlayerProps) {
    const { t } = useTranslation();
    const playerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const hlsRecoveryCountRef = useRef(0);
    const requestIdRef = useRef(0);
    const qualityContextRef = useRef<IMusic.IMusicItem | null>(null);
    const proxySessionRef = useRef<string | null>(null);
    const controlsTimerRef = useRef<number | null>(null);
    const stageClickTimerRef = useRef<number | null>(null);
    const qualityMenuRef = useRef<HTMLDivElement>(null);
    const downloadMenuRef = useRef<HTMLDivElement>(null);
    const downloadTaskRef = useRef<IVideoDownloadTask | null>(null);
    const downloadSessionRef = useRef<string | null>(null);
    const downloadRequestIdRef = useRef(0);
    const qualitySourceCacheRef = useRef(new Map<string, IPlugin.IVideoSourceResult>());
    const autoSelectHighestRef = useRef(true);
    const playbackIntentRef = useRef<{ currentTime: number; playing: boolean } | null>(null);
    const fullscreenRef = useRef(false);
    const fullscreenRequestedRef = useRef(false);
    const previousVolumeRef = useRef(0.82);
    const mountedRef = useRef(true);
    const artwork = musicItem.coverImg || musicItem.artwork;
    const [quality, setQuality] = useState(() => {
        const pluginReference = getMediaPluginDelegate(musicItem);
        const plugin = (pluginReference.hash
            ? PluginManager.getPluginByHash(pluginReference.hash)
            : undefined)
            ?? PluginManager.getPluginByPlatform(pluginReference.platform ?? "");
        const highestDeclaredQuality = (plugin?.supportedVideoQualities ?? [])
            .map((key) => ({ key, label: key }))
            .sort((left, right) => getQualityRank(right) - getQualityRank(left))[0];
        return highestDeclaredQuality?.key || musicItem.videoQuality || "1080p";
    });
    const [qualityOptions, setQualityOptions] = useState<PlayerQualityOption[]>([]);
    const [qualitySizeState, setQualitySizeState] = useState<Record<string, QualitySizeState>>({});
    const [source, setSource] = useState<PlayerSource | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedProgress, setBufferedProgress] = useState(0);
    const [seekPreview, setSeekPreview] = useState<{ percent: number; time: number } | null>(null);
    const [volume, setVolume] = useState(0.82);
    const [muted, setMuted] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>("idle");
    const [downloadPercent, setDownloadPercent] = useState(0);
    const [downloadedPath, setDownloadedPath] = useState("");
    const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
    const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

    const setFullscreenState = useCallback((next: boolean) => {
        fullscreenRef.current = next;
        setFullscreen(next);
    }, []);

    const clearControlsTimer = useCallback(() => {
        if (controlsTimerRef.current !== null) {
            window.clearTimeout(controlsTimerRef.current);
            controlsTimerRef.current = null;
        }
    }, []);

    const revealControls = useCallback(() => {
        clearControlsTimer();
        setControlsVisible(true);
        const activeElement = document.activeElement;
        const hasKeyboardFocus = activeElement instanceof HTMLElement
            && Boolean(playerRef.current?.contains(activeElement))
            && activeElement.matches(":focus-visible");
        if (playing && !qualityMenuOpen && !downloadMenuOpen && !hasKeyboardFocus) {
            controlsTimerRef.current = window.setTimeout(() => {
                setControlsVisible(false);
                controlsTimerRef.current = null;
            }, CONTROLS_IDLE_MS);
        }
    }, [clearControlsTimer, downloadMenuOpen, playing, qualityMenuOpen]);

    const togglePlayback = useCallback(() => {
        const video = videoRef.current;
        if (!video || error || loading) return;
        if (video.paused) {
            void video.play().catch(() => undefined);
        } else {
            video.pause();
        }
    }, [error, loading]);

    const exitFullscreen = useCallback(() => {
        fullscreenRequestedRef.current = false;
        if (document.fullscreenElement === playerRef.current) {
            void document.exitFullscreen().catch(() => undefined);
        }
        appWindowUtil.setMainWindowFullScreen?.(false);
        setFullscreenState(false);
        setControlsVisible(true);
    }, [setFullscreenState]);

    const enterFullscreen = useCallback(() => {
        const player = playerRef.current;
        if (!player) return;
        fullscreenRequestedRef.current = true;
        setFullscreenState(true);
        setControlsVisible(true);

        // BrowserWindow fullscreen removes the native window chrome. The element
        // fullscreen request then promotes only the player into Chromium's top
        // layer, so the app shell cannot remain visible around the video.
        appWindowUtil.setMainWindowFullScreen?.(true);
        void player.requestFullscreen().catch(() => {
            // Native fullscreen plus data-fullscreen CSS remains a complete
            // fallback on platforms that reject the element request.
        });
    }, [setFullscreenState]);

    const toggleFullscreen = useCallback(() => {
        if (fullscreenRef.current || document.fullscreenElement === playerRef.current) {
            exitFullscreen();
        } else {
            enterFullscreen();
        }
    }, [enterFullscreen, exitFullscreen]);

    const handleStageClick = useCallback((clickCount: number) => {
        if (stageClickTimerRef.current !== null) {
            window.clearTimeout(stageClickTimerRef.current);
            stageClickTimerRef.current = null;
        }
        if (clickCount > 1) return;
        stageClickTimerRef.current = window.setTimeout(() => {
            stageClickTimerRef.current = null;
            togglePlayback();
        }, 180);
    }, [togglePlayback]);

    const handleStageDoubleClick = useCallback(() => {
        if (stageClickTimerRef.current !== null) {
            window.clearTimeout(stageClickTimerRef.current);
            stageClickTimerRef.current = null;
        }
        toggleFullscreen();
    }, [toggleFullscreen]);

    const updateVolume = useCallback((nextVolume: number) => {
        const normalized = Math.max(0, Math.min(1, nextVolume));
        setVolume(normalized);
        if (normalized > 0) previousVolumeRef.current = normalized;
        const video = videoRef.current;
        if (video) {
            video.volume = normalized;
            if (normalized > 0) video.muted = false;
        }
        if (normalized > 0) setMuted(false);
    }, []);

    const handleWheelVolume = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".mv-player-quality-menu")) return;
        const direction = Math.sign(event.deltaY || event.deltaX);
        if (direction === 0) return;
        event.preventDefault();
        updateVolume((muted ? 0 : volume) - direction * 0.05);
        revealControls();
    }, [muted, revealControls, updateVolume, volume]);

    const toggleMuted = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.muted || video.volume === 0) {
            if (video.volume === 0) {
                video.volume = previousVolumeRef.current;
                setVolume(previousVolumeRef.current);
            }
            video.muted = false;
            setMuted(false);
        } else {
            video.muted = true;
            setMuted(true);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            downloadRequestIdRef.current = Number.MAX_SAFE_INTEGER;
            void downloadTaskRef.current?.cancel();
            downloadTaskRef.current = null;
            const downloadSession = downloadSessionRef.current;
            downloadSessionRef.current = null;
            if (downloadSession) void videoProxy.release(downloadSession);
            clearControlsTimer();
            if (stageClickTimerRef.current !== null) {
                window.clearTimeout(stageClickTimerRef.current);
                stageClickTimerRef.current = null;
            }
            if (fullscreenRequestedRef.current) {
                fullscreenRequestedRef.current = false;
                appWindowUtil.setMainWindowFullScreen?.(false);
            }
        };
    }, [clearControlsTimer]);

    useEffect(() => {
        if (playing) {
            revealControls();
        } else {
            clearControlsTimer();
            setControlsVisible(true);
        }
        return clearControlsTimer;
    }, [clearControlsTimer, playing, revealControls]);

    useEffect(() => {
        const player = playerRef.current;
        const syncElementFullscreen = () => {
            const elementFullscreen = document.fullscreenElement === player;
            if (elementFullscreen) {
                setFullscreenState(true);
            } else if (fullscreenRequestedRef.current) {
                // Escape exits the Chromium top layer first. Mirror that change
                // to the native BrowserWindow so fullscreen is one coherent mode.
                fullscreenRequestedRef.current = false;
                appWindowUtil.setMainWindowFullScreen?.(false);
                setFullscreenState(false);
            }
            setControlsVisible(true);
        };
        const unsubscribe = appWindowUtil.onMainWindowFullScreenChanged?.((enabled) => {
            const next = Boolean(enabled);
            setFullscreenState(next);
            setControlsVisible(true);
            if (!next && document.fullscreenElement === player) {
                fullscreenRequestedRef.current = false;
                void document.exitFullscreen().catch(() => undefined);
            }
        });
        void appWindowUtil.isMainWindowFullScreen?.().then((enabled) => {
            if (mountedRef.current && enabled) setFullscreenState(true);
        });
        document.addEventListener("fullscreenchange", syncElementFullscreen);
        return () => {
            unsubscribe?.();
            document.removeEventListener("fullscreenchange", syncElementFullscreen);
            if (document.fullscreenElement === player) {
                void document.exitFullscreen().catch(() => undefined);
            }
        };
    }, [setFullscreenState]);

    useEffect(() => {
        if (!qualityMenuOpen && !downloadMenuOpen) return undefined;
        clearControlsTimer();
        setControlsVisible(true);
        const focusFrame = window.requestAnimationFrame(() => {
            const menu = qualityMenuOpen ? qualityMenuRef.current : downloadMenuRef.current;
            const selected = menu?.querySelector<HTMLElement>("[aria-checked='true']");
            const first = menu?.querySelector<HTMLElement>("[role^='menuitem']");
            (selected ?? first)?.focus();
        });
        const closeMenu = (event: MouseEvent) => {
            const target = event.target;
            const qualityPicker = playerRef.current?.querySelector(".mv-player-quality-picker");
            const downloadPicker = playerRef.current?.querySelector(".mv-player-download-picker");
            if (target instanceof Node && (
                qualityPicker?.contains(target)
                || downloadPicker?.contains(target)
            )) return;
            setQualityMenuOpen(false);
            setDownloadMenuOpen(false);
        };
        document.addEventListener("mousedown", closeMenu);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener("mousedown", closeMenu);
        };
    }, [clearControlsTimer, downloadMenuOpen, qualityMenuOpen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const key = event.key.toLocaleLowerCase();
            if ((qualityMenuOpen || downloadMenuOpen) && key === "escape") {
                event.preventDefault();
                event.stopPropagation();
                setQualityMenuOpen(false);
                setDownloadMenuOpen(false);
                revealControls();
                return;
            }
            if (
                target instanceof HTMLInputElement
                || target instanceof HTMLSelectElement
                || target instanceof HTMLTextAreaElement
                || (target instanceof HTMLElement && (
                    target.isContentEditable
                    || Boolean(target.closest("button, a[href], [role='menuitemradio']"))
                ))
            ) return;
            const video = videoRef.current;
            if (!video) return;
            let handled = true;
            switch (key) {
                case " ":
                case "k":
                    event.preventDefault();
                    togglePlayback();
                    break;
                case "arrowleft":
                    event.preventDefault();
                    video.currentTime = Math.max(0, video.currentTime - 5);
                    setCurrentTime(video.currentTime);
                    break;
                case "arrowright":
                    event.preventDefault();
                    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
                    setCurrentTime(video.currentTime);
                    break;
                case "j":
                    event.preventDefault();
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    setCurrentTime(video.currentTime);
                    break;
                case "l":
                    event.preventDefault();
                    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
                    setCurrentTime(video.currentTime);
                    break;
                case "arrowup":
                    event.preventDefault();
                    updateVolume(volume + 0.05);
                    break;
                case "arrowdown":
                    event.preventDefault();
                    updateVolume(volume - 0.05);
                    break;
                case "m":
                    event.preventDefault();
                    toggleMuted();
                    break;
                case "f":
                    event.preventDefault();
                    toggleFullscreen();
                    break;
                default:
                    handled = false;
            }
            if (handled) revealControls();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        qualityMenuOpen,
        downloadMenuOpen,
        revealControls,
        toggleFullscreen,
        toggleMuted,
        togglePlayback,
        updateVolume,
        volume,
    ]);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        let canceled = false;
        setLoading(true);
        setError(false);
        setSource(null);
        setQualityMenuOpen(false);
        setDownloadMenuOpen(false);
        setCurrentTime(0);
        setDuration(0);
        setBufferedProgress(0);
        setSeekPreview(null);
        const previousSession = proxySessionRef.current;
        proxySessionRef.current = null;
        if (previousSession) void videoProxy.release(previousSession);

        const pluginReference = getMediaPluginDelegate(musicItem);
        const plugin = (pluginReference.hash
            ? PluginManager.getPluginByHash(pluginReference.hash)
            : undefined)
            ?? PluginManager.getPluginByPlatform(pluginReference.platform ?? "");
        const declaredOptions: PlayerQualityOption[] = (plugin?.supportedVideoQualities ?? [])
            .map((key) => ({ key, label: key }))
            .sort((left, right) => getQualityRank(right) - getQualityRank(left));
        const isNewMusic = qualityContextRef.current !== musicItem;
        qualityContextRef.current = musicItem;
        if (isNewMusic) {
            autoSelectHighestRef.current = true;
            qualitySourceCacheRef.current.clear();
            setQualityOptions([]);
            setQualitySizeState({});
            setDownloadMenuOpen(false);
            setDownloadPhase("idle");
            setDownloadPercent(0);
            setDownloadedPath("");
            downloadRequestIdRef.current++;
            void downloadTaskRef.current?.cancel();
            downloadTaskRef.current = null;
            const downloadSession = downloadSessionRef.current;
            downloadSessionRef.current = null;
            if (downloadSession) void videoProxy.release(downloadSession);

            const preferredQuality = declaredOptions[0]?.key || musicItem.videoQuality || quality;
            if (preferredQuality !== quality) {
                setQuality(preferredQuality);
                return undefined;
            }
        }

        void PluginManager.callPluginDelegateMethod(
            pluginReference,
            "getMvSource",
            musicItem,
            quality,
        ).then(async (result) => {
            if (canceled || requestId !== requestIdRef.current) return;
            if (!result?.url) throw new Error("MV source unavailable");
            const session = await videoProxy.register({
                url: result.url,
                headers: result.headers,
                userAgent: result.userAgent,
                mimeType: result.mimeType,
                backupUrls: result.backupUrls,
            });
            if (canceled || requestId !== requestIdRef.current) {
                void videoProxy.release(session.id);
                return;
            }
            proxySessionRef.current = session.id;
            const actualQuality = result.videoQuality || quality;
            qualitySourceCacheRef.current.set(quality, result);
            const currentOption: PlayerQualityOption = {
                key: quality,
                label: actualQuality,
                actualKey: actualQuality,
                sourceFingerprint: getVideoSourceFingerprint(result),
                width: result.width,
                height: result.height,
                bitrate: result.bitrate,
                size: result.size,
                codec: result.codec,
                mimeType: result.mimeType,
            };
            const probeOptions = mergeVideoQualityOptions(
                declaredOptions,
                result.availableVideoQualities ?? [],
                [{ key: quality, label: quality }],
            );
            setQualityOptions((previous) => dedupeVerifiedQualityOptions(
                mergeVideoQualityOptions(previous, [currentOption]),
                quality,
            ));
            setQualitySizeState((previous) => ({
                ...previous,
                [quality]: formatVideoSize(result.size)
                    ? previous[quality]
                    : isHlsVideoSource(result) ? "stream" : "loading",
            }));
            setSource({
                ...result,
                url: session.url,
                downloadUrl: session.downloadUrl,
                isHls: isHlsVideoSource(result),
            });

            const updateSizeState = (key: string, state?: QualitySizeState) => {
                if (canceled || requestId !== requestIdRef.current) return;
                setQualitySizeState((previous) => {
                    const next = { ...previous };
                    if (state) next[key] = state;
                    else delete next[key];
                    return next;
                });
            };
            void (async () => {
                const verifiedThisPass: PlayerQualityOption[] = [currentOption];
                const pendingOptions = [...probeOptions].sort((left, right) => {
                    if (left.key === quality) return -1;
                    if (right.key === quality) return 1;
                    return getQualityRank(right) - getQualityRank(left);
                });
                let nextOptionIndex = 0;
                const hydrateOption = async (option: PlayerQualityOption) => {
                    if (canceled || requestId !== requestIdRef.current) return;
                    updateSizeState(option.key, "loading");
                    const candidate = option.key === quality
                        ? result
                        : await PluginManager.callPluginDelegateMethod(
                            pluginReference,
                            "getMvSource",
                            musicItem,
                            option.key,
                        ).catch(() => null);
                    if (canceled || requestId !== requestIdRef.current) return;
                    if (!candidate?.url) {
                        updateSizeState(option.key);
                        return;
                    }
                    qualitySourceCacheRef.current.set(option.key, candidate);

                    const candidateIsHls = isHlsVideoSource(candidate);
                    let candidateSize = candidate.size || option.size;
                    let temporarySessionId: string | null = null;
                    if (!formatVideoSize(candidateSize) && !candidateIsHls) {
                        let sizeUrl = option.key === quality ? session.downloadUrl : "";
                        if (!sizeUrl) {
                            try {
                                const temporarySession = await videoProxy.register({
                                    url: candidate.url,
                                    headers: candidate.headers,
                                    userAgent: candidate.userAgent,
                                    mimeType: candidate.mimeType,
                                    backupUrls: candidate.backupUrls,
                                });
                                temporarySessionId = temporarySession.id;
                                sizeUrl = temporarySession.downloadUrl;
                            } catch {
                                sizeUrl = "";
                            }
                        }
                        if (sizeUrl) candidateSize = await probeProxyVideoSize(sizeUrl);
                    }
                    if (temporarySessionId) {
                        await videoProxy.release(temporarySessionId).catch(() => undefined);
                    }
                    if (canceled || requestId !== requestIdRef.current) return;

                    const candidateActualQuality = candidate.videoQuality
                        || (candidate.height ? `${candidate.height}p` : option.label || option.key);
                    const verifiedOption: PlayerQualityOption = {
                        key: option.key,
                        label: candidateActualQuality,
                        actualKey: candidateActualQuality,
                        sourceFingerprint: getVideoSourceFingerprint(candidate),
                        width: candidate.width,
                        height: candidate.height,
                        bitrate: candidate.bitrate,
                        size: candidateSize,
                        codec: candidate.codec,
                        mimeType: candidate.mimeType,
                    };
                    const existingIndex = verifiedThisPass.findIndex((item) => item.key === option.key);
                    if (existingIndex >= 0) verifiedThisPass[existingIndex] = verifiedOption;
                    else verifiedThisPass.push(verifiedOption);
                    setQualityOptions((previous) => dedupeVerifiedQualityOptions(
                        mergeVideoQualityOptions(previous, [verifiedOption]),
                        quality,
                    ));
                    updateSizeState(
                        option.key,
                        formatVideoSize(candidateSize)
                            ? undefined
                            : candidateIsHls ? "stream" : "unknown",
                    );
                };
                const hydrateWorker = async () => {
                    while (nextOptionIndex < pendingOptions.length) {
                        const option = pendingOptions[nextOptionIndex++];
                        if (option) await hydrateOption(option);
                    }
                };
                await Promise.all(Array.from(
                    { length: Math.min(3, pendingOptions.length) },
                    () => hydrateWorker(),
                ));
                if (canceled || requestId !== requestIdRef.current) return;
                const verifiedOptions = dedupeVerifiedQualityOptions(verifiedThisPass, quality);
                setQualityOptions((previous) => dedupeVerifiedQualityOptions(
                    mergeVideoQualityOptions(previous, verifiedOptions),
                    quality,
                ));
                const highestVerified = [...verifiedOptions]
                    .sort((left, right) => getQualityRank(right) - getQualityRank(left))[0];
                const activeVerified = verifiedOptions.find((option) => option.key === quality);
                if (
                    autoSelectHighestRef.current
                    && highestVerified
                    && highestVerified.key !== quality
                    && getQualityRank(highestVerified) > getQualityRank(activeVerified ?? currentOption)
                ) {
                    autoSelectHighestRef.current = false;
                    setQuality(highestVerified.key);
                } else {
                    autoSelectHighestRef.current = false;
                }
            })();
        }).catch(() => {
            if (!canceled && requestId === requestIdRef.current) {
                const currentIndex = declaredOptions.findIndex((option) => option.key === quality);
                const fallbackQuality = autoSelectHighestRef.current
                    ? declaredOptions[currentIndex + 1]?.key
                    : undefined;
                if (fallbackQuality) {
                    setQuality(fallbackQuality);
                } else {
                    autoSelectHighestRef.current = false;
                    setError(true);
                    setLoading(false);
                }
            }
        });

        return () => {
            canceled = true;
            const sessionId = proxySessionRef.current;
            proxySessionRef.current = null;
            if (sessionId) void videoProxy.release(sessionId);
        };
    }, [musicItem, quality, retryToken]);

    useEffect(() => {
        const video = videoRef.current;
        if (!source?.url || !video) return;
        setLoading(true);
        setError(false);
        hlsRef.current?.destroy();
        hlsRef.current = null;
        hlsRecoveryCountRef.current = 0;
        video.volume = volume;
        video.muted = muted;
        const shouldPlay = playbackIntentRef.current?.playing ?? true;
        const playVideo = () => {
            if (shouldPlay) {
                void video.play().catch(() => undefined);
            }
        };
        if (source.isHls && Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                maxBufferLength: 36,
                backBufferLength: 30,
            });
            hlsRef.current = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                hlsRecoveryCountRef.current = 0;
                trackPlayer.pause();
                playVideo();
            });
            hls.on(Hls.Events.FRAG_LOADED, () => {
                hlsRecoveryCountRef.current = 0;
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal) return;
                if (hlsRecoveryCountRef.current < 2) {
                    hlsRecoveryCountRef.current++;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        hls.startLoad();
                        return;
                    }
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                        return;
                    }
                }
                hls.destroy();
                hlsRef.current = null;
                setLoading(false);
                setError(true);
            });
            hls.loadSource(source.url);
            hls.attachMedia(video);
        } else {
            video.src = source.url;
            video.load();
            trackPlayer.pause();
            playVideo();
        }
        return () => {
            hlsRef.current?.destroy();
            hlsRef.current = null;
            video.pause();
            video.removeAttribute("src");
            video.load();
        };
    // Volume is applied imperatively and must not reload the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source]);

    const handleDownloadButton = async () => {
        if (downloadPhase === "done" && downloadedPath) {
            await shellUtil.showItemInFolder(downloadedPath);
            return;
        }
        if (downloadPhase === "downloading") {
            downloadRequestIdRef.current++;
            await downloadTaskRef.current?.cancel();
            downloadTaskRef.current = null;
            const downloadSession = downloadSessionRef.current;
            downloadSessionRef.current = null;
            if (downloadSession) await videoProxy.release(downloadSession).catch(() => undefined);
            setDownloadPhase("idle");
            setDownloadPercent(0);
            toast.info(t("mv_player.download_canceled"));
            return;
        }
        setQualityMenuOpen(false);
        setDownloadMenuOpen((open) => !open);
    };

    const handleDownload = async (option: PlayerQualityOption) => {
        const requestId = ++downloadRequestIdRef.current;
        setDownloadMenuOpen(false);
        setDownloadPhase("downloading");
        setDownloadPercent(0);
        setDownloadedPath("");

        const pluginReference = getMediaPluginDelegate(musicItem);
        try {
            const candidate = qualitySourceCacheRef.current.get(option.key)
                ?? await PluginManager.callPluginDelegateMethod(
                    pluginReference,
                    "getMvSource",
                    musicItem,
                    option.key,
                );
            if (requestId !== downloadRequestIdRef.current || !mountedRef.current) return;
            if (!candidate?.url) throw new Error("MV download source unavailable");
            qualitySourceCacheRef.current.set(option.key, candidate);

            const session = await videoProxy.register({
                url: candidate.url,
                headers: candidate.headers,
                userAgent: candidate.userAgent,
                mimeType: candidate.mimeType,
                backupUrls: candidate.backupUrls,
            });
            if (requestId !== downloadRequestIdRef.current || !mountedRef.current) {
                await videoProxy.release(session.id).catch(() => undefined);
                return;
            }
            downloadSessionRef.current = session.id;

            const downloadQuality = candidate.videoQuality || option.actualKey || option.key;
            const task = startMusicVideoDownload(
                musicItem,
                session.downloadUrl,
                downloadQuality,
                (progress) => {
                    if (!mountedRef.current || requestId !== downloadRequestIdRef.current) return;
                    if (progress.total && progress.downloaded !== undefined) {
                        setDownloadPercent(Math.min(100, Math.round(progress.downloaded / progress.total * 100)));
                    }
                },
            );
            downloadTaskRef.current = task;
            const filePath = await task.completion;
            if (downloadTaskRef.current === task) {
                downloadTaskRef.current = null;
            }
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
        } finally {
            const downloadSession = downloadSessionRef.current;
            if (downloadSession && requestId === downloadRequestIdRef.current) {
                downloadSessionRef.current = null;
                await videoProxy.release(downloadSession).catch(() => undefined);
            }
        }
    };

    const sortedQualityOptions = useMemo(() => [...qualityOptions].sort((left, right) => (
        getQualityRank(right) - getQualityRank(left)
    )), [qualityOptions]);
    const activeQuality = qualityOptions.find((item) => item.key === quality)
        ?? qualityOptions.find((item) => item.actualKey === source?.videoQuality);
    const activeQualityKey = activeQuality?.key || quality;
    const activeQualityLabel = getQualityLabel(activeQuality, source?.videoQuality || quality);
    const seekProgress = duration > 0 ? currentTime / duration * 100 : 0;
    const silent = muted || volume === 0;
    const downloadButtonTitle = downloadPhase === "downloading"
        ? t("mv_player.cancel_download")
        : downloadPhase === "done"
            ? t("mv_player.show_download")
            : downloadPhase === "error"
                ? t("mv_player.retry_download")
                : t("mv_player.download");
    const progressStyle = {
        "--mv-progress": `${seekProgress}%`,
        "--mv-buffered": `${bufferedProgress}%`,
    } as CSSProperties;
    const volumeStyle = { "--mv-volume": `${silent ? 0 : volume * 100}%` } as CSSProperties;

    return (
        <Base withBlur={false} defaultClose>
            <div
                ref={playerRef}
                className="modal--mv-player"
                data-fullscreen={fullscreen ? "true" : "false"}
                data-controls-visible={controlsVisible ? "true" : "false"}
                data-modal-layer-open={qualityMenuOpen || downloadMenuOpen ? "true" : undefined}
                onMouseMove={revealControls}
                onWheel={handleWheelVolume}
                onMouseLeave={() => {
                    if (!playing || qualityMenuOpen || downloadMenuOpen) return;
                    clearControlsTimer();
                    setControlsVisible(false);
                }}
                onFocusCapture={revealControls}
            >
                {artwork ? <img className="mv-player-backdrop" src={artwork} alt="" aria-hidden="true"></img> : null}
                <div className="mv-player-scrim"></div>
                <div className="mv-player-topbar">
                    <div className="mv-player-heading">
                        <strong title={musicItem.title}>{musicItem.title}</strong>
                        <span className="mv-player-subtitle">
                            <span title={musicItem.artist}>{musicItem.artist || musicItem.platform}</span>
                            <i aria-hidden="true">·</i>
                            <span className="mv-player-heading-quality">{activeQualityLabel}</span>
                        </span>
                    </div>
                    <button
                        type="button"
                        className="mv-player-icon-button mv-player-close"
                        title={t("common.close")}
                        aria-label={t("common.close")}
                        onClick={hideModal}
                    >
                        <SvgAsset iconName="x-mark"></SvgAsset>
                    </button>
                </div>

                <div
                    className="mv-player-stage"
                    role="presentation"
                    onClick={(event) => handleStageClick(event.detail)}
                    onDoubleClick={handleStageDoubleClick}
                >
                    {source?.url ? (
                        <video
                            ref={videoRef}
                            className="mv-player-video"
                            playsInline
                            preload="metadata"
                            crossOrigin="anonymous"
                            onLoadStart={() => setLoading(true)}
                            onLoadedMetadata={(event) => {
                                const nextDuration = event.currentTarget.duration || source.duration || 0;
                                setDuration(nextDuration);
                                setBufferedProgress(getBufferedPercent(event.currentTarget));
                                const playbackIntent = playbackIntentRef.current;
                                if (playbackIntent) {
                                    const nextTime = Math.min(
                                        playbackIntent.currentTime,
                                        Number.isFinite(nextDuration) && nextDuration > 0
                                            ? nextDuration
                                            : playbackIntent.currentTime,
                                    );
                                    event.currentTarget.currentTime = nextTime;
                                    setCurrentTime(nextTime);
                                    playbackIntentRef.current = null;
                                }
                            }}
                            onDurationChange={(event) => {
                                setDuration(event.currentTarget.duration || 0);
                                setBufferedProgress(getBufferedPercent(event.currentTarget));
                            }}
                            onProgress={(event) => setBufferedProgress(getBufferedPercent(event.currentTarget))}
                            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                            onPlaying={() => {
                                setPlaying(true);
                                setLoading(false);
                                setError(false);
                                revealControls();
                            }}
                            onPause={() => {
                                setPlaying(false);
                                setControlsVisible(true);
                            }}
                            onWaiting={() => setLoading(true)}
                            onCanPlay={() => setLoading(false)}
                            onEnded={() => {
                                setPlaying(false);
                                setControlsVisible(true);
                            }}
                            onVolumeChange={(event) => {
                                setVolume(event.currentTarget.volume);
                                setMuted(event.currentTarget.muted);
                            }}
                            onError={() => {
                                setLoading(false);
                                setError(true);
                                toast.error(t("mv_player.error"));
                            }}
                        >
                            <track kind="captions" srcLang="en" label={t("mv_player.captions")} src="data:text/vtt,WEBVTT%0A%0A"></track>
                        </video>
                    ) : null}

                    {loading && !error ? (
                        <div className="mv-player-state" aria-live="polite">
                            <span className="mv-player-spinner"></span>
                            <span>{t("mv_player.loading")}</span>
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
                    {!playing && !loading && !error ? (
                        <button
                            type="button"
                            className="mv-player-center-play"
                            aria-label={t("music_bar.play")}
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
                            const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
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
                            onChange={(event) => {
                                const nextTime = Number(event.target.value);
                                if (videoRef.current) videoRef.current.currentTime = nextTime;
                                setCurrentTime(nextTime);
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
                                        value={muted ? 0 : volume}
                                        aria-label={t("music_bar.volume")}
                                        onChange={(event) => updateVolume(Number(event.target.value))}
                                    ></input>
                                </label>
                            </div>
                            <span className="mv-player-time">
                                {formatVideoTime(currentTime)} <i>/</i> {formatVideoTime(duration)}
                            </span>
                        </div>
                        <div className="mv-player-control-group mv-player-control-group--right">
                            <div className={`mv-player-download-picker${downloadMenuOpen ? " is-open" : ""}`}>
                                <button
                                    type="button"
                                    className={`mv-player-icon-button mv-player-download mv-player-download--${downloadPhase}`}
                                    style={downloadPhase === "downloading"
                                        ? { "--download-progress": `${downloadPercent * 3.6}deg` } as CSSProperties
                                        : undefined}
                                    title={downloadButtonTitle}
                                    aria-label={downloadButtonTitle}
                                    aria-haspopup="menu"
                                    aria-expanded={downloadMenuOpen}
                                    disabled={qualityOptions.length === 0 && downloadPhase !== "done"}
                                    onClick={() => void handleDownloadButton()}
                                >
                                    <SvgAsset iconName={downloadPhase === "done" ? "check" : "array-download-tray"}></SvgAsset>
                                    {downloadPhase === "downloading" ? <span>{downloadPercent || "…"}</span> : null}
                                </button>
                                {qualityOptions.length > 0 && downloadMenuOpen ? (
                                    <div
                                        ref={downloadMenuRef}
                                        className="mv-player-quality-menu mv-player-download-menu"
                                        role="menu"
                                        aria-label={t("mv_player.download")}
                                        onKeyDown={(event) => {
                                            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                                "[role='menuitem']",
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
                                        }}
                                    >
                                        {sortedQualityOptions.map((item) => {
                                            const label = getQualityLabel(item, item.actualKey || item.key);
                                            const dimensions = item.width && item.height
                                                ? `${item.width} × ${item.height}`
                                                : item.height ? `${item.height}p` : "";
                                            const itemSize = formatVideoSize(item.size);
                                            const itemSizeState = qualitySizeState[item.key];
                                            const itemSizeLabel = itemSize
                                                || (itemSizeState === "loading"
                                                    ? t("mv_player.size_loading")
                                                    : itemSizeState === "stream"
                                                        ? t("mv_player.size_stream")
                                                        : t("mv_player.size_unknown"));
                                            const optionMeta = [dimensions, item.codec].filter(Boolean).join(" · ");
                                            return (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    aria-label={[label, itemSizeLabel, optionMeta].filter(Boolean).join(", ")}
                                                    className="mv-player-quality-option mv-player-download-option"
                                                    key={item.key}
                                                    onClick={() => void handleDownload(item)}
                                                >
                                                    <span className="mv-player-quality-option-copy">
                                                        <strong>{label}</strong>
                                                        {optionMeta ? <small>{optionMeta}</small> : null}
                                                    </span>
                                                    <span
                                                        className="mv-player-quality-size"
                                                        data-state={itemSize ? "ready" : itemSizeState || "unknown"}
                                                    >
                                                        {itemSizeLabel}
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
                                    disabled={loading || qualityOptions.length === 0}
                                    onClick={() => {
                                        setDownloadMenuOpen(false);
                                        setQualityMenuOpen((open) => !open);
                                    }}
                                >
                                    <SvgAsset iconName="cog-8-tooth"></SvgAsset>
                                </button>
                                {qualityOptions.length > 0 && qualityMenuOpen ? (
                                    <div
                                        ref={qualityMenuRef}
                                        className="mv-player-quality-menu"
                                        role="menu"
                                        aria-label={t("mv_player.video_quality")}
                                        onKeyDown={(event) => {
                                            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                                "[role='menuitemradio']",
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
                                        }}
                                    >
                                        {sortedQualityOptions.map((item) => {
                                            const label = getQualityLabel(item, item.actualKey || item.key);
                                            const dimensions = item.width && item.height
                                                ? `${item.width} × ${item.height}`
                                                : item.height ? `${item.height}p` : "";
                                            const selected = item.key === activeQualityKey;
                                            const itemSize = formatVideoSize(item.size || (selected ? source?.size : undefined));
                                            const itemSizeState = qualitySizeState[item.key];
                                            const itemSizeLabel = itemSize
                                                || (itemSizeState === "loading"
                                                    ? t("mv_player.size_loading")
                                                    : itemSizeState === "stream"
                                                        ? t("mv_player.size_stream")
                                                        : t("mv_player.size_unknown"));
                                            const optionMeta = [dimensions, item.codec].filter(Boolean).join(" · ");
                                            return (
                                                <button
                                                    type="button"
                                                    role="menuitemradio"
                                                    aria-checked={selected}
                                                    aria-label={[label, itemSizeLabel, optionMeta].filter(Boolean).join(", ")}
                                                    className={`mv-player-quality-option${selected ? " is-selected" : ""}`}
                                                    key={item.key}
                                                    onClick={() => {
                                                        autoSelectHighestRef.current = false;
                                                        if (!selected) {
                                                            const video = videoRef.current;
                                                            playbackIntentRef.current = {
                                                                currentTime: video?.currentTime ?? currentTime,
                                                                playing: video ? !video.paused : playing,
                                                            };
                                                            setQuality(item.key);
                                                            setDownloadPhase("idle");
                                                            setDownloadPercent(0);
                                                            setDownloadedPath("");
                                                        }
                                                        setQualityMenuOpen(false);
                                                    }}
                                                >
                                                    <span className="mv-player-quality-option-copy">
                                                        <strong>{label}</strong>
                                                        {optionMeta ? <small>{optionMeta}</small> : null}
                                                    </span>
                                                    <span
                                                        className="mv-player-quality-size"
                                                        data-state={itemSize ? "ready" : itemSizeState || "unknown"}
                                                    >
                                                        {itemSizeLabel}
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
