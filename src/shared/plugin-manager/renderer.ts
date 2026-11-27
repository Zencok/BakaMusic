import Store from "@/common/store";
import AppConfig from "@shared/app-config/renderer";
import { filterQualityOrderByDeclaredQualities, getDeclaredQualityKeys } from "@/common/media-util";
import useAppConfig from "@/hooks/useAppConfig";
import { useMemo } from "react";
import logger from "@shared/logger/renderer";
import type { PluginInvocationResult } from "./rpc";
import { isPluginPlaybackLogEntry, PLUGIN_PLAYBACK_LOG_LIMIT, type PluginPlaybackLogEntry } from "./playback-log";

interface DelegateLike { id?: string | number; platform?: string; hash?: string }
interface IMod {
    onPluginUpdated(callback: (plugins: IPlugin.IPluginDelegate[]) => void): void;
    onRegistryUpdated(callback: (state: IPlugin.RegistryState) => void): void;
    onPlaybackLogAppended(callback: (entry: PluginPlaybackLogEntry) => void): () => void;
    invoke<T extends IPlugin.Capability>(delegate: DelegateLike, capability: T, request: IPlugin.Requests[T]): Promise<PluginInvocationResult<IPlugin.Results[T]>>;
    reloadPlugins(): Promise<void>;
    uninstallPlugin(id: string): Promise<void>;
    uninstallAllPlugins(): Promise<void>;
    updateAllPlugins(): Promise<void>;
    installPluginFromRemote(url: string, options?: IPlugin.ImportOptions): Promise<void>;
    installPluginFromLocal(path: string, options?: IPlugin.ImportOptions): Promise<void>;
    setResolverBinding(providerId: string, resolverId: string | null): Promise<void>;
    loadPlaybackLogs(): Promise<PluginPlaybackLogEntry[]>;
    clearPlaybackLogs(): Promise<void>;
}

const bridge = window["@shared/plugin-manager" as any] as unknown as IMod | undefined;
const unavailable = async (): Promise<never> => {
    throw new Error("Plugin bridge unavailable");
};
const mod: IMod = bridge ?? {
    onPluginUpdated: () => undefined,
    onRegistryUpdated: () => undefined,
    onPlaybackLogAppended: () => () => undefined,
    invoke: unavailable,
    reloadPlugins: async () => undefined,
    uninstallPlugin: unavailable,
    uninstallAllPlugins: unavailable,
    updateAllPlugins: unavailable,
    installPluginFromRemote: unavailable,
    installPluginFromLocal: unavailable,
    setResolverBinding: unavailable,
    loadPlaybackLogs: async () => [],
    clearPlaybackLogs: unavailable,
};
if (!bridge) logger.logInfo("[plugin-manager] preload bridge unavailable");

const delegatePluginsStore = new Store<IPlugin.IPluginDelegate[]>([]);
const registryStore = new Store<IPlugin.RegistryState>({ retiredPlugins: [], resolverBindings: [] });
const playbackLogsStore = new Store<PluginPlaybackLogEntry[]>([]);
const emptyPluginMeta = Object.freeze({}) as Record<string, IPlugin.IPluginMeta | undefined>;
const revisionStore = new Store(0);
const invalidate = () => revisionStore.setValue(revisionStore.getValue() + 1);

mod.onPluginUpdated((plugins) => {
    delegatePluginsStore.setValue(plugins); invalidate();
});
mod.onRegistryUpdated((state) => {
    registryStore.setValue(state); invalidate();
});
AppConfig.onConfigUpdate((patch) => {
    if (Object.keys(patch).some((key) => key === "private.pluginMeta"
        || key === "private.pluginResolverBindings" || key === "normal.language" || key.startsWith("network.proxy."))) invalidate();
});
mod.onPlaybackLogAppended((entry) => {
    if (isPluginPlaybackLogEntry(entry)) playbackLogsStore.setValue([
        ...playbackLogsStore.getValue().filter((item) => item.id !== entry.id), entry,
    ].slice(-PLUGIN_PLAYBACK_LOG_LIMIT));
});

