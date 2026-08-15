import PluginManager from "@shared/plugin-manager/renderer";
import logger from "@shared/logger/renderer";
import AppConfig from "@shared/app-config/renderer";
import { getQualityOrder } from "@/common/media-util";
import {
    bindMediaToPlugin,
    cachePrefetchedMediaSource,
    getMediaPluginDelegate,
} from "@renderer/core/track-player/plugin-media";

export const RECOGNIZE_MAX_SECONDS = 10;
export const RECOGNIZE_SAMPLE_RATE = 8_000;
export const RECOGNIZE_CANCELLED = "识别已取消";

export interface RecognizeMatch {
    musicItem: IMusic.IMusicItem;
    confidence: number;
    platform: string;
}

interface CaptureResult {
    base64: string;
    sampleRate: number;
    channels: number;
}

let activeCapture: {
    stop: () => void;
} | null = null;

function toBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

function downsampleToPcm(samples: Float32Array, inputRate: number) {
    const ratio = inputRate / RECOGNIZE_SAMPLE_RATE;
    const outputLength = Math.max(1, Math.floor(samples.length / ratio));
    const pcm = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index++) {
        const start = Math.floor(index * ratio);
        const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
        let sum = 0;
        for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
            sum += samples[sourceIndex];
        }
        const sample = Math.max(-1, Math.min(1, sum / (end - start)));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return new Uint8Array(pcm.buffer);
}

/** 捕获桌面共享中的系统音频，并转换为酷狗接口要求的 PCM。 */
async function captureSystemAudio(): Promise<CaptureResult> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("当前环境不支持系统音频捕获");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 2, height: 2, frameRate: 1 },
        audio: true,
    });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("未选择系统音频，请在共享窗口中勾选音频");
    }

    const AudioContextCtor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("当前环境不支持音频采样");
    }
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 2, 1);
    const silence = context.createGain();
    silence.gain.value = 0;
    const chunks: Float32Array[] = [];
    let stopped = false;
    let timer: number | null = null;
    let resolveCapture: ((value: CaptureResult) => void) | undefined;
    let rejectCapture: ((reason: unknown) => void) | undefined;

    const finish = (error?: Error) => {
        if (stopped) return;
        stopped = true;
        if (timer !== null) window.clearTimeout(timer);
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        silence.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        activeCapture = null;
        if (error) {
            rejectCapture?.(error);
            return;
        }
        const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const samples = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            samples.set(chunk, offset);
            offset += chunk.length;
        }
        const pcm = downsampleToPcm(samples, context.sampleRate);
        resolveCapture?.({
            base64: toBase64(pcm),
            sampleRate: RECOGNIZE_SAMPLE_RATE,
            channels: 1,
        });
    };

    const capturePromise = new Promise<CaptureResult>((resolve, reject) => {
        resolveCapture = resolve;
        rejectCapture = reject;
    });
    processor.onaudioprocess = (event) => {
        if (stopped) return;
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
    };
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
    await context.resume();
    timer = window.setTimeout(() => finish(), RECOGNIZE_MAX_SECONDS * 1000);
    activeCapture = { stop: () => finish(new Error(RECOGNIZE_CANCELLED)) };
    return capturePromise;
}

function normalizeMatch(
    item: IPlugin.IRecognizeItem,
    plugin: IPlugin.IPluginDelegate,
): RecognizeMatch | null {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = String(raw.title ?? raw.name ?? raw.songname ?? "").trim();
    const artist = String(raw.artist ?? raw.singer ?? raw.singername ?? raw.author_name ?? "").trim();
    const isKugou = /酷狗|kugou/i.test(plugin.platform);
    // KuGou's getMediaSource uses the file hash as its primary identifier;
    // album_audio_id is retained as an alias for getMusicInfo and lyrics.
    const id = String(
        (isKugou ? raw.hash : undefined)
        ?? raw.id
        ?? raw.songmid
        ?? raw.songid
        ?? raw.hash
        ?? `${title}-${artist}`,
    ).trim();
    if (!title || !id) return null;
    const platform = plugin.platform;
    const duration = Number(raw.duration ?? 0);
    const musicItem = bindMediaToPlugin({
        ...raw,
        id,
        platform,
        title,
        artist,
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
        ...(raw.album !== undefined ? { album: String(raw.album) } : {}),
        ...(raw.artwork !== undefined ? { artwork: String(raw.artwork) } : {}),
    } as unknown as IMusic.IMusicItem, plugin);
    const confidenceRaw = Number(raw.confidence);
    return {
        musicItem,
        confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0,
        platform,
    };
}

function pickString(...values: unknown[]) {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
    }
    return "";
}

