import { app, ipcMain } from "electron";
import axios from "axios";
import { compare } from "compare-versions";
import {
    createHash,
    verify,
} from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { rimraf } from "rimraf";
import { localPluginHash, localPluginName } from "@/common/constant";
import { toError } from "@/common/error-util";
import type { IWindowManager } from "@/types/window-manager";
import AppConfig from "@shared/app-config/main";
import {
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import logger from "@shared/logger/main";
import {
    PluginExecutionEnvironment,
    PluginHostDescriptor,
    PluginMethodName,
    pluginMethodNames,
} from "../rpc";
import localPlugin from "./internal-plugins/local-plugin";
import { Plugin } from "./plugin";
import PluginHostClient from "./plugin-host-client";

const MAX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_PLUGINS = 100;
const REMOTE_TIMEOUT_MS = 20_000;
const pluginMethodSet = new Set<string>(pluginMethodNames);

interface ICallPluginMethodParams {
    hash?: string;
    platform?: string;
    method: PluginMethodName;
    args: unknown[];
}

interface PluginIntegrityRecord {
    sha256: string;
    sourceUrl?: string;
    signature?: string;
    publicKey?: string;
    installedAt: string;
}

interface RemotePluginSource {
    url: string;
    sha256?: string;
    signature?: string;
    publicKey?: string;
}

function sha256(code: string) {
    return createHash("sha256").update(code, "utf8").digest("hex");
}

function parseExpectedSha256(value: unknown) {
    if (typeof value !== "string" || !value) {
        return undefined;
    }
    const normalized = value.trim();
    if (/^[a-f0-9]{64}$/i.test(normalized)) {
        return normalized.toLocaleLowerCase();
    }
    const match = normalized.match(/^sha256-([A-Za-z0-9+/=]+)$/);
    if (match) {
        const digest = Buffer.from(match[1], "base64");
        if (digest.length === 32) {
            return digest.toString("hex");
        }
    }
    throw new Error("Plugin SHA-256 value is not valid");
}

function verifyPluginSignature(
    code: string,
    signature?: string,
    publicKey?: string,
) {
    if (!signature && !publicKey) {
        return;
    }
    if (
        typeof signature !== "string"
        || typeof publicKey !== "string"
        || !signature
        || !publicKey
        || signature.length > 16_384
        || publicKey.length > 16_384
    ) {
        throw new Error("Plugin signature metadata is incomplete");
    }
    const signatureBytes = Buffer.from(signature, "base64");
    if (!signatureBytes.length || !verify(null, Buffer.from(code, "utf8"), publicKey, signatureBytes)) {
        throw new Error("Plugin signature verification failed");
    }
}

function assertHttpsRedirect(options: { protocol?: string }) {
    if (options.protocol !== "https:") {
        throw new Error("Plugin redirect protocol is not accepted");
    }
}

function getIntegrityPath(pluginPath: string) {
    return `${pluginPath}.integrity.json`;
}

function getRemoteSourceFromUrl(urlLike: string): RemotePluginSource {
    const url = assertUrl(urlLike, ["https:"], 8192);
    let expectedHash = url.searchParams.get("sha256") ?? undefined;
    if (url.hash) {
        const fragment = new URLSearchParams(url.hash.slice(1));
        expectedHash = fragment.get("sha256") ?? (
            /^[a-f0-9]{64}$/i.test(url.hash.slice(1)) ? url.hash.slice(1) : expectedHash
        );
    }
    url.hash = "";
    return {
        url: url.toString(),
        sha256: parseExpectedSha256(expectedHash),
    };
}

function validateManifestEntry(
    value: unknown,
    manifestUrl?: string,
): RemotePluginSource {
    assertPlainObject(value, "plugin manifest entry");
    assertString(value.url, "plugin URL", 8192);
    const resolvedUrl = manifestUrl
        ? new URL(value.url, manifestUrl).toString()
        : value.url;
    const source = getRemoteSourceFromUrl(resolvedUrl);
    source.sha256 = parseExpectedSha256(value.sha256 ?? value.integrity ?? source.sha256);
    if (value.signature !== undefined) {
        assertString(value.signature, "plugin signature", 16384);
        source.signature = value.signature;
    }
    if (value.publicKey !== undefined) {
        assertString(value.publicKey, "plugin public key", 16384);
        source.publicKey = value.publicKey;
    }
    return source;
}

class PluginManager {
    private clonedPlugins: IPlugin.IPluginDelegate[] = [];
    private inited = false;
    private _plugins: Plugin[] = [];
    private windowManager!: IWindowManager;
    private _pluginBasePath = "";
    private readonly host = new PluginHostClient();
    private resolveReady!: () => void;
    private readonly readyPromise = new Promise<void>((resolve) => {
        this.resolveReady = resolve;
    });

    public get plugins() {
        return this._plugins;
    }

    public set plugins(newPlugins: Plugin[]) {
        this._plugins = newPlugins;
        this.clonedPlugins = newPlugins.map((plugin) => {
            const delegate = { supportedMethod: [] } as unknown as IPlugin.IPluginDelegate;
            for (const [key, value] of Object.entries(plugin.instance)) {
                if (typeof value === "function") {
                    delegate.supportedMethod.push(key);
                } else {
                    (delegate as unknown as Record<string, unknown>)[key] = value;
                }
            }
            delegate.hash = plugin.hash;
            delegate.path = plugin.path;
            return JSON.parse(JSON.stringify(delegate)) as IPlugin.IPluginDelegate;
        });
    }

    private get pluginBasePath() {
        if (this._pluginBasePath) {
            return this._pluginBasePath;
        }
        const nextPath = path.resolve(app.getPath("userData"), "bakamusic-plugins");
        const legacyPath = path.resolve(app.getPath("userData"), "musicfree-plugins");
        this._pluginBasePath = fsSync.existsSync(nextPath) || !fsSync.existsSync(legacyPath)
            ? nextPath
            : legacyPath;
        return this._pluginBasePath;
    }

    private getEnvironment(platform: string): PluginExecutionEnvironment {
        const rawVariables = AppConfig.getConfig("private.pluginMeta")?.[platform]
            ?.userVariables ?? {};
        const userVariables = Object.fromEntries(
            Object.entries(rawVariables).flatMap(([key, value]) =>
                typeof value === "string" && key.length <= 256 && value.length <= 32_768
                    ? [[key, value]]
                    : [],
            ),
        );
        const environment: PluginExecutionEnvironment = {
            os: process.platform,
            appVersion: app.getVersion(),
            lang: AppConfig.getConfig("normal.language"),
            userVariables,
        };
        if (AppConfig.getConfig("network.proxy.enabled")) {
            try {
                const proxyUrl = new URL(
                    AppConfig.getConfig("network.proxy.host") ?? "",
                );
                if (!["https:", "http:"].includes(proxyUrl.protocol)) {
                    throw new Error("Plugin proxy protocol is not accepted");
                }
                proxyUrl.port = AppConfig.getConfig("network.proxy.port") ?? "";
                proxyUrl.username = AppConfig.getConfig("network.proxy.username") ?? "";
                proxyUrl.password = AppConfig.getConfig("network.proxy.password") ?? "";
                environment.proxyUrl = proxyUrl.toString();
            } catch {
                // Main network setup reports malformed proxy configuration.
            }
        }
        return environment;
    }

    private createPlugin(descriptor: PluginHostDescriptor, pluginPath: string) {
        const platform = typeof descriptor.metadata.platform === "string"
            ? descriptor.metadata.platform
            : "";
        return new Plugin(
            descriptor,
            pluginPath,
            (hash, method, args, environment) =>
                this.host.invokePlugin(hash, method, args, environment),
            () => this.getEnvironment(platform),
        );
    }

    public async setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        this.setupIpcHandlers();
        await this.ensurePluginDirectory();
        await this.loadAllPlugins();
        this.inited = true;
        this.resolveReady();
        app.on("before-quit", () => this.host.dispose());
    }

    public whenReady() {
        return this.inited ? Promise.resolve() : this.readyPromise;
    }

    private setupIpcHandlers() {
        ipcMain.handle("@shared/plugin-manager/call-plugin-method", async (event, data) => {
            assertIpcSender(event, ["main"]);
            assertIpcPayload(data, 8 * 1024 * 1024);
            assertPlainObject(data, "plugin call");
            return this.callPluginMethod(data as unknown as ICallPluginMethodParams);
        });
        ipcMain.handle("@shared/plugin-manager/load-all-plugins", async (event) => {
            assertIpcSender(event, ["main"]);
            if (!this.inited) {
                await this.loadAllPlugins();
            } else {
                this.syncPlugins();
            }
            return this.clonedPlugins;
        });
        ipcMain.handle("@shared/plugin-manager/uninstall-plugin", async (event, hash) => {
            assertIpcSender(event, ["main"]);
            assertString(hash, "plugin hash", 64);
            if (!/^[a-f0-9]{64}$/i.test(hash)) {
                throw new Error("Plugin hash is not valid");
            }
            await this.uninstallPlugin(hash);
            this.syncPlugins();
        });
        ipcMain.handle("@shared/plugin-manager/uninstall-all-plugins", async (event) => {
            assertIpcSender(event, ["main"]);
            await this.uninstallAllPlugins();
            this.syncPlugins();
        });
        ipcMain.handle("@shared/plugin-manager/update-all-plugins", async (event) => {
            assertIpcSender(event, ["main"]);
            return await this.updateAllPlugins();
        });
        ipcMain.handle("@shared/plugin-manager/install-plugin-remote", async (event, urlLike) => {
            assertIpcSender(event, ["main"]);
            assertString(urlLike, "plugin URL", 8192);
            return await this.installPluginFromRemoteUrl(urlLike);
        });
        ipcMain.handle("@shared/plugin-manager/install-plugin-local", async (event, filePath) => {
            assertIpcSender(event, ["main"]);
            assertString(filePath, "plugin path", 32768);
            return await this.installPluginFromLocalFile(filePath);
        });
    }

    private async ensurePluginDirectory() {
        try {
            const stat = await fs.stat(this.pluginBasePath);
            if (!stat.isDirectory()) {
                await rimraf(this.pluginBasePath);
                throw new Error("Plugin repository is not a directory");
            }
        } catch {
            await fs.mkdir(this.pluginBasePath, { recursive: true });
        }
    }

    private async callPluginMethod(data: ICallPluginMethodParams) {
        if (
            !data
            || typeof data !== "object"
            || typeof data.method !== "string"
            || !pluginMethodSet.has(data.method)
            || !Array.isArray(data.args)
            || data.args.length > 16
        ) {
            throw new Error("Plugin method call is not valid");
        }
        let plugin: Plugin | undefined;
        if (data.hash === localPluginHash || data.platform === localPluginName) {
            plugin = localPlugin;
        } else if (typeof data.hash === "string" && data.hash) {
            plugin = this.plugins.find((item) => item.hash === data.hash);
        } else if (typeof data.platform === "string" && data.platform) {
            plugin = this.plugins.find((item) => item.name === data.platform);
        }
        if (!plugin) {
            return null;
        }
        const method = plugin.methods[data.method];
        if (typeof method !== "function") {
            return null;
        }
        return await (method as (...args: unknown[]) => unknown).call(plugin.methods, ...data.args);
    }

    private syncPlugins() {
        const mainWindow = this.windowManager.mainWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
                "@/shared/plugin-manager/sync-plugins",
                this.clonedPlugins,
            );
        }
    }

    private async readBoundedPluginCode(filePath: string) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_PLUGIN_CODE_BYTES) {
            throw new Error("Plugin code exceeds the accepted size");
        }
        return fs.readFile(filePath, "utf8");
    }

    private async readIntegrity(pluginPath: string, code: string) {
        const actualHash = sha256(code);
        const integrityPath = getIntegrityPath(pluginPath);
        let record: PluginIntegrityRecord | null = null;
        try {
            const rawRecord = await fs.readFile(integrityPath, "utf8");
            record = JSON.parse(rawRecord) as PluginIntegrityRecord;
        } catch {
            record = null;
        }
        if (record) {
            if (
                typeof record.sha256 !== "string"
                || record.sha256 !== actualHash
            ) {
                throw new Error("Installed plugin integrity verification failed");
            }
            verifyPluginSignature(code, record.signature, record.publicKey);
            return record;
        }
        const migratedRecord: PluginIntegrityRecord = {
            sha256: actualHash,
            installedAt: new Date().toISOString(),
        };
        await this.writeIntegrity(integrityPath, migratedRecord);
        return migratedRecord;
    }

    private async writeIntegrity(integrityPath: string, record: PluginIntegrityRecord) {
        const temporaryPath = `${integrityPath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2), {
                encoding: "utf8",
                flag: "wx",
            });
            await fs.rename(temporaryPath, integrityPath);
        } finally {
            await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
        }
    }

    private async downloadPlugin(source: RemotePluginSource) {
        const url = assertUrl(source.url, ["https:"], 8192);
        url.searchParams.set("_bakamusic_cache", Date.now().toString());
        const response = await axios.get<string>(url.toString(), {
            responseType: "text",
            timeout: REMOTE_TIMEOUT_MS,
            maxRedirects: 5,
            beforeRedirect: assertHttpsRedirect,
            maxContentLength: MAX_PLUGIN_CODE_BYTES,
            maxBodyLength: MAX_PLUGIN_CODE_BYTES,
            transformResponse: [(value) => value],
        });
        if (typeof response.data !== "string") {
            throw new Error("Plugin response is not text");
        }
        const actualHash = sha256(response.data);
        const expectedHash = parseExpectedSha256(source.sha256);
        if (expectedHash && expectedHash !== actualHash) {
            throw new Error("Plugin SHA-256 verification failed");
        }
        verifyPluginSignature(response.data, source.signature, source.publicKey);
        return {
            code: response.data,
            integrity: {
                sha256: actualHash,
                sourceUrl: source.url,
                signature: source.signature,
                publicKey: source.publicKey,
                installedAt: new Date().toISOString(),
            } satisfies PluginIntegrityRecord,
        };
    }

    private async installPluginCode(code: string, integrity: PluginIntegrityRecord) {
        if (Buffer.byteLength(code, "utf8") > MAX_PLUGIN_CODE_BYTES) {
            throw new Error("Plugin code exceeds the accepted size");
        }
        const actualHash = sha256(code);
        if (integrity.sha256 !== actualHash) {
            throw new Error("Plugin integrity binding does not match the code");
        }
        verifyPluginSignature(code, integrity.signature, integrity.publicKey);
        const descriptor = await this.host.loadPlugin(
            actualHash,
            code,
            this.getEnvironment(""),
        );
        const plugin = this.createPlugin(descriptor, "");
        if (!plugin.name || plugin.hash !== actualHash) {
            await this.host.unloadPlugin(actualHash);
            throw new Error("Plugin metadata is not valid");
        }
        const duplicate = this.plugins.find((item) => item.hash === actualHash);
        if (duplicate) {
            return duplicate;
        }
        const oldVersion = this.plugins.find((item) => item.name === plugin.name);
        if (
            oldVersion
            && !AppConfig.getConfig("plugin.notCheckPluginVersion")
            && compare(oldVersion.instance.version ?? "0.0.0", plugin.instance.version ?? "0.0.0", ">")
        ) {
            await this.host.unloadPlugin(actualHash);
            throw new Error("A newer plugin version is already installed");
        }

        const pluginPath = path.resolve(this.pluginBasePath, `${actualHash}.js`);
        const integrityPath = getIntegrityPath(pluginPath);
        const temporaryPluginPath = `${pluginPath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPluginPath, code, { encoding: "utf8", flag: "wx" });
            await this.writeIntegrity(integrityPath, integrity);
            await fs.rename(temporaryPluginPath, pluginPath);
        } catch (error) {
            await fs.rm(integrityPath, { force: true }).catch((): undefined => undefined);
            throw error;
        } finally {
            await fs.rm(temporaryPluginPath, { force: true }).catch((): undefined => undefined);
        }
        plugin.path = pluginPath;
        plugin.instance._path = pluginPath;

        let nextPlugins = this.plugins.concat(plugin);
        if (oldVersion) {
            nextPlugins = nextPlugins.filter((item) => item.hash !== oldVersion.hash);
            await this.removePluginFiles(oldVersion);
            await this.host.unloadPlugin(oldVersion.hash);
        }
        this.plugins = nextPlugins;
        return plugin;
    }

    private async installRemoteSource(source: RemotePluginSource) {
        const downloaded = await this.downloadPlugin(source);
        return this.installPluginCode(downloaded.code, downloaded.integrity);
    }

    private async readManifest(rawManifest: string, manifestUrl?: string) {
        if (Buffer.byteLength(rawManifest, "utf8") > MAX_MANIFEST_BYTES) {
            throw new Error("Plugin manifest exceeds the accepted size");
        }
        const manifest = JSON.parse(rawManifest) as { plugins?: unknown };
        if (!Array.isArray(manifest.plugins) || manifest.plugins.length > MAX_MANIFEST_PLUGINS) {
            throw new Error("Plugin manifest list is not valid");
        }
        return manifest.plugins.map((entry) => validateManifestEntry(entry, manifestUrl));
    }

    private async downloadManifest(manifestUrl: string) {
        const url = assertUrl(manifestUrl, ["https:"], 8192);
        url.searchParams.set("_bakamusic_cache", Date.now().toString());
        const response = await axios.get<string>(url.toString(), {
            responseType: "text",
            transformResponse: [(value) => value],
            timeout: REMOTE_TIMEOUT_MS,
            maxRedirects: 5,
            beforeRedirect: assertHttpsRedirect,
            maxContentLength: MAX_MANIFEST_BYTES,
            maxBodyLength: MAX_MANIFEST_BYTES,
        });
        return this.readManifest(response.data, manifestUrl);
    }

    public async loadAllPlugins() {
        await this.ensurePluginDirectory();
        await this.host.clearPlugins();
        const fileNames = await fs.readdir(this.pluginBasePath);
        const plugins: Plugin[] = [];
        const hashes = new Set<string>();
        for (const fileName of fileNames.slice(0, 1000)) {
            const pluginPath = path.resolve(this.pluginBasePath, fileName);
            if (path.extname(pluginPath).toLocaleLowerCase() !== ".js") {
                continue;
            }
            try {
                const code = await this.readBoundedPluginCode(pluginPath);
                const integrity = await this.readIntegrity(pluginPath, code);
                if (hashes.has(integrity.sha256)) {
                    continue;
                }
                const descriptor = await this.host.loadPlugin(
                    integrity.sha256,
                    code,
                    this.getEnvironment(""),
                );
                const plugin = this.createPlugin(descriptor, pluginPath);
                if (!plugin.name) {
                    await this.host.unloadPlugin(integrity.sha256);
                    continue;
                }
                hashes.add(plugin.hash);
                plugins.push(plugin);
            } catch (error) {
                logger.logError(`Plugin load failed: ${fileName}`, toError(error));
            }
        }
        this.plugins = plugins;
        this.syncPlugins();
    }

    public async installPluginFromLocalFile(filePath: string) {
        try {
            const sourcePath = assertPathAccess(filePath, { extensions: [".js", ".json"] });
            const extension = path.extname(sourcePath).toLocaleLowerCase();
            if (extension === ".js") {
                const code = await this.readBoundedPluginCode(sourcePath);
                await this.installPluginCode(code, {
                    sha256: sha256(code),
                    installedAt: new Date().toISOString(),
                });
            } else {
                const rawManifest = await this.readBoundedPluginCode(sourcePath);
                const sources = await this.readManifest(rawManifest);
                for (const source of sources) {
                    await this.installRemoteSource(source);
                }
            }
        } finally {
            this.syncPlugins();
        }
    }

    public async installPluginFromRemoteUrl(urlLike: string) {
        try {
            const source = getRemoteSourceFromUrl(urlLike.trim());
            const extension = path.posix.extname(new URL(source.url).pathname).toLocaleLowerCase();
            if (extension === ".js") {
                await this.installRemoteSource(source);
            } else if (extension === ".json") {
                const sources = await this.downloadManifest(source.url);
                for (const pluginSource of sources) {
                    await this.installRemoteSource(pluginSource);
                }
            } else {
                throw new Error("Plugin URL extension is not accepted");
            }
        } finally {
            this.syncPlugins();
        }
    }

    public async updateAllPlugins() {
        return Promise.allSettled(
            this.plugins.map((plugin) =>
                plugin.instance.srcUrl
                    ? this.installPluginFromRemoteUrl(plugin.instance.srcUrl)
                    : Promise.resolve(),
            ),
        );
    }

    private async removePluginFiles(plugin: Plugin) {
        await Promise.all([
            rimraf(plugin.path),
            rimraf(getIntegrityPath(plugin.path)),
        ]);
    }

    public async uninstallAllPlugins() {
        await Promise.all(this.plugins.map((plugin) => this.removePluginFiles(plugin)));
        await this.host.clearPlugins();
        this.plugins = [];
    }

    public async uninstallPlugin(hash: string) {
        const plugin = this.plugins.find((item) => item.hash === hash);
        if (!plugin) {
            return;
        }
        await this.removePluginFiles(plugin);
        await this.host.unloadPlugin(plugin.hash);
        this.plugins = this.plugins.filter((item) => item.hash !== hash);
    }
}

export default new PluginManager();