function sortPluginsByMeta(plugins: IPlugin.IPluginDelegate[], meta: Record<string, IPlugin.IPluginMeta | undefined>) {
    return plugins.map((plugin, index) => ({ plugin, index })).sort((a, b) => {
        const aOrder = meta[a.plugin.id]?.order;
        const bOrder = meta[b.plugin.id]?.order;
        return aOrder !== undefined && bOrder !== undefined ? aOrder - bOrder || a.index - b.index
            : aOrder !== undefined ? -1 : bOrder !== undefined ? 1 : a.index - b.index;
    }).map(({ plugin }) => plugin);
}
function getSupportedPlugin(capability: IPlugin.Capability) {
    const meta = AppConfig.getConfig("private.pluginMeta") ?? {};
    return delegatePluginsStore.getValue().filter((plugin) => supportsCapability(plugin, capability) && !meta[plugin.id]?.disabled);
}
function supportsCapability(plugin: IPlugin.IPluginDelegate, capability: IPlugin.Capability,
    state = registryStore.getValue(), plugins = delegatePluginsStore.getValue(),
    meta: Record<string, IPlugin.IPluginMeta | undefined> = AppConfig.getConfig("private.pluginMeta") ?? {}) {
    if (capability === "media.resolve") {
        if (plugin.kind === "resolver") return false;
        const binding = state.resolverBindings.find((item) => item.providerId === plugin.id);
        if (binding) {
            const resolver = plugins.find((item) => item.id === binding.resolverId);
            return plugin.kind === "provider" && plugin.capabilities.includes("media.prepare")
                && !!resolver && resolver.kind === "resolver" && !meta[resolver.id]?.disabled
                && resolver.capabilities.includes("media.resolve") && !!plugin.sourceId
                && resolver.sources?.includes(plugin.sourceId) === true;
        }
    }
    return plugin.capabilities.includes(capability);
}
function getSortedSupportedPlugin(capability: IPlugin.Capability) {
    return sortPluginsByMeta(getSupportedPlugin(capability), AppConfig.getConfig("private.pluginMeta") ?? {});
}
function getSearchablePlugins(kind?: IMedia.SupportMediaType) {
    return getSupportedPlugin("search").filter((plugin) => !kind || !plugin.supportedSearchType || plugin.supportedSearchType.includes(kind));
}
function getSortedSearchablePlugins(kind?: IMedia.SupportMediaType) {
    return sortPluginsByMeta(getSearchablePlugins(kind), AppConfig.getConfig("private.pluginMeta") ?? {});
}
function getPluginByHash(id: string) {
    return delegatePluginsStore.getValue().find((plugin) => plugin.id === id);
}
function getPluginByPlatform(id: string) {
    return getPluginByHash(id);
}
function isSupportFeatureMethod(id: string, capability: IPlugin.Capability) {
    return getSupportedPlugin(capability).some((plugin) => plugin.id === id);
}
export type PluginSourcePriorityMode = "playback" | "download";
function getSourcePluginCandidates(mode: PluginSourcePriorityMode) {
    const configured = AppConfig.getConfig(mode === "playback" ? "playMusic.sourcePriority" : "download.sourcePriority") ?? [];
    const supported = getSortedSupportedPlugin("media.resolve");
    const selected = configured.map((id) => supported.find((plugin) => plugin.id === id)).filter((plugin): plugin is IPlugin.IPluginDelegate => !!plugin);
    return [...new Set([...selected, ...supported])];
}
function getMediaQualityKeys(item: Partial<IMusic.IMusicItem>) {
    return getDeclaredQualityKeys(item);
}
function filterMediaQualityOrder(item: Partial<IMusic.IMusicItem>, order: IMusic.IQualityKey[]) {
    return filterQualityOrderByDeclaredQualities(item, order);
}
function getPluginPrimaryKey(item: DelegateLike) {
    return getPluginByPlatform(item.platform ?? item.hash ?? "")?.primaryKey ?? [];
}

async function invoke<T extends IPlugin.Capability>(delegate: DelegateLike, capability: T, request: IPlugin.Requests[T]): Promise<IPlugin.Results[T]> {
    const response = await mod.invoke(delegate, capability, request);
    if (!response || typeof response.ok !== "boolean") throw new Error("Invalid plugin response");
    if (!response.ok) {
        const error = new Error(response.error.message) as Error & { code?: string };
        if (typeof response.error.code === "string") error.code = response.error.code;
        throw error;
    }
    const value = response.value as unknown;
    const status = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
    const authenticated = capability === "auth.login" || capability === "auth.callback";
    const loggedOut = capability === "auth.logout";
    const succeeded = value === true || status.ok === true || status.success === true
        || authenticated && status.authenticated === true || loggedOut && (value === null || status.authenticated === false);
    if ((authenticated || loggedOut) && succeeded && status.error == null && status.ok !== false && status.success !== false) invalidate();
    return response.value;
}

