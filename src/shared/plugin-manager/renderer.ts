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
    getLxSourceForPlatform,
    type LxPluginDescriptor,
} from "./lx-types";

interface IPluginDelegateLike {
    platform?: string;
    hash?: string;
}

interface IMod {
    onPluginUpdated: (callback: (plugins: IPlugin.IPluginDelegate[]) => void) => void,
    onLxPluginUpdated: (callback: (plugins: LxPluginDescriptor[]) => void) => void,

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
};

if (!bridge) {
    logger.logInfo("[plugin-manager] preload bridge unavailable; plugin features are temporarily disabled.");
}

const delegatePluginsStore = new Store<IPlugin.IPluginDelegate[]>([]);
const lxPluginsStore = new Store<LxPluginDescriptor[]>([]);
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
    const plugin = lxPluginsStore.getValue().find((item) => item.active);
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
