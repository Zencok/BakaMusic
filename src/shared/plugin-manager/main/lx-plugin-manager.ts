import { app } from "electron";
import axios from "axios";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { toError } from "@/common/error-util";
import logger from "@shared/logger/main";
import {
    assertPathAccess,
    assertUrl,
} from "@shared/ipc-security/main";
import {
    getLxMusicQualityKeys,
    getLxQualityFallbacks,
    parseLxScriptInfo,
    replaceLxMusicQualities,
    toLxMusicInfo,
} from "../lx-adapter";
import type {
    LxPluginHostDescriptor,
    LxPluginHostUpdateAlert,
} from "../lx-rpc";
import {
    getLxSourceForPlatform,
    type LxPluginDescriptor,
} from "../lx-types";
import type { PluginExecutionEnvironment } from "../rpc";
import type { PluginPlaybackLogEvent } from "../playback-log";
import LxPluginHostClient from "./lx-plugin-host-client";

const MAX_LX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
const MAX_LX_PLUGINS = 100;
const LX_MEDIA_PROBE_ATTEMPTS = 2;
const REMOTE_TIMEOUT_MS = 20_000;
const STATE_FILE_NAME = "state.json";

interface LxPluginIntegrityRecord {
    sha256: string;
    sourceUrl?: string;
    installedAt: string;
}

interface LxActiveSelection {
    configured: boolean;
    hash: string | null;
}

interface InstallOptions {
    activate?: boolean;
    expectedName?: string;
    replaceHash?: string;
}

type EnvironmentProvider = () => PluginExecutionEnvironment;
type ChangeListener = () => void;

function sha256(code: string) {
    return createHash("sha256").update(code, "utf8").digest("hex");
}

function getIntegrityPath(pluginPath: string) {
    return `${pluginPath}.integrity.json`;
}

export default class LxPluginManager {
    private readonly host: LxPluginHostClient;
    private plugins: LxPluginDescriptor[] = [];
    private activeHash: string | null = null;
    private basePath = "";
    private updatesReady = false;
    private readonly pendingUpdateAlerts = new Map<string, LxPluginHostUpdateAlert>();
    private readonly updateInFlight = new Map<string, Promise<void>>();

    constructor(
        private readonly getEnvironment: EnvironmentProvider,
        private readonly onChanged: ChangeListener,
        onPlaybackLog: (event: PluginPlaybackLogEvent) => void,
    ) {
        this.host = new LxPluginHostClient(
            onPlaybackLog,
            (event) => void this.handleUpdateAlert(event),
        );
    }

    private get pluginBasePath() {
        this.basePath ||= path.resolve(app.getPath("userData"), "bakamusic-lx-plugins");
        return this.basePath;
    }

    private get statePath() {
        return path.resolve(this.pluginBasePath, STATE_FILE_NAME);
    }

    get descriptors() {
        return JSON.parse(JSON.stringify(this.plugins.map((plugin) => ({
            ...plugin,
            active: plugin.hash === this.activeHash,
        })))) as LxPluginDescriptor[];
    }

    async setup() {
        await this.ensureDirectory();
        await this.loadAllPlugins();
        this.updatesReady = true;
        const pendingAlerts = [...this.pendingUpdateAlerts.values()];
        this.pendingUpdateAlerts.clear();
        await Promise.all(pendingAlerts.map((event) => this.handleUpdateAlert(event)));
    }

