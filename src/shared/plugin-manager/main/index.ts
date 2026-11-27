import { app, ipcMain } from "electron";
import axios from "axios";
import { compare } from "compare-versions";
import { createHash, verify } from "crypto";
import fs from "fs/promises";
import path from "path";
import { localPluginHash, localPluginName } from "@/common/constant";
import { toError } from "@/common/error-util";
import type { IWindowManager } from "@/types/window-manager";
import type { IAppConfig } from "@/types/app-config";
import AppConfig from "@shared/app-config/main";
import { assertIpcPayload, assertIpcSender, assertPathAccess, assertPlainObject, assertString, assertUrl } from "@shared/ipc-security/main";
import logger from "@shared/logger/main";
import { isPluginCapability, isReservedObjectKey, type PluginCapability, type PluginExecutionEnvironment,
    type PluginHostDescriptor, type PluginInvocation } from "../rpc";
import localPlugin from "./internal-plugins/local-plugin";
import { Plugin } from "./plugin";
import PluginHostClient, { PluginRuntimeError } from "./plugin-host-client";
import PlaybackLogStore from "./playback-log-store";
import type { PluginPlaybackLogEntry } from "../playback-log";
import { LxImportStore, type LxImportOrigin } from "./lx-import-store";

const MAX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_PLUGINS = 100;
const MAX_INSTALLED_PLUGINS = 100;
const MAX_TOTAL_PLUGIN_CODE_BYTES = 64 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 20_000;
interface PluginIntegrityRecord {
    packageId: string;
    sha256: string;
    sourceUrl?: string;
    signature?: string;
    publicKey?: string;
    installedAt: string;
    lx?: LxImportOrigin;
    originalSha256?: string;
}
interface RemotePluginSource {
    url: string;
    expectedPackageId?: string;
    sha256?: string;
    signature?: string;
    publicKey?: string;
}
interface InstalledPlugin {
    plugin: Plugin;
    code: string;
    integrity: PluginIntegrityRecord;
    rawSource?: string;
    runtimeCode?: string;
}
interface MainImportOptions extends IPlugin.ImportOptions {
    locator?: string;
    identity?: string;
    legacyHash?: string;
    settingsId?: string;
}
function sha256(code: string) {
    return createHash("sha256").update(code, "utf8").digest("hex");
}
function retainedBytes(record: Pick<InstalledPlugin, "code" | "rawSource" | "runtimeCode">) {
    return Buffer.byteLength(record.code) + Buffer.byteLength(record.rawSource ?? "") + Buffer.byteLength(record.runtimeCode ?? "");
}
function authStateChanged(capability: PluginCapability, result: unknown) {
    const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
    if (value.error != null || value.ok === false || value.success === false) return false;
    const succeeded = result === true || value.ok === true || value.success === true;
    if (capability === "auth.login" || capability === "auth.callback") return succeeded || value.authenticated === true;
    return capability === "auth.logout" && (succeeded || result === null || value.authenticated === false);
}
function parseExpectedSha256(value: unknown) {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new Error("Plugin SHA-256 value is not valid");
    if (/^[a-f0-9]{64}$/i.test(value.trim())) return value.trim().toLowerCase();
    const match = value.trim().match(/^sha256-([A-Za-z0-9+/=]+)$/);
    const bytes = match ? Buffer.from(match[1], "base64") : undefined;
    if (bytes?.length === 32) return bytes.toString("hex");
    throw new Error("Plugin SHA-256 value is not valid");
}
function verifyPluginSignature(code: string, signature?: string, publicKey?: string) {
    if (!signature && !publicKey) return;
    if (typeof signature !== "string" || typeof publicKey !== "string" || !signature || !publicKey
        || signature.length > 16_384 || publicKey.length > 16_384
        || !verify(null, Buffer.from(code, "utf8"), publicKey, Buffer.from(signature, "base64"))) {
        throw new Error("Plugin signature verification failed");
    }
}
function getRemoteSourceFromUrl(value: string): RemotePluginSource {
    const url = assertUrl(value, ["https:"], 8192);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const expected = fragment.get("sha256") ?? (/^[a-f0-9]{64}$/i.test(url.hash.slice(1)) ? url.hash.slice(1) : url.searchParams.get("sha256"));
    url.hash = "";
    return { url: url.toString(), sha256: parseExpectedSha256(expected) };
}
function getIntegrityPath(pluginPath: string) {
    return `${pluginPath}.integrity.json`;
}
function getOriginalSourcePath(pluginPath: string, integrity: PluginIntegrityRecord) {
    return `${pluginPath}.${integrity.lx ? "lx-source" : "source"}`;
}