async function hydrateRecognizeMatch(
    match: RecognizeMatch,
    plugin: IPlugin.IPluginDelegate,
): Promise<RecognizeMatch> {
    let musicItem = match.musicItem;
    try {
        const musicInfo = await PluginManager.callPluginDelegateMethod(
            plugin,
            "getMusicInfo",
            musicItem,
        );
        if (musicInfo && typeof musicInfo === "object") {
            const info = musicInfo as Record<string, unknown>;
            const isKugou = /酷狗|kugou/i.test(plugin.platform);
            musicItem = bindMediaToPlugin({
                ...musicItem,
                ...info,
                ...(pickString(info.hash, musicItem.hash)
                    ? { hash: pickString(info.hash, musicItem.hash) }
                    : {}),
                id: isKugou
                    ? pickString(musicItem.hash, info.id, musicItem.id)
                    : pickString(info.id, musicItem.hash, musicItem.id),
                platform: plugin.platform,
                title: pickString(info.title, musicItem.title),
                artist: pickString(info.artist, musicItem.artist),
                ...(pickString(info.album, musicItem.album)
                    ? { album: pickString(info.album, musicItem.album) }
                    : {}),
            } as IMusic.IMusicItem, plugin);
        }
    } catch (error) {
        logger.logError(
            `[Recognize] ${plugin.platform} music info failed`,
            error instanceof Error ? error : new Error(String(error)),
        );
    }

    // Resolve the same quality order used by TrackPlayer. The first valid
    // source is cached for the play button, avoiding a second vkey request.
    const defaultQuality = AppConfig.getConfig("playMusic.defaultQuality") ?? "128k";
    const fallbackMode = AppConfig.getConfig("playMusic.whenQualityMissing") ?? "lower";
    const qualityOrder = PluginManager.filterMediaQualityOrder(
        musicItem,
        getQualityOrder(defaultQuality, fallbackMode),
    );
    for (const quality of qualityOrder.length ? qualityOrder : [defaultQuality]) {
        try {
            const mediaSource = await PluginManager.callPluginDelegateMethod(
                plugin,
                "getMediaSource",
                musicItem,
                quality,
            );
            if (mediaSource?.url) {
                cachePrefetchedMediaSource(musicItem, quality, mediaSource);
                break;
            }
        } catch (error) {
            logger.logError(
                `[Recognize] ${plugin.platform} ${quality} source failed`,
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    return {
        ...match,
        musicItem,
        platform: plugin.platform,
    };
}

export async function recognizeSystemAudio(): Promise<RecognizeMatch[]> {
    const capture = await captureSystemAudio();
    const plugins = PluginManager.getSortedSupportedPlugin("recognize");
    if (!plugins.length) {
        throw new Error("没有可用的听歌识曲平台插件");
    }
    const matches: RecognizeMatch[] = [];
    for (const plugin of plugins) {
        try {
            const result = await PluginManager.callPluginDelegateMethod(
                plugin,
                "recognize",
                capture.base64,
                capture.sampleRate,
                capture.channels,
            );
            const rows = Array.isArray(result) ? result : result?.data;
            if (!Array.isArray(rows)) continue;
            for (const item of rows) {
                const match = normalizeMatch(item, plugin);
                if (match) matches.push(match);
            }
        } catch (error) {
            logger.logError(`[Recognize] ${plugin.platform} failed`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    const deduped = new Map<string, RecognizeMatch>();
    for (const match of matches) {
        const key = `${match.platform}:${match.musicItem.id}`;
        const previous = deduped.get(key);
        if (!previous || match.confidence > previous.confidence) deduped.set(key, match);
    }
    const orderedMatches = [...deduped.values()].sort((a, b) => b.confidence - a.confidence);
    if (!orderedMatches.length) {
        return [];
    }

    // Resolve metadata and a playable source only for the highest-confidence
    // match.  Recognition can return many near-duplicates; resolving every
    // row at once causes a burst of short-lived URL requests and noisy plugin
    // errors.  Remaining rows are hydrated lazily when the user selects one.
    const bestMatch = orderedMatches[0];
    const delegate = getMediaPluginDelegate(bestMatch.musicItem);
    const plugin = (delegate.hash ? PluginManager.getPluginByHash(delegate.hash) : undefined)
        ?? PluginManager.getPluginByPlatform(bestMatch.platform);
    const hydratedBest = plugin
        ? await hydrateRecognizeMatch(bestMatch, plugin)
        : bestMatch;
    return [hydratedBest, ...orderedMatches.slice(1)];
}

export function cancelRecognizeSystemAudio() {
    activeCapture?.stop();
    activeCapture = null;
}
