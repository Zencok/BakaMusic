import PluginManager, {
    type PluginSourcePriorityMode,
} from "@shared/plugin-manager/renderer";
import AppConfig from "@shared/app-config/renderer";
import {
    getMediaPluginDelegate,
    type IPluginDelegateReference,
} from "./track-player/plugin-media";

type QualityKey = IMusic.IQualityKey;

export interface IResolvedMediaSource {
    mediaSource: IPlugin.IMediaSourceResult;
    quality: QualityKey;
    /** Metadata accepted by the fallback plugin (may use another platform id). */
    sourceMusicItem: IMusic.IMusicItem;
    plugin: IPlugin.IPluginDelegate;
}

interface ISourceResolutionOptions {
    musicItem: IMusic.IMusicItem;
    qualityOrder: QualityKey[];
    mode: PluginSourcePriorityMode;
    signal?: AbortSignal;
    isCancelled?: () => boolean;
}

function normalize(value: unknown) {
    return typeof value === "string"
        ? value.trim().toLocaleLowerCase()
        : "";
}

function words(value: unknown) {
    return normalize(value)
        .replace(/\s+/g, " ")
        .split(/[\s\-_/|·•]+/)
        .filter(Boolean);
}

function scoreMatch(source: IMusic.IMusicItem, target: IMusic.IMusicItem) {
    const sourceTitle = normalize(source.title);
    const targetTitle = normalize(target.title);
    const sourceArtist = normalize(source.artist);
    const targetArtist = normalize(target.artist);
    let score = 0;
    if (sourceTitle && sourceTitle === targetTitle) {
        score += 100;
    } else if (sourceTitle && targetTitle && (sourceTitle.includes(targetTitle) || targetTitle.includes(sourceTitle))) {
        score += 55;
    }
    if (sourceArtist && targetArtist && sourceArtist === targetArtist) {
        score += 50;
    } else {
        const targetWords = new Set(words(target.artist));
        score += words(source.artist).filter((word) => targetWords.has(word)).length * 8;
    }
    const sourceDuration = Number(source.duration);
    const targetDuration = Number(target.duration);
    if (Number.isFinite(sourceDuration) && Number.isFinite(targetDuration) && sourceDuration > 0) {
        const delta = Math.abs(sourceDuration - targetDuration);
        if (delta <= 2) score += 24;
        else if (delta <= 6) score += 10;
    }
    return score;
}

function isAborted(options: ISourceResolutionOptions) {
    return options.signal?.aborted || options.isCancelled?.() === true;
}

function throwIfSignalAborted(options: ISourceResolutionOptions) {
    if (options.signal?.aborted) {
        throw options.signal.reason;
    }
}

async function withAbort<T>(promise: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return Promise.resolve(promise);
    if (signal.aborted) throw signal.reason;
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(signal.reason ?? new DOMException("Source resolution aborted", "AbortError"));
        };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(promise).then(
            (value) => {
                cleanup();
                if (signal.aborted) {
                    reject(signal.reason);
                } else {
                    resolve(value);
                }
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
    });
}

function delegateFor(plugin: IPlugin.IPluginDelegate): IPluginDelegateReference {
    return { id: plugin.id, platform: plugin.platform, hash: plugin.id };
}