    private async handleUpdateAlert(event: LxPluginHostUpdateAlert) {
        if (!this.updatesReady) {
            this.pendingUpdateAlerts.set(event.hash, event);
            return;
        }
        const plugin = this.plugins.find((item) => item.hash === event.hash);
        if (!plugin) {
            return;
        }
        const updateUrl = event.updateUrl?.trim() || plugin.sourceUrl;
        if (!updateUrl) {
            logger.logInfo("LX plugin announced an update without a download URL", {
                plugin: plugin.name,
                message: event.log,
            });
            return;
        }
        const previous = this.updateInFlight.get(plugin.hash);
        if (previous) {
            return previous;
        }
        const updatePromise = (async () => {
            try {
                await this.installFromRemoteUrl(updateUrl, {
                    activate: plugin.hash === this.activeHash,
                    expectedName: plugin.name,
                    replaceHash: plugin.hash,
                });
                logger.logInfo("LX plugin updated", {
                    plugin: plugin.name,
                    message: event.log,
                });
            } catch (error) {
                logger.logError(`LX plugin update failed: ${plugin.name}`, toError(error), {
                    url: updateUrl,
                    message: event.log,
                });
            }
        })();
        this.updateInFlight.set(plugin.hash, updatePromise);
        try {
            await updatePromise;
        } finally {
            if (this.updateInFlight.get(plugin.hash) === updatePromise) {
                this.updateInFlight.delete(plugin.hash);
            }
        }
    }

    private async ensureDirectory() {
        try {
            const stat = await fs.stat(this.pluginBasePath);
            if (!stat.isDirectory()) {
                await fs.rm(this.pluginBasePath, { force: true });
                throw new Error("LX plugin repository is not a directory");
            }
        } catch {
            await fs.mkdir(this.pluginBasePath, { recursive: true });
        }
    }

