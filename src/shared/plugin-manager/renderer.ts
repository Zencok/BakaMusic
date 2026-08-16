import Store from "@/common/store";
import AppConfig from "@shared/app-config/renderer";
import {
    filterQualityOrderByDeclaredQualities,
    getDeclaredQualityKeys,
} from "@/common/media-util";
import useAppConfig from "@/hooks/useAppConfig";
import { useMemo } from "react";
import logger from "@shared/logger/renderer";
import {
    getActiveLxPluginForSource,
    getLxSourceForPlatform,
    type LxPluginDescriptor,
} from "./lx-types";
import {
    isPluginPlaybackLogEntry,
    PLUGIN_PLAYBACK_LOG_LIMIT,
    type PluginPlaybackLogEntry,
} from "./playback-log";

interface IPluginDelegateLike {
    platform?: string;
    hash?: string;
}

interface IMod {
    onPluginUpdated: (callback: (plugins: IPlugin.IPluginDelegate[]) => void) => void,
    onLxPluginUpdated: (callback: (plugins: LxPluginDescriptor[]) => void) => void,
    onPlaybackLogAppended: (
        callback: (entry: PluginPlaybackLogEntry) => void,
    ) => () => void,

    callPluginMethod<
        T extends keyof IPlugin.IPluginInstanceMethods,
    >(
        pluginDelegate: IPluginDelegateLike,
        method: T,
        ...args: Parameters<IPlugin.IPluginInstanceMethods[T]>
    ): ReturnType<IPlugin.IPluginInstanceMethods[T]>,

    reloadPlugins: () => Promise<void>;
    reloadLxPlugins: () => Promise<void>;
    uninstallPlugin: (hash: string) => Promise<void>;
    uninstallAllPlugins: () => Promise<void>;
    updateAllPlugins: () => Promise<void>;
    installPluginFromRemote: (url: string) => Promise<void>,
    installPluginFromLocal: (rawCode: string) => Promise<void>,
    installLxPluginFromLocal: (filePath: string) => Promise<void>,
    installLxPluginFromRemote: (url: string) => Promise<void>,
    setActiveLxPlugin: (hash: string | null) => Promise<void>,
    uninstallLxPlugin: (hash: string) => Promise<void>,
    loadPlaybackLogs: () => Promise<PluginPlaybackLogEntry[]>,
    clearPlaybackLogs: () => Promise<void>,
}

function fallbackCallPluginMethod<
    T extends keyof IPlugin.IPluginInstanceMethods,
>(
    _pluginDelegate: IPluginDelegateLike,
    _method: T,
    ..._args: Parameters<IPlugin.IPluginInstanceMethods[T]>
): ReturnType<IPlugin.IPluginInstanceMethods[T]> {
    return undefined as ReturnType<IPlugin.IPluginInstanceMethods[T]>;
}

const bridge = window["@shared/plugin-manager" as any] as unknown as IMod | undefined;

const mod: IMod = bridge ?? {
    onPluginUpdated: () => {
        // pass
    },
    onLxPluginUpdated: () => {
        // pass
    },
    onPlaybackLogAppended: () => () => {
        // pass
    },
    callPluginMethod: fallbackCallPluginMethod,
    reloadPlugins: async () => {
        // pass
    },
    reloadLxPlugins: async () => {
        // pass
    },
    uninstallPlugin: async () => {
        // pass
    },
    uninstallAllPlugins: async () => {
        // pass
    },
    updateAllPlugins: async () => {
        // pass
    },
    installPluginFromRemote: async () => {
        // pass
    },
    installPluginFromLocal: async () => {
        // pass
    },
    installLxPluginFromLocal: async () => {
        // pass
    },
    installLxPluginFromRemote: async () => {
        // pass
    },
    setActiveLxPlugin: async () => {
        // pass
    },
    uninstallLxPlugin: async () => {
        // pass
    },
    loadPlaybackLogs: async () => [],
    clearPlaybackLogs: async () => {
        // pass
    },
};

if (!bridge) {
    logger.logInfo("[plugin-manager] preload bridge unavailable; plugin features are temporarily disabled.");
}

