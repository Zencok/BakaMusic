/** Exact public V2 capability names. No legacy dispatch aliases. */
export const pluginCapabilities = [
    "search", "entities.get", "collections.get", "collections.members",
    "discovery.charts", "discovery.chartTags", "discovery.playlistTags",
    "discovery.playlists", "discovery.hotSearch", "discovery.recommendations",
    "discovery.daily", "discovery.similar", "discovery.searchSuggestions",
    "media.prepare", "media.resolve", "media.video", "media.license", "lyrics.get",
    "comments.list", "links.resolve", "links.share", "recognition.identify",
    "auth.login", "auth.callback", "auth.logout", "auth.status",
] as const satisfies readonly IPlugin.Capability[];

export type PluginCapability = typeof pluginCapabilities[number];
const capabilitySet = new Set<string>(pluginCapabilities);
export function isPluginCapability(value: unknown): value is PluginCapability {
    return typeof value === "string" && capabilitySet.has(value);
}
const reservedObjectKeys = new Set(["__proto__", "constructor", "prototype"]);
export function isReservedObjectKey(key: string) {
    return reservedObjectKeys.has(key);
}
export interface PluginExecutionEnvironment {
    os: NodeJS.Platform;
    appVersion: string;
    lang?: string | null;
    userVariables: Record<string, string>;
    proxyUrl?: string;
}
export interface PluginHostDescriptor {
    id: string;
    manifest: IPlugin.Manifest;
    protocolVersion?: number;
    runtime?: "rust-quickjs-v2";
}
export interface PluginInvocation<T extends PluginCapability = PluginCapability> {
    providerId: string;
    capability: T;
    request: IPlugin.Requests[T];
}
/** Plain data across both IPC and contextBridge; renderer reconstructs errors. */
export type PluginInvocationResult<T> = { ok: true; value: T }
    | { ok: false; error: { message: string; code?: string } };
export interface NativeRequest {
    jsonrpc: "2.0";
    id: string;
    method: "health" | "inspect" | "prepareImport" | "load" | "invoke" | "unload" | "clear" | "cancel";
    params: Record<string, unknown>;
}
export interface NativeResponse {
    jsonrpc: "2.0";
    id: string;
    result?: unknown;
    error?: { code: number; message: string; data?: { code?: string; failureCode?: string } };
}