    private async readCode(filePath: string) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_LX_PLUGIN_CODE_BYTES) {
            throw new Error("LX plugin code exceeds the accepted size");
        }
        return fs.readFile(filePath, "utf8");
    }

    private async readIntegrity(pluginPath: string, code: string) {
        const integrity = JSON.parse(
            await fs.readFile(getIntegrityPath(pluginPath), "utf8"),
        ) as LxPluginIntegrityRecord;
        if (integrity.sha256 !== sha256(code)) {
            throw new Error("Installed LX plugin integrity verification failed");
        }
        return integrity;
    }

    private async writeJson(filePath: string, value: unknown) {
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
            await fs.rename(temporaryPath, filePath);
        } finally {
            await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
        }
    }

    private async readActiveSelection(): Promise<LxActiveSelection> {
        try {
            const state = JSON.parse(await fs.readFile(this.statePath, "utf8")) as {
                activeHash?: unknown;
            };
            if (!Object.prototype.hasOwnProperty.call(state, "activeHash")) {
                return { configured: false, hash: null };
            }
            if (state.activeHash === null) {
                return { configured: true, hash: null };
            }
            return {
                configured: true,
                hash: typeof state.activeHash === "string"
                    && /^[a-f0-9]{64}$/.test(state.activeHash)
                    ? state.activeHash
                    : null,
            };
        } catch {
            return { configured: false, hash: null };
        }
    }

    private async persistActiveHash() {
        await this.writeJson(this.statePath, { activeHash: this.activeHash });
    }

    private withInstallMetadata(
        descriptor: LxPluginHostDescriptor,
        pluginPath: string,
        sourceUrl?: string,
    ): LxPluginDescriptor {
        return {
            ...descriptor,
            path: pluginPath,
            sourceUrl,
            active: false,
        };
    }

    async loadAllPlugins() {
        await this.ensureDirectory();
        await this.host.clearPlugins();
        const activeSelection = await this.readActiveSelection();
        const nextPlugins: LxPluginDescriptor[] = [];
        const fileNames = await fs.readdir(this.pluginBasePath);
        for (const fileName of fileNames.slice(0, MAX_LX_PLUGINS * 3)) {
            const pluginPath = path.resolve(this.pluginBasePath, fileName);
            if (path.extname(pluginPath).toLocaleLowerCase() !== ".js") {
                continue;
            }
            try {
                const code = await this.readCode(pluginPath);
                const integrity = await this.readIntegrity(pluginPath, code);
                const scriptInfo = parseLxScriptInfo(code, path.basename(pluginPath, ".js"));
                const descriptor = await this.host.loadPlugin({
                    hash: integrity.sha256,
                    code,
                    scriptInfo,
                    environment: this.getEnvironment(),
                });
                nextPlugins.push(this.withInstallMetadata(
                    descriptor,
                    pluginPath,
                    integrity.sourceUrl,
                ));
            } catch (error) {
                logger.logError(`LX plugin load failed: ${fileName}`, toError(error));
            }
        }
        this.plugins = nextPlugins;
        this.activeHash = activeSelection.configured
            ? nextPlugins.some((plugin) => plugin.hash === activeSelection.hash)
                ? activeSelection.hash
                : null
            : nextPlugins[0]?.hash ?? null;
        await this.persistActiveHash();
        this.onChanged();
    }

    private async installCode(
        code: string,
        fallbackName: string,
        sourceUrl?: string,
        options: InstallOptions = {},
    ) {
        if (Buffer.byteLength(code, "utf8") > MAX_LX_PLUGIN_CODE_BYTES) {
            throw new Error("LX plugin code exceeds the accepted size");
        }
        const hash = sha256(code);
        const duplicate = this.plugins.find((plugin) => plugin.hash === hash);
        if (duplicate) {
            if (options.expectedName && duplicate.name !== options.expectedName) {
                throw new Error("LX plugin update name does not match the installed plugin");
            }
            if (options.activate !== false && this.activeHash !== duplicate.hash) {
                this.activeHash = duplicate.hash;
                await this.persistActiveHash();
                this.onChanged();
            }
            return duplicate;
        }
        const scriptInfo = parseLxScriptInfo(code, fallbackName);
        if (options.expectedName && scriptInfo.name !== options.expectedName) {
            throw new Error("LX plugin update name does not match the installed plugin");
        }
        const descriptor = await this.host.loadPlugin({
            hash,
            code,
            scriptInfo,
            environment: this.getEnvironment(),
        });
        const pluginPath = path.resolve(this.pluginBasePath, `${hash}.js`);
        const integrity: LxPluginIntegrityRecord = {
            sha256: hash,
            sourceUrl,
            installedAt: new Date().toISOString(),
        };
        const temporaryPath = `${pluginPath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, code, "utf8");
            await this.writeJson(getIntegrityPath(pluginPath), integrity);
            await fs.rename(temporaryPath, pluginPath);
        } catch (error) {
            await fs.rm(getIntegrityPath(pluginPath), { force: true }).catch((): undefined => undefined);
            await this.host.unloadPlugin(hash).catch((): undefined => undefined);
            throw error;
        } finally {
            await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
        }

        const oldPlugin = options.replaceHash
            ? this.plugins.find((plugin) => plugin.hash === options.replaceHash)
            : this.plugins.find((plugin) => plugin.name === descriptor.name);
        if (oldPlugin) {
            await this.removeFiles(oldPlugin);
            await this.host.unloadPlugin(oldPlugin.hash);
        }
        const installed = this.withInstallMetadata(descriptor, pluginPath, sourceUrl);
        this.plugins = this.plugins
            .filter((plugin) => plugin.hash !== oldPlugin?.hash)
            .concat(installed);
        if (options.activate !== false) {
            this.activeHash = hash;
        } else if (this.activeHash === oldPlugin?.hash) {
            this.activeHash = hash;
        }
        await this.persistActiveHash();
        this.onChanged();
        return installed;
    }

    async installFromLocalFile(filePath: string) {
        const sourcePath = assertPathAccess(filePath, { extensions: [".js"] });
        return this.installCode(
            await this.readCode(sourcePath),
            path.basename(sourcePath, path.extname(sourcePath)),
        );
    }

    async installFromRemoteUrl(urlLike: string, options: InstallOptions = {}) {
        const url = assertUrl(urlLike.trim(), ["https:"], 8192);
        url.searchParams.set("_bakamusic_cache", Date.now().toString());
        const response = await axios.get<string>(url.toString(), {
            responseType: "text",
            transformResponse: [(value) => value],
            timeout: REMOTE_TIMEOUT_MS,
            maxRedirects: 5,
            beforeRedirect(options) {
                if (options.protocol !== "https:") {
                    throw new Error("LX plugin redirect protocol is not accepted");
                }
            },
            maxContentLength: MAX_LX_PLUGIN_CODE_BYTES,
            maxBodyLength: MAX_LX_PLUGIN_CODE_BYTES,
        });
        if (typeof response.data !== "string") {
            throw new Error("LX plugin response is not text");
        }
        return this.installCode(
            response.data,
            path.posix.basename(url.pathname, path.posix.extname(url.pathname)),
            urlLike.trim(),
            options,
        );
    }

    async setActive(hash: string | null) {
        if (hash !== null && !this.plugins.some((plugin) => plugin.hash === hash)) {
            throw new Error("LX plugin is not installed");
        }
        this.activeHash = hash;
        await this.persistActiveHash();
        this.onChanged();
    }

    private async removeFiles(plugin: LxPluginDescriptor) {
        await Promise.all([
            fs.rm(plugin.path, { force: true }),
            fs.rm(getIntegrityPath(plugin.path), { force: true }),
        ]);
    }

    async uninstall(hash: string) {
        const plugin = this.plugins.find((item) => item.hash === hash);
        if (!plugin) {
            return;
        }
        await this.removeFiles(plugin);
        await this.host.unloadPlugin(hash);
        this.plugins = this.plugins.filter((item) => item.hash !== hash);
        if (this.activeHash === hash) {
            this.activeHash = this.plugins[0]?.hash ?? null;
            await this.persistActiveHash();
        }
        this.onChanged();
    }

    getQualityOverride(platform: string) {
        const source = getLxSourceForPlatform(platform);
        const plugin = source ? this.getPluginForSource(source) : undefined;
        const qualities = source ? plugin?.sources[source]?.qualities : undefined;
        return qualities ? [...qualities] : null;
    }

    /**
     * Resolve the LX source selected for a platform.
     *
     * The active LX script remains the first choice.  The `kg` source is also
     * a built-in base source, so keep a deterministic Kugou provider available
     * when the active selection is empty (for example after a fresh install or
     * when the user cleared the global LX selection).  Other sources continue
     * to honour the explicit active selection only.
     */
    private getPluginForSource(source: ReturnType<typeof getLxSourceForPlatform>) {
        if (!source) {
            return undefined;
        }
        const active = this.plugins.find((item) =>
            item.hash === this.activeHash && item.sources[source],
        );
        if (active || source !== "kg") {
            return active;
        }
        return this.plugins.find((item) => item.sources.kg);
    }

    async resolveMediaSource(
        platform: string,
        musicItem: IMusic.IMusicItemPartial,
        quality: IMusic.IQualityKey,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const source = getLxSourceForPlatform(platform);
        const plugin = source ? this.getPluginForSource(source) : undefined;
        const sourceDescriptor = source ? plugin?.sources[source] : undefined;
        if (!source || !plugin || !sourceDescriptor) {
            return null;
        }
        if (!getLxMusicQualityKeys(musicItem, sourceDescriptor.qualities, true).includes(quality)) {
            return null;
        }
        const musicInfo = toLxMusicInfo(
            source,
            replaceLxMusicQualities(
                { ...musicItem },
                sourceDescriptor.qualities,
                true,
            ),
        );
        const qualityCandidates = getLxQualityFallbacks(
            quality,
            sourceDescriptor.qualities,
        );
        let lastError: unknown;
        let attempt = 0;
        for (const candidateQuality of qualityCandidates) {
            for (let probeAttempt = 0; probeAttempt < LX_MEDIA_PROBE_ATTEMPTS; probeAttempt += 1) {
                attempt += 1;
                try {
                    const url = await this.host.invokePlugin({
                        hash: plugin.hash,
                        source,
                        quality: candidateQuality,
                        musicInfo,
                        environment: this.getEnvironment(),
                        pluginName: plugin.name,
                        platform,
                        attempt,
                    });
                    if (url) {
                        return { url, quality: candidateQuality };
                    }
                    break;
                } catch (error) {
                    lastError = error;
                    if (!toError(error).message.startsWith("LX media URL probe failed")) {
                        break;
                    }
                }
            }
        }
        if (lastError) {
            logger.logError("LX playback override failed", toError(lastError), {
                plugin: plugin.name,
                platform,
                quality,
                attemptedQualities: qualityCandidates,
            });
        }
        return null;
    }

    dispose() {
        this.host.dispose();
    }
}