const delegatePluginsStore = new Store<IPlugin.IPluginDelegate[]>([]);
const lxPluginsStore = new Store<LxPluginDescriptor[]>([]);
const playbackLogsStore = new Store<PluginPlaybackLogEntry[]>([]);
const emptyPluginMeta = Object.freeze({}) as Record<
    string,
    IPlugin.IPluginMeta | undefined
>;

function sortPluginsByMeta(
    plugins: IPlugin.IPluginDelegate[],
    meta: Record<string, IPlugin.IPluginMeta | undefined>,
) {
    return plugins
        .map((plugin, index) => ({ plugin, index }))
        .sort((a, b) => {
            const aOrder = meta[a.plugin.platform]?.order;
            const bOrder = meta[b.plugin.platform]?.order;

            if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            if (aOrder !== undefined && bOrder === undefined) {
                return -1;
            }
            if (aOrder === undefined && bOrder !== undefined) {
                return 1;
            }
            return a.index - b.index;
        })
        .map(({ plugin }) => plugin);
}

mod.onPluginUpdated((plugins) => {
    delegatePluginsStore.setValue(plugins);
});

mod.onLxPluginUpdated((plugins) => {
    lxPluginsStore.setValue(plugins);
});

mod.onPlaybackLogAppended((entry) => {
    if (!isPluginPlaybackLogEntry(entry)) {
        return;
    }
    playbackLogsStore.setValue([
        ...playbackLogsStore.getValue().filter((item) => item.id !== entry.id),
        entry,
    ].slice(-PLUGIN_PLAYBACK_LOG_LIMIT));
});

async function reloadPlaybackLogs() {
    const loadedEntries = (await mod.loadPlaybackLogs()).filter(isPluginPlaybackLogEntry);
    const entriesById = new Map(
        [...loadedEntries, ...playbackLogsStore.getValue()]
            .map((entry) => [entry.id, entry] as const),
    );
    const nextEntries = [...entriesById.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-PLUGIN_PLAYBACK_LOG_LIMIT);
    playbackLogsStore.setValue(nextEntries);
    return nextEntries;
}

async function clearPlaybackLogs() {
    await mod.clearPlaybackLogs();
    playbackLogsStore.setValue([]);
}

function isPluginEnabled(platform: string, meta: Record<string, IPlugin.IPluginMeta | undefined>) {
    return !(meta[platform]?.disabled ?? false);
}

function getSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    const meta = AppConfig.getConfig("private.pluginMeta") ?? {};
    return delegatePluginsStore
        .getValue()
        .filter((_) => _.supportedMethod.includes(featureMethod) && isPluginEnabled(_.platform, meta));
}

function getSortedSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    const meta = AppConfig.getConfig("private.pluginMeta") ?? {};
    return sortPluginsByMeta(
        delegatePluginsStore
            .getValue()
            .filter((_) => _.supportedMethod.includes(featureMethod) && isPluginEnabled(_.platform, meta)),
        meta,
    );
}

function getSearchablePlugins(
    supportedSearchType?: IMedia.SupportMediaType,
) {
    return getSupportedPlugin("search").filter((_) =>
        supportedSearchType && _.supportedSearchType
            ? _.supportedSearchType.includes(supportedSearchType)
            : true,
    );
}


function getSortedSearchablePlugins(
    supportedSearchType?: IMedia.SupportMediaType,
) {
    return getSortedSupportedPlugin("search").filter((_) =>
        supportedSearchType && _.supportedSearchType
            ? _.supportedSearchType.includes(supportedSearchType)
            : true,
    );
}

function getPluginByHash(hash: string) {
    return delegatePluginsStore.getValue().find((item) => item.hash === hash);
}

function getPluginByPlatform(platform: string) {
    return delegatePluginsStore.getValue().find((item) => item.platform === platform);
}

function isKugouPlatform(platform?: string) {
    return typeof platform === "string"
        && (/酷狗|kugou/i.test(platform) || platform.trim().toLocaleLowerCase() === "kg");
}

/** The installed KG platform plugin is the single metadata/playback base. */
function getKugouPlugin() {
    return getSortedSupportedPlugin("getMusicInfo").find((plugin) =>
        isKugouPlatform(plugin.platform),
    ) ?? delegatePluginsStore.getValue().find((plugin) =>
        isKugouPlatform(plugin.platform),
    );
}