export class PluginManager {
    private installed = new Map<string, InstalledPlugin>();
    private retiredPlugins: IPlugin.RetiredPlugin[] = [];
    private activeEnvironments = new Map<string, string>();
    private windowManager!: IWindowManager;
    private inited = false;
    private mutationQueue: Promise<unknown> = Promise.resolve();
    private readonly playbackLogs = new PlaybackLogStore((entry) => this.syncPlaybackLog(entry));
    private readonly host = new PluginHostClient((event) => this.playbackLogs.append(event));
    private readonly lxImports = new LxImportStore(app.getPath("userData"));
    private resolveReady!: () => void;
    private readonly readyPromise = new Promise<void>((resolve) => {
        this.resolveReady = resolve;
    });

    get plugins() {
        return [...this.installed.values()].map((record) => record.plugin);
    }
    private get pluginBasePath() {
        return path.resolve(app.getPath("userData"), "bakamusic-plugins-v2");
    }
    private get storageRoot() {
        return path.resolve(app.getPath("userData"), "bakamusic-plugin-storage-v2");
    }
    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.mutationQueue.then(operation, operation);
        this.mutationQueue = next.catch(() => undefined);
        return next;
    }
    private isEnabled(id: string) {
        return AppConfig.getConfig("private.pluginMeta")?.[id]?.disabled !== true;
    }
    private getEnvironment(id: string): PluginExecutionEnvironment {
        const variables = AppConfig.getConfig("private.pluginMeta")?.[id]?.userVariables ?? {};
        const userVariables = Object.fromEntries(Object.entries(variables).filter(([key, value]) =>
            !isReservedObjectKey(key) && key.length <= 256 && typeof value === "string" && value.length <= 32_768));
        const environment: PluginExecutionEnvironment = { os: process.platform, appVersion: app.getVersion(),
            lang: AppConfig.getConfig("normal.language"), userVariables };
        if (AppConfig.getConfig("network.proxy.enabled")) {
            try {
                const proxy = assertUrl(AppConfig.getConfig("network.proxy.host") ?? "", ["https:", "http:"], 8192);
                proxy.port = AppConfig.getConfig("network.proxy.port") ?? "";
                proxy.username = AppConfig.getConfig("network.proxy.username") ?? "";
                proxy.password = AppConfig.getConfig("network.proxy.password") ?? "";
                environment.proxyUrl = proxy.toString();
            } catch { /* Main proxy settings report malformed configuration. */ }
        }
        return environment;
    }
    private createPlugin(descriptor: PluginHostDescriptor, filePath: string, sourceUrl?: string) {
        if (descriptor.id === localPluginHash || descriptor.id === localPluginName || isReservedObjectKey(descriptor.id)
            || descriptor.manifest.capabilities.some((capability) => !isPluginCapability(capability))) {
            throw new Error("Plugin package identity or capabilities are reserved");
        }
        return new Plugin(descriptor, filePath, (capability, request) =>
            this.host.invokePlugin(descriptor.id, capability, request, descriptor.manifest.name), sourceUrl);
    }
    async setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        this.setupIpcHandlers();
        await fs.mkdir(this.pluginBasePath, { recursive: true });
        await this.playbackLogs.setup();
        await this.lxImports.setup();
        await this.loadAllPlugins();
        AppConfig.onConfigUpdated(this.onConfigUpdated);
        this.inited = true;
        this.resolveReady();
        app.on("before-quit", () => {
            AppConfig.offConfigUpdated(this.onConfigUpdated);
            this.host.dispose();
        });
    }
    whenReady() {
        return this.inited ? Promise.resolve() : this.readyPromise;
    }
    private onConfigUpdated = (patch: IAppConfig) => {
        if (Object.keys(patch).some((key) => key === "private.pluginMeta" || key.startsWith("network.proxy."))) {
            void this.serialize(async () => {
                for (const record of this.installed.values()) await this.ensureRuntime(record);
                this.syncPlugins();
            }).catch((error) => logger.logError("Plugin settings reload failed", toError(error)));
        }
        if (Object.prototype.hasOwnProperty.call(patch, "private.pluginResolverBindings")) this.syncState();
    };
    private async ensureRuntime(record: InstalledPlugin) {
        const id = record.plugin.id;
        if (!this.isEnabled(id)) {
            this.activeEnvironments.delete(id);
            await this.host.unloadPlugin(id);
            return;
        }
        const environment = this.getEnvironment(id);
        const signature = JSON.stringify(environment);
        if (this.activeEnvironments.get(id) === signature) return;
        await this.host.loadPlugin(id, record.runtimeCode ?? record.code, environment, this.storageRoot);
        this.activeEnvironments.set(id, signature);
    }
    private setupIpcHandlers() {
        ipcMain.handle("@shared/plugin-manager/invoke", async (event, data: unknown) => {
            try {
                const role = assertIpcSender(event, ["main", "mv"]);
                assertIpcPayload(data, 8 * 1024 * 1024);
                assertPlainObject(data, "plugin invocation");
                if (role === "mv" && data.capability !== "media.video") throw new PluginRuntimeError("MV overlay may only resolve video sources", "permission_denied");
                await this.whenReady();
                return { ok: true, value: await this.invoke(data as unknown as PluginInvocation) };
            } catch (error) {
                return { ok: false, error: { message: toError(error).message,
                    code: error instanceof PluginRuntimeError ? error.code : undefined } };
            }
        });
        ipcMain.handle("@shared/plugin-manager/load-all-plugins", async (event) => {
            assertIpcSender(event, ["main", "mv"]); await this.whenReady(); return this.plugins.map((plugin) => plugin.delegate);
        });
        ipcMain.handle("@shared/plugin-manager/load-plugin-state", async (event) => {
            assertIpcSender(event, ["main"]); await this.whenReady(); return this.registryState;
        });
        ipcMain.handle("@shared/plugin-manager/set-resolver-binding", async (event, providerId, resolverId) => {
            assertIpcSender(event, ["main"]); await this.whenReady(); return this.setResolverBinding(providerId, resolverId);
        });
        ipcMain.handle("@shared/plugin-manager/uninstall-plugin", async (event, id) => {
            assertIpcSender(event, ["main"]); assertString(id, "plugin ID", 128); return this.uninstallPlugin(id);
        });
        ipcMain.handle("@shared/plugin-manager/uninstall-all-plugins", async (event) => {
            assertIpcSender(event, ["main"]); return this.uninstallAllPlugins();
        });
        ipcMain.handle("@shared/plugin-manager/update-all-plugins", async (event) => {
            assertIpcSender(event, ["main"]); return this.updateAllPlugins();
        });
        ipcMain.handle("@shared/plugin-manager/install-plugin-remote", async (event, value, options) => {
            assertIpcSender(event, ["main"]); assertString(value, "plugin URL", 8192);
            await this.installPluginFromRemoteUrl(value, this.validateImportOptions(options));
        });
        ipcMain.handle("@shared/plugin-manager/install-plugin-local", async (event, filePath, options) => {
            assertIpcSender(event, ["main"]); assertString(filePath, "plugin path", 32768);
            await this.installPluginFromLocalFile(filePath, this.validateImportOptions(options));
        });
        ipcMain.handle("@shared/plugin-manager/load-playback-logs", async (event) => {
            assertIpcSender(event, ["main"]); await this.whenReady(); return this.playbackLogs.getEntries();
        });
        ipcMain.handle("@shared/plugin-manager/clear-playback-logs", async (event) => {
            assertIpcSender(event, ["main"]); await this.whenReady(); return this.playbackLogs.clear();
        });
    }
    async invoke(data: PluginInvocation) {
        if (!data || typeof data.providerId !== "string" || data.providerId.length > 128 || !isPluginCapability(data.capability)) {
            throw new Error("Plugin capability invocation is not valid");
        }
        assertPlainObject(data.request, "plugin request");
        const snapshot = JSON.parse(JSON.stringify(data.request)) as IPlugin.Requests[PluginCapability];
        if (data.providerId === localPluginHash) return localPlugin.invoke(data.capability, snapshot);
        const record = await this.serialize(async () => {
            const current = this.installed.get(data.providerId);
            if (!current || !this.isEnabled(data.providerId)) throw new PluginRuntimeError("This music source is unavailable", "permission_denied");
            await this.ensureRuntime(current);
            return current;
        });
        const environmentSnapshot = JSON.stringify(this.getEnvironment(data.providerId));
        const assertCurrent = () => {
            if (this.installed.get(data.providerId) !== record || !this.isEnabled(data.providerId)
                || JSON.stringify(this.getEnvironment(data.providerId)) !== environmentSnapshot) {
                throw new PluginRuntimeError("This music source is unavailable", "permission_denied");
            }
        };
        assertCurrent();
        if (record.plugin.manifest.kind === "resolver" && data.capability.startsWith("media.")) {
            throw new PluginRuntimeError("Select this resolver through its compatible music source", "permission_denied");
        }
        if (data.capability === "media.resolve") {
            const resolverId = this.bindings[data.providerId];
            if (resolverId) {
                const resolver = await this.serialize(async () => {
                    const selected = this.validateBinding(data.providerId, resolverId);
                    await this.ensureRuntime(selected);
                    return selected;
                });
                assertCurrent();
                const resolverEnvironment = JSON.stringify(this.getEnvironment(resolverId));
                const assertBindingCurrent = () => {
                    assertCurrent();
                    this.validateBinding(data.providerId, resolverId);
                    if (this.bindings[data.providerId] !== resolverId || this.installed.get(resolverId) !== resolver
                        || JSON.stringify(this.getEnvironment(resolverId)) !== resolverEnvironment) {
                        throw new PluginRuntimeError("The selected music source changed during playback", "permission_denied");
                    }
                };
                const request = snapshot as IPlugin.Requests["media.resolve"];
                const context = await record.plugin.invokeRaw("media.prepare", request);
                assertBindingCurrent();
                const prepared = context && typeof context === "object" ? context as Record<string, unknown> : {};
                const result = await record.plugin.methods.invoke("media.resolve", request, () => resolver.plugin.invokeRaw("media.resolve", {
                    providerId: data.providerId, sourceId: record.plugin.manifest.sourceId,
                    entity: prepared.entity ?? request.entity, quality: request.quality,
                    context: Object.prototype.hasOwnProperty.call(prepared, "context") ? prepared.context : context,
                }));
                assertBindingCurrent();
                return result;
            }
        }
        const result = await record.plugin.invoke(data.capability, snapshot);
        assertCurrent();
        if (authStateChanged(data.capability, result)) this.syncState();
        return result;
    }
    private get bindings(): Record<string, string> {
        return AppConfig.getConfig("private.pluginResolverBindings") ?? {};
    }
    private get registryState(): IPlugin.RegistryState {
        return { retiredPlugins: this.retiredPlugins.map((entry) => ({ ...entry })),
            resolverBindings: Object.entries(this.bindings).map(([providerId, resolverId]) => ({ providerId, resolverId })) };
    }
    private validateBinding(providerId: string, resolverId: string) {
        const provider = this.installed.get(providerId);
        const resolver = this.installed.get(resolverId);
        const sourceId = provider?.plugin.manifest.sourceId;
        if (!provider || !resolver || !this.isEnabled(providerId) || !this.isEnabled(resolverId)
            || provider.plugin.manifest.kind !== "provider" || resolver.plugin.manifest.kind !== "resolver"
            || !provider.plugin.manifest.capabilities.includes("media.prepare")
            || !resolver.plugin.manifest.capabilities.includes("media.resolve")
            || typeof sourceId !== "string" || !resolver.plugin.manifest.sources?.includes(sourceId)) {
            throw new PluginRuntimeError("The selected resolver is unavailable for this music source", "permission_denied");
        }
        return resolver;
    }
    async setResolverBinding(providerId: string, resolverId: string | null) {
        assertString(providerId, "provider ID", 128);
        if (resolverId !== null) {
            assertString(resolverId, "resolver ID", 128); this.validateBinding(providerId, resolverId);
        }
        const next = { ...this.bindings };
        if (resolverId === null) delete next[providerId]; else next[providerId] = resolverId;
        AppConfig.setConfig({ "private.pluginResolverBindings": next });
        await this.lxImports.recordBindingDecision(providerId);
        this.syncState();
    }
    private syncPlugins() {
        const window = this.windowManager?.mainWindow;
        if (window && !window.isDestroyed()) window.webContents.send("@/shared/plugin-manager/sync-plugins", this.plugins.map((plugin) => plugin.delegate));
        this.syncState();
    }
    private syncState() {
        const window = this.windowManager?.mainWindow;
        if (window && !window.isDestroyed()) window.webContents.send("@shared/plugin-manager/state-updated", this.registryState);
    }
    private syncPlaybackLog(entry: PluginPlaybackLogEntry) {
        const window = this.windowManager?.mainWindow;
        if (window && !window.isDestroyed()) window.webContents.send("@shared/plugin-manager/playback-log-appended", entry);
    }
    private async readCode(filePath: string) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_PLUGIN_CODE_BYTES) throw new Error("Plugin code exceeds the accepted size");
        return fs.readFile(filePath, "utf8");
    }
    private async readIntegrity(pluginPath: string, code: string) {
        const stat = await fs.stat(getIntegrityPath(pluginPath));
        if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error("Plugin integrity record exceeds the limit");
        const raw = await fs.readFile(getIntegrityPath(pluginPath), "utf8");
        if (Buffer.byteLength(raw) > MAX_MANIFEST_BYTES) throw new Error("Plugin integrity record exceeds the limit");
        const record = JSON.parse(raw) as PluginIntegrityRecord;
        if (record.sha256 !== sha256(code) || typeof record.packageId !== "string") throw new Error("Installed plugin integrity verification failed");
        let rawSource: string | undefined;
        if (record.lx) {
            if (typeof record.lx.originalId !== "string" || !record.lx.originalId || record.lx.originalId.length > 16_384
                || typeof record.lx.locator !== "string" || record.lx.locator.length > 32_768
                || !/^[a-f0-9]{64}$/.test(record.lx.rawSha256)) throw new Error("Installed LX origin metadata is invalid");
            rawSource = await this.readCode(getOriginalSourcePath(pluginPath, record));
            if (sha256(rawSource) !== record.lx.rawSha256) throw new Error("Installed LX original source integrity verification failed");
        } else if (record.originalSha256 !== undefined) {
            if (!/^[a-f0-9]{64}$/.test(record.originalSha256)) throw new Error("Installed plugin original source metadata is invalid");
            rawSource = await this.readCode(getOriginalSourcePath(pluginPath, record));
            if (sha256(rawSource) !== record.originalSha256) throw new Error("Installed plugin original source integrity verification failed");
        }
        verifyPluginSignature(rawSource ?? code, record.signature, record.publicKey);
        return { integrity: record, rawSource };
    }
    private async readRetiredDirectories() {
        const retired: IPlugin.RetiredPlugin[] = [];
        for (const name of ["bakamusic-plugins", "musicfree-plugins"]) {
            const directory = path.resolve(app.getPath("userData"), name);
            const files = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
            for (const file of files.slice(0, 1000)) {
                if (!file.isFile() || ![".js", ".mjs"].includes(path.extname(file.name).toLowerCase())) continue;
                const filePath = path.join(directory, file.name);
                retired.push({ id: sha256(filePath), path: filePath, name: path.basename(file.name, path.extname(file.name)), reason: "legacy_format" });
            }
        }
        return retired;
    }
    async loadAllPlugins() {
        return this.serialize(async () => {
            await fs.mkdir(this.pluginBasePath, { recursive: true });
            await this.host.clearPlugins();
            this.activeEnvironments.clear();
            this.installed.clear();
            this.retiredPlugins = await this.readRetiredDirectories();
            const candidates = new Map<string, InstalledPlugin[]>();
            let retainedCodeBytes = 0;
            const files = await fs.readdir(this.pluginBasePath, { withFileTypes: true });
            for (const file of files.slice(0, 1000)) {
                if (!file.isFile() || ![".js", ".mjs"].includes(path.extname(file.name).toLowerCase())) continue;
                const pluginPath = path.join(this.pluginBasePath, file.name);
                try {
                    const code = await this.readCode(pluginPath);
                    const { integrity, rawSource } = await this.readIntegrity(pluginPath, code);
                    const environment = this.getEnvironment(integrity.packageId);
                    let runtimeCode: string | undefined;
                    if (rawSource !== undefined) {
                        const prepared = await this.host.prepareImport({ source: rawSource, kind: integrity.lx ? "lx" : "v2",
                            id: integrity.lx?.originalId, locator: integrity.lx?.locator,
                            enabled: this.isEnabled(integrity.packageId), variables: environment.userVariables, proxyUrl: environment.proxyUrl });
                        if (integrity.lx) {
                            if (prepared.id !== integrity.packageId) throw new Error("Installed LX original identity changed");
                            // Execute only a wrapper generated from the verified unchanged original.
                            if (prepared.source !== code) runtimeCode = prepared.source;
                        } else if (prepared.source !== code) throw new Error("Installed plugin does not match its signed original source");
                    }
                    const descriptor = await this.host.inspectPlugin(runtimeCode ?? code, environment.userVariables);
                    if (descriptor.id !== integrity.packageId) throw new Error("Installed plugin identity does not match its integrity record");
                    const record = { plugin: this.createPlugin(descriptor, pluginPath, integrity.sourceUrl), code, integrity, rawSource, runtimeCode };
                    if (candidates.has(descriptor.id)) {
                        const previousCandidates = candidates.get(descriptor.id) ?? [];
                        this.retiredPlugins.push(...previousCandidates.concat(record).map((candidate) => ({
                            id: sha256(candidate.plugin.path), path: candidate.plugin.path,
                            name: candidate.plugin.name, reason: "duplicate_id" as const,
                        })));
                        retainedCodeBytes -= previousCandidates.reduce((bytes, candidate) => bytes + retainedBytes(candidate), 0);
                        // An empty sentinel rejects every further copy without retaining duplicate source/metadata.
                        candidates.set(descriptor.id, []);
                        continue;
                    } else {
                        if (candidates.size >= MAX_INSTALLED_PLUGINS || retainedCodeBytes + retainedBytes(record) > MAX_TOTAL_PLUGIN_CODE_BYTES) {
                            throw new Error("The installed plugin limit has been reached");
                        }
                        retainedCodeBytes += retainedBytes(record);
                    }
                    candidates.set(descriptor.id, [...candidates.get(descriptor.id) ?? [], record]);
                } catch (error) {
                    this.retiredPlugins.push({ id: sha256(pluginPath), path: pluginPath, name: file.name, reason: "invalid_v2", message: toError(error).message });
                }
            }
            for (const [id, records] of candidates) {
                if (records.length !== 1) {
                    this.retiredPlugins.push(...records.map((record) => ({ id: sha256(record.plugin.path), path: record.plugin.path, name: record.plugin.name, reason: "duplicate_id" as const })));
                    continue;
                }
                const record = records[0];
                this.installed.set(id, record);
                try {
                    await this.ensureRuntime(record);
                } catch (error) {
                    logger.logError(`V2 plugin activation failed: ${id}`, toError(error));
                }
            }
            await this.migrateLegacyLx();
            await this.applyMigratedLxSelection();
            this.syncPlugins();
        });
    }
    private async migrateLegacyLx() {
        const originals = await this.lxImports.discover((filePath, error) => {
            this.retiredPlugins.push({ id: sha256(filePath), path: filePath, name: path.basename(filePath), reason: "invalid_v2", message: toError(error).message });
        });
        for (const original of originals) {
            try {
                const plugin = await this.prepareAndInstall(original.code, original.sourceUrl ? { url: original.sourceUrl } : undefined, {
                    kind: "lx", locator: original.sourceUrl ?? original.path, identity: `lx:electron:${original.hash}`,
                    legacyHash: original.hash, settingsId: original.hash,
                });
                await this.lxImports.recordMigration(original.hash, plugin.id);
            } catch (error) {
                this.retiredPlugins.push({ id: sha256(original.path), path: original.path, name: path.basename(original.path), reason: "invalid_v2", message: toError(error).message });
            }
        }
    }
    private async applyMigratedLxSelection() {
        const resolverId = this.lxImports.selectedId;
        if (!resolverId || !this.installed.has(resolverId) || !this.isEnabled(resolverId)) return;
        for (const source of ["wy", "qq", "kg", "kw", "mg"]) {
            const providerId = `cc.baka.${source}`;
            if (this.lxImports.hasBindingDecision(providerId) || !this.installed.has(providerId)) continue;
            if (!Object.prototype.hasOwnProperty.call(this.bindings, providerId)) {
                const provider = this.installed.get(providerId)?.plugin;
                if (provider?.manifest.sourceId !== `${source}.v1`) continue;
                try {
                    this.validateBinding(providerId, resolverId);
                } catch {
                    continue;
                }
                AppConfig.setConfig({ "private.pluginResolverBindings": { ...this.bindings, [providerId]: resolverId } });
            }
            await this.lxImports.recordBindingDecision(providerId);
        }
    }
    private async downloadPlugin(source: RemotePluginSource) {
        const url = assertUrl(source.url, ["https:"], 8192);
        url.searchParams.set("_bakamusic_cache", Date.now().toString());
        const response = await axios.get<string>(url.toString(), { responseType: "text", timeout: REMOTE_TIMEOUT_MS,
            maxRedirects: 5, beforeRedirect(options) {
                if (options.protocol !== "https:") throw new Error("Plugin redirect protocol is not accepted");
            },
            maxContentLength: MAX_PLUGIN_CODE_BYTES, maxBodyLength: MAX_PLUGIN_CODE_BYTES, transformResponse: [(value) => value] });
        if (typeof response.data !== "string") throw new Error("Plugin response is not text");
        if (source.sha256 && sha256(response.data) !== source.sha256) throw new Error("Plugin SHA-256 verification failed");
        verifyPluginSignature(response.data, source.signature, source.publicKey);
        return response.data;
    }
    private async writeAtomic(filePath: string, content: string) {
        const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" }); await fs.rename(temporary, filePath);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    }
    private validateImportOptions(options?: unknown): IPlugin.ImportOptions {
        if (options === undefined) return {};
        assertPlainObject(options, "plugin import options");
        if (options.kind !== undefined && !["auto", "v2", "lx"].includes(options.kind as string)) throw new Error("Plugin import kind is not valid");
        return options.kind === undefined ? {} : { kind: options.kind as IPlugin.ImportKind };
    }
    private installCode(code: string, source: RemotePluginSource | undefined, options: MainImportOptions = {}) {
        return this.serialize(() => this.prepareAndInstall(code, source, options));
    }
    private async prepareAndInstall(original: string, source: RemotePluginSource | undefined, options: MainImportOptions = {}) {
        if (Buffer.byteLength(original) > MAX_PLUGIN_CODE_BYTES) throw new Error("Plugin code exceeds the accepted size");
        const locator = source?.url ?? options.locator;
        const existing = [...this.installed.values()].find((record) =>
            source?.expectedPackageId === record.plugin.id || locator && record.integrity.lx?.locator === locator);
        const settingsId = existing?.plugin.id ?? options.settingsId ?? source?.expectedPackageId ?? "";
        const environment = this.getEnvironment(settingsId);
        const enabled = this.isEnabled(settingsId);
        const prepared = await this.host.prepareImport({ source: original, kind: options.kind ?? (existing?.integrity.lx ? "lx" : "auto"),
            locator, name: locator ? path.basename(locator, path.extname(locator)) : undefined,
            id: existing?.integrity.lx?.originalId ?? options.identity ?? source?.expectedPackageId ?? (locator ? `lx:locator:${locator}` : undefined),
            enabled, variables: environment.userVariables, proxyUrl: environment.proxyUrl });
        if (enabled !== this.isEnabled(settingsId) || JSON.stringify(environment) !== JSON.stringify(this.getEnvironment(settingsId))) {
            throw new PluginRuntimeError("Plugin settings changed during import; try importing again", "permission_denied");
        }
        const code = prepared.source;
        const lx: LxImportOrigin | undefined = prepared.originalId ? { originalId: prepared.originalId,
            locator: locator ?? prepared.originalId, rawSha256: sha256(original), legacyHash: options.legacyHash ?? existing?.integrity.lx?.legacyHash } : undefined;
        const rawSource = lx || original !== code ? original : undefined;
        const descriptor = await this.host.inspectPlugin(code, environment.userVariables);
        if (prepared.id && prepared.id !== descriptor.id) throw new Error("Converted LX package identity changed");
        if (source?.expectedPackageId && descriptor.id !== source.expectedPackageId) throw new Error("Plugin update package ID changed");
        const previous = this.installed.get(descriptor.id);
        const totalBytes = [...this.installed.values()].reduce((bytes, record) => bytes + retainedBytes(record), 0)
                - (previous ? retainedBytes(previous) : 0) + retainedBytes({ code, rawSource });
        if ((!previous && this.installed.size >= MAX_INSTALLED_PLUGINS) || totalBytes > MAX_TOTAL_PLUGIN_CODE_BYTES) {
            throw new Error("The installed plugin limit has been reached");
        }
        if (previous && !AppConfig.getConfig("plugin.notCheckPluginVersion")
                && compare(previous.plugin.manifest.version, descriptor.manifest.version, ">")) throw new Error("A newer plugin version is already installed");
        if (previous?.integrity.sha256 === sha256(code) && previous.integrity.lx?.rawSha256 === lx?.rawSha256) return previous.plugin;
        const pluginPath = path.join(this.pluginBasePath, `${sha256(descriptor.id)}.js`);
        const integrity: PluginIntegrityRecord = { packageId: descriptor.id, sha256: sha256(code), sourceUrl: source?.url,
            signature: source?.signature, publicKey: source?.publicKey, installedAt: new Date().toISOString(), lx,
            originalSha256: rawSource !== undefined && !lx ? sha256(rawSource) : undefined };
        const next = { plugin: this.createPlugin(descriptor, pluginPath, source?.url), code, integrity, rawSource };
        const originalMeta = AppConfig.getConfig("private.pluginMeta") ?? {};
        const inheritedMeta = settingsId && settingsId !== descriptor.id ? originalMeta[settingsId] : undefined;
        const copySettings = inheritedMeta && !Object.prototype.hasOwnProperty.call(originalMeta, descriptor.id);
        await fs.mkdir(this.pluginBasePath, { recursive: true });
        try {
            await this.writeAtomic(pluginPath, code);
            if (rawSource !== undefined) await this.writeAtomic(getOriginalSourcePath(pluginPath, integrity), rawSource);
            await this.writeAtomic(getIntegrityPath(pluginPath), JSON.stringify(integrity));
            if (copySettings) AppConfig.setConfig({ "private.pluginMeta": { ...originalMeta, [descriptor.id]: inheritedMeta } });
            this.activeEnvironments.delete(descriptor.id);
            await this.ensureRuntime(next);
            this.installed.set(descriptor.id, next);
            for (const extension of ["lx-source", "source"]) {
                const originalPath = `${pluginPath}.${extension}`;
                if (rawSource === undefined || originalPath !== getOriginalSourcePath(pluginPath, integrity)) await fs.rm(originalPath, { force: true });
            }
            if (previous && previous.plugin.path !== pluginPath) await this.removePluginFiles(previous.plugin);
        } catch (error) {
            if (copySettings) {
                const restoredMeta = { ...AppConfig.getConfig("private.pluginMeta") };
                delete restoredMeta[descriptor.id];
                AppConfig.setConfig({ "private.pluginMeta": restoredMeta });
            }
            this.activeEnvironments.delete(descriptor.id);
            if (previous) {
                if (previous.plugin.path !== pluginPath) {
                    await fs.rm(pluginPath, { force: true }).catch(() => undefined);
                    await fs.rm(getIntegrityPath(pluginPath), { force: true }).catch(() => undefined);
                    await fs.rm(`${pluginPath}.lx-source`, { force: true }).catch(() => undefined);
                    await fs.rm(`${pluginPath}.source`, { force: true }).catch(() => undefined);
                }
                await this.writeAtomic(previous.plugin.path, previous.code);
                if (previous.rawSource !== undefined) await this.writeAtomic(getOriginalSourcePath(previous.plugin.path, previous.integrity), previous.rawSource);
                for (const extension of ["lx-source", "source"]) {
                    const originalPath = `${previous.plugin.path}.${extension}`;
                    if (previous.rawSource === undefined || originalPath !== getOriginalSourcePath(previous.plugin.path, previous.integrity)) await fs.rm(originalPath, { force: true }).catch(() => undefined);
                }
                await this.writeAtomic(getIntegrityPath(previous.plugin.path), JSON.stringify(previous.integrity));
                this.installed.set(descriptor.id, previous);
                await this.ensureRuntime(previous).catch(() => undefined);
            } else {
                this.installed.delete(descriptor.id); await this.host.unloadPlugin(descriptor.id).catch(() => undefined);
            }
            if (!previous) {
                await fs.rm(pluginPath, { force: true }).catch(() => undefined);
                await fs.rm(getIntegrityPath(pluginPath), { force: true }).catch(() => undefined);
                await fs.rm(`${pluginPath}.lx-source`, { force: true }).catch(() => undefined);
                await fs.rm(`${pluginPath}.source`, { force: true }).catch(() => undefined);
            }
            throw error;
        } finally {
            this.syncPlugins();
        }
        await this.applyMigratedLxSelection().catch((error) => logger.logError("LX selection migration failed", toError(error)));
        return next.plugin;
    }
    private async installContent(code: string, source?: RemotePluginSource, options: MainImportOptions = {}) {
        let catalog: unknown;
        try {
            catalog = JSON.parse(code.replace(/^\uFEFF/, ""));
        } catch {
            return this.installCode(code, source, options);
        }
        if (Buffer.byteLength(code) > MAX_MANIFEST_BYTES) throw new Error("Plugin manifest exceeds the accepted size");
        assertPlainObject(catalog, "V2 plugin catalog");
        if (catalog.apiVersion !== 2 || !Array.isArray(catalog.plugins) || catalog.plugins.length > MAX_MANIFEST_PLUGINS) throw new Error("A V2 plugin catalog is required");
        const seenIds = new Set<string>();
        const sources: RemotePluginSource[] = [];
        for (const entry of catalog.plugins) {
            assertPlainObject(entry, "V2 catalog entry");
            assertString(entry.id, "plugin ID", 128); assertString(entry.url, "plugin URL", 8192);
            if (seenIds.has(entry.id)) throw new Error("V2 plugin catalog contains duplicate package IDs");
            seenIds.add(entry.id);
            const remote = getRemoteSourceFromUrl(source ? new URL(entry.url, source.url).toString() : entry.url);
            remote.expectedPackageId = entry.id;
            remote.sha256 = parseExpectedSha256(entry.sha256 ?? entry.integrity ?? remote.sha256);
            if (entry.signature !== undefined) {
                assertString(entry.signature, "signature", 16384); remote.signature = entry.signature;
            }
            if (entry.publicKey !== undefined) {
                assertString(entry.publicKey, "public key", 16384); remote.publicKey = entry.publicKey;
            }
            sources.push(remote);
        }
        const selected = source?.expectedPackageId ? sources.filter((remote) => remote.expectedPackageId === source.expectedPackageId) : sources;
        if (source?.expectedPackageId && selected.length !== 1) throw new Error("Plugin update package ID changed");
        for (const remote of selected) await this.installCode(await this.downloadPlugin(remote), remote, options);
    }
    async installPluginFromLocalFile(filePath: string, options: IPlugin.ImportOptions = {}) {
        const source = assertPathAccess(filePath, { extensions: [".js", ".mjs", ".json"] });
        return this.installContent(await this.readCode(source), undefined, { ...this.validateImportOptions(options), locator: source });
    }
    async installPluginFromRemoteUrl(value: string, options?: IPlugin.ImportOptions | string) {
        const remote = getRemoteSourceFromUrl(value.trim());
        const existing = this.plugins.find((plugin) => plugin.sourceUrl === remote.url);
        const source = { ...remote, expectedPackageId: typeof options === "string" ? options : existing?.id };
        return this.installContent(await this.downloadPlugin(source), source, typeof options === "string" ? {} : this.validateImportOptions(options));
    }
    updateAllPlugins() {
        return Promise.allSettled(this.plugins.map((plugin) => {
            const sourceUrl = plugin.sourceUrl ?? plugin.manifest.srcUrl;
            return sourceUrl ? this.installPluginFromRemoteUrl(sourceUrl, plugin.id) : Promise.resolve();
        }));
    }
    private removePluginFiles(plugin: Plugin) {
        return Promise.all([fs.rm(plugin.path, { force: true }), fs.rm(getIntegrityPath(plugin.path), { force: true }),
            fs.rm(`${plugin.path}.lx-source`, { force: true }), fs.rm(`${plugin.path}.source`, { force: true })]);
    }
    uninstallPlugin(id: string) {
        return this.serialize(async () => {
            const record = this.installed.get(id);
            if (!record) return;
            this.installed.delete(id);
            this.activeEnvironments.delete(id);
            await this.host.unloadPlugin(id);
            await this.removePluginFiles(record.plugin);
            this.syncPlugins();
        });
    }
    uninstallAllPlugins() {
        return this.serialize(async () => {
            const plugins = this.plugins;
            this.installed.clear(); this.activeEnvironments.clear();
            await this.host.clearPlugins();
            await Promise.all(plugins.map((plugin) => this.removePluginFiles(plugin)));
            this.syncPlugins();
        });
    }
}
export default new PluginManager();