async function resolveItemForPlugin(
    target: IMusic.IMusicItem,
    plugin: IPlugin.IPluginDelegate,
    options: ISourceResolutionOptions,
    isCurrent = false,
): Promise<IMusic.IMusicItem | null> {
    if (isAborted(options)) {
        throwIfSignalAborted(options);
        return null;
    }

    // A second plugin for the same platform can usually consume the existing
    // canonical id. Refreshing metadata also gives it quality/hash aliases.
    if (plugin.platform === target.platform) {
        if (isCurrent) {
            return target;
        }
        if (plugin.capabilities.includes("entities.get")) {
            const info = await withAbort(PluginManager.invoke(delegateFor(plugin), "entities.get", { entity: target }), options.signal);
            if (info && typeof info === "object") return { ...target, ...info, platform: plugin.platform } as IMusic.IMusicItem;
        }
        return { ...target, platform: plugin.platform };
    }

    if (!plugin.capabilities.includes("search")) {
        return null;
    }

    const query = [target.title, target.artist].filter(Boolean).join(" ").trim();
    if (!query) return null;
    const result = await withAbort(
        PluginManager.invoke(delegateFor(plugin), "search", { query: query, cursor: null, limit: 50, kind: "music" }),
        options.signal,
    );
    const rows = (result?.items ?? []) as IMusic.IMusicItem[];
    const best = rows
        .filter((item): item is IMusic.IMusicItem => !!item && typeof item === "object")
        .map((item) => ({ item, score: scoreMatch(item, target) }))
        .sort((a, b) => b.score - a.score)[0];
    // A title-only match is still preferable to giving up, but avoid
    // switching to an unrelated search result.
    return best && best.score >= 50
        ? { ...best.item, platform: plugin.platform }
        : null;
}

async function resolveForPlugin(
    target: IMusic.IMusicItem,
    plugin: IPlugin.IPluginDelegate,
    qualityOrder: QualityKey[],
    options: ISourceResolutionOptions,
    isCurrent = false,
): Promise<IResolvedMediaSource | null> {
    const sourceItem = await resolveItemForPlugin(target, plugin, options, isCurrent);
    if (!sourceItem) return null;
    const qualities = PluginManager.filterMediaQualityOrder(sourceItem, qualityOrder);
    for (const quality of qualities.length ? qualities : qualityOrder) {
        if (isAborted(options)) {
            throwIfSignalAborted(options);
            return null;
        }
        try {
            const mediaSource = await withAbort(
                PluginManager.invoke(delegateFor(plugin), "media.resolve", { entity: sourceItem, quality: quality }),
                options.signal,
            );
            if (isAborted(options)) return null;
            if (mediaSource?.url) {
                const realQuality = typeof mediaSource.quality === "string" && mediaSource.quality.trim()
                    ? mediaSource.quality as QualityKey
                    : quality;
                return {
                    mediaSource,
                    quality: realQuality,
                    sourceMusicItem: sourceItem,
                    plugin,
                };
            }
            return null;
        } catch (error) {
            if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "quality_unavailable") throw error;
        }
    }
    return null;
}

/** Resolve a playable/downloadable source, falling through configured plugins. */
export async function resolveMediaSourceWithFallback(
    options: ISourceResolutionOptions,
): Promise<IResolvedMediaSource | null> {
    const generation = PluginManager.getRegistryRevision();
    const originalOptions = options;
    options = { ...originalOptions, isCancelled: () => originalOptions.isCancelled?.() === true || generation !== PluginManager.getRegistryRevision() };
    const candidates = PluginManager.getSourcePluginCandidates(options.mode);
    const currentHash = getMediaPluginDelegate(options.musicItem).hash;
    const current = candidates.find((plugin) =>
        plugin.platform === options.musicItem.platform
        && (!currentHash || plugin.hash === currentHash),
    ) ?? candidates.find((plugin) => plugin.platform === options.musicItem.platform);
    const fallbackEnabled = AppConfig.getConfig("plugin.enableSourceFallback") !== false;
    const boundResolver = PluginManager.getResolverBinding(options.musicItem.platform);
    const ordered = boundResolver ? (current ? [current] : []) : fallbackEnabled
        ? current
            ? [current, ...candidates.filter((plugin) => plugin.hash !== current.hash)]
            : candidates
        : current
            ? [current]
            : [];

    for (const plugin of ordered) {
        if (isAborted(options)) {
            throwIfSignalAborted(options);
            return null;
        }
        const resolved = await resolveForPlugin(
            options.musicItem,
            plugin,
            options.qualityOrder,
            options,
            plugin === ordered[0],
        );
        if (resolved) return resolved;
    }
    return null;
}