function isSupportFeatureMethod(platform: string, featureMethod: keyof IPlugin.IPluginInstanceMethods) {
    if (!platform) {
        return false;
    }
    return delegatePluginsStore.getValue().find((item) => item.platform === platform)?.supportedMethod?.includes?.(featureMethod) ?? false;
}

function getLxQualityOverride(platform: string) {
    const source = getLxSourceForPlatform(platform);
    if (!source || !delegatePluginsStore.getValue().some((plugin) => plugin.platform === platform)) {
        return null;
    }
    const lxPlugins = lxPluginsStore.getValue();
    const activeHash = lxPlugins.find((item) => item.active)?.hash ?? null;
    const plugin = getActiveLxPluginForSource(lxPlugins, activeHash, source);
    const qualities = plugin?.sources[source]?.qualities;
    return qualities ? [...qualities] : null;
}

function getMediaQualityKeys(musicItem: Partial<IMusic.IMusicItem>) {
    const declaredQualities = getDeclaredQualityKeys(musicItem);
    const lxQualities = getLxQualityOverride(musicItem.platform ?? "");
    if (!lxQualities) {
        return declaredQualities;
    }
    const qualitySet = new Set(lxQualities);
    return declaredQualities.filter((quality) => qualitySet.has(quality));
}

function filterMediaQualityOrder(
    musicItem: Partial<IMusic.IMusicItem>,
    qualityOrder: IMusic.IQualityKey[],
) {
    const lxQualities = getLxQualityOverride(musicItem.platform ?? "");
    if (!lxQualities) {
        return filterQualityOrderByDeclaredQualities(musicItem, qualityOrder);
    }
    const qualitySet = new Set(getMediaQualityKeys(musicItem));
    return qualityOrder.filter((quality) => qualitySet.has(quality));
}


function getPluginPrimaryKey(pluginItem: IPluginDelegateLike) {
    return (
        delegatePluginsStore
            .getValue()
            .find((it) => it.platform === pluginItem.platform)?.primaryKey ?? []
    );
}


async function setup() {
    await Promise.all([
        mod.reloadPlugins(),
        mod.reloadLxPlugins(),
    ]);
}

const PluginManager = {
    setup,
    getSortedSupportedPlugin,
    getSupportedPlugin,
    getSearchablePlugins,
    getSortedSearchablePlugins,
    getPluginByHash,
    getPluginByPlatform,
    getKugouPlugin,
    isSupportFeatureMethod,
    getPluginPrimaryKey,
    getLxQualityOverride,
    getMediaQualityKeys,
    filterMediaQualityOrder,
    callPluginDelegateMethod: mod.callPluginMethod,
    updateAllPlugins: mod.updateAllPlugins,
    uninstallPlugin: mod.uninstallPlugin,
    uninstallAllPlugins: mod.uninstallAllPlugins,
    installPluginFromRemote: mod.installPluginFromRemote,
    installPluginFromLocal: mod.installPluginFromLocal,
    installLxPluginFromLocal: mod.installLxPluginFromLocal,
    installLxPluginFromRemote: mod.installLxPluginFromRemote,
    setActiveLxPlugin: mod.setActiveLxPlugin,
    uninstallLxPlugin: mod.uninstallLxPlugin,
    reloadPlaybackLogs,
    clearPlaybackLogs,
};

export default PluginManager;

export function useSortedSupportedPlugin(
    featureMethod: keyof IPlugin.IPluginInstanceMethods,
) {
    const plugins = delegatePluginsStore.useValue();
    const meta = useAppConfig("private.pluginMeta") ?? emptyPluginMeta;

    return useMemo(() => {
        return sortPluginsByMeta(
            plugins.filter(
                (_) => _.supportedMethod.includes(featureMethod) && isPluginEnabled(_.platform, meta),
            ),
            meta,
        );
    }, [plugins, meta, featureMethod]);
}

export function useSortedPlugins() {
    const plugins = delegatePluginsStore.useValue();
    const meta = useAppConfig("private.pluginMeta") ?? emptyPluginMeta;

    return useMemo(() => {
        return sortPluginsByMeta(plugins, meta);
    }, [plugins, meta]);
}

export function useLxPlugins() {
    return lxPluginsStore.useValue();
}

export function usePluginPlaybackLogs() {
    return playbackLogsStore.useValue();
}