/** Fetch and validate a complete snapshot before the library applies one transaction. */
async function importCollection(delegate: DelegateLike, url: string, _options?: IPlugin.IImportMusicSheetOptions): Promise<IPlugin.IImportMusicSheetResult> {
    const generation = revisionStore.getValue();
    const assertCurrent = () => {
        if (generation !== revisionStore.getValue()) throw new Error("Music source changed during import; retry the import");
    };
    const entity = await invoke(delegate, "links.resolve", { url, kind: "sheet" });
    assertCurrent();
    if (!entity || entity.id === undefined || entity.id === null) throw new Error("The link did not resolve to a collection");
    const musicList: IMusic.IMusicItem[] = [];
    const cursors = new Set<string>();
    const revisions = new Map<string, unknown>();
    let cursor: string | null = null;
    let total: number | undefined;
    let sheet = entity as IMusic.IMusicSheetItem;
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex++) {
        const page: IPlugin.Results["collections.members"] = await invoke(delegate, "collections.members", { entity, kind: "music", cursor, limit: 100 });
        assertCurrent();
        if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) throw new Error("Invalid collection page");
        if (page.nextCursor !== null && !page.items.length) throw new Error("Empty collection page cannot continue");
        if (page.entity && (page.entity.id !== entity.id || page.entity.platform !== entity.platform)) throw new Error("Collection identity changed during import");
        for (const key of ["revision", "accountRevision", "sourceRevision"] as const) {
            if (pageIndex === 0) revisions.set(key, page[key]);
            else if (revisions.get(key) !== page[key]) throw new Error("Collection changed during import; retry the import");
        }
        if (page.total !== undefined) {
            if (!Number.isSafeInteger(page.total) || page.total < 0 || (total !== undefined && total !== page.total)) throw new Error("Inconsistent collection total");
            total = page.total;
        }
        for (const item of page.items) {
            if (!item || (typeof item.id !== "string" && typeof item.id !== "number")
                || (typeof item.id === "number" && !Number.isFinite(item.id)) || item.id === ""
                || item.platform !== entity.platform) throw new Error("Invalid collection member ownership");
            musicList.push(item as IMusic.IMusicItem);
        }
        if (musicList.length > 200_000 || (total !== undefined && musicList.length > total)) throw new Error("Collection size exceeds its declared limit");
        if (page.entity) sheet = { ...sheet, ...page.entity };
        if (page.nextCursor === null) {
            if (total !== undefined && total !== musicList.length) throw new Error("Collection snapshot is incomplete");
            return { ...sheet, id: entity.id, platform: entity.platform, musicList,
                syncVersion: typeof revisions.get("revision") === "string" ? revisions.get("revision") as string : undefined };
        }
        if (!page.nextCursor || new TextEncoder().encode(page.nextCursor).byteLength > 2048 || cursors.has(page.nextCursor)) throw new Error("Collection cursor did not advance");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
    }
    throw new Error("Collection page limit exceeded");
}
async function reloadPlaybackLogs() {
    const entries = (await mod.loadPlaybackLogs()).filter(isPluginPlaybackLogEntry);
    const byId = new Map([...entries, ...playbackLogsStore.getValue()].map((entry) => [entry.id, entry]));
    const result = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-PLUGIN_PLAYBACK_LOG_LIMIT);
    playbackLogsStore.setValue(result);
    return result;
}
async function clearPlaybackLogs() {
    await mod.clearPlaybackLogs(); playbackLogsStore.setValue([]);
}

const PluginManager = {
    setup: mod.reloadPlugins,
    onPluginsChanged: revisionStore.subscribe,
    getRegistryRevision: revisionStore.getValue,
    getResolverBinding: (providerId: string) => registryStore.getValue().resolverBindings.find((binding) => binding.providerId === providerId)?.resolverId,
    getSortedSupportedPlugin, getSupportedPlugin, getSearchablePlugins, getSortedSearchablePlugins,
    getPluginByHash, getPluginByPlatform, isSupportFeatureMethod, getPluginPrimaryKey,
    getMediaQualityKeys, filterMediaQualityOrder, getSourcePluginCandidates,
    invoke, importCollection,
    updateAllPlugins: mod.updateAllPlugins, uninstallPlugin: mod.uninstallPlugin,
    uninstallAllPlugins: mod.uninstallAllPlugins, installPluginFromRemote: mod.installPluginFromRemote,
    installPluginFromLocal: mod.installPluginFromLocal, setResolverBinding: mod.setResolverBinding,
    reloadPlaybackLogs, clearPlaybackLogs,
};
export default PluginManager;
export function useSortedSupportedPlugin(capability: IPlugin.Capability) {
    const plugins = delegatePluginsStore.useValue();
    const registry = registryStore.useValue();
    const meta = useAppConfig("private.pluginMeta") ?? emptyPluginMeta;
    return useMemo(() => sortPluginsByMeta(plugins.filter((plugin) => supportsCapability(plugin, capability, registry, plugins, meta) && !meta[plugin.id]?.disabled), meta), [plugins, meta, capability, registry]);
}
export function useSortedPlugins() {
    const plugins = delegatePluginsStore.useValue();
    const meta = useAppConfig("private.pluginMeta") ?? emptyPluginMeta;
    return useMemo(() => sortPluginsByMeta(plugins, meta), [plugins, meta]);
}
export function usePluginRegistryState() {
    return registryStore.useValue();
}
export function usePluginPlaybackLogs() {
    return playbackLogsStore.useValue();
}
