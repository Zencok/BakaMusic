import path from "path";
import { app, ipcMain } from "electron";
import originalFs from "fs";
import fs from "fs/promises";
import { rimraf } from "rimraf";
import { IAppConfig } from "@/types/app-config";
import { IWindowManager } from "@/types/window-manager";
import logger from "@shared/logger/main";
import _defaultAppConfig from "@shared/app-config/default-app-config";
import { toError } from "@/common/error-util";
import {
    createChangedConfigPatch,
    createResetConfigUpdate,
    IAppConfigUpdate,
} from "@shared/app-config/config-utils";
import {
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    isIpcSenderAllowed,
} from "@shared/ipc-security/main";

const CONFIG_WRITE_DEBOUNCE_MS = 300;
const rendererWritableConfigKeys = new Set<keyof IAppConfig>([
    "normal.closeBehavior",
    "normal.maxHistoryLength",
    "normal.checkUpdate",
    "normal.autoLoadMore",
    "normal.taskbarThumb",
    "normal.musicListColumnsShown",
    "normal.language",
    "normal.uiStyle",
    "normal.detailAutoHideMusicBar",
    "playMusic.caseSensitiveInSearch",
    "playMusic.defaultQuality",
    "playMusic.whenQualityMissing",
    "playMusic.clickMusicList",
    "playMusic.newSheetDefaultSort",
    "playMusic.playError",
    "playMusic.audioOutputDevice",
    "playMusic.whenDeviceRemoved",
    "lyric.enableStatusBarLyric",
    "lyric.enableDesktopLyric",
    "lyric.lockLyric",
    "lyric.fontData",
    "lyric.fontColor",
    "lyric.applyFontColorOnlyToPlayedLines",
    "lyric.fontSize",
    "lyric.inactiveBrightness",
    "lyric.showTranslation",
    "lyric.showRomanization",
    "shortCut.enableLocal",
    "shortCut.enableGlobal",
    "shortCut.shortcuts",
    "download.path",
    "download.defaultQuality",
    "download.whenQualityMissing",
    "download.concurrency",
    "download.writeMetadata",
    "download.writeMetadataCover",
    "download.writeMetadataLyric",
    "download.downloadLyricFile",
    "download.lyricFileFormat",
    "download.lyricOrder",
    "download.enableWordByWordLyric",
    "plugin.autoUpdatePlugin",
    "plugin.notCheckPluginVersion",
    "network.proxy.enabled",
    "network.proxy.host",
    "network.proxy.port",
    "network.proxy.username",
    "network.proxy.password",
    "backup.resumeBehavior",
    "backup.webdav.url",
    "backup.webdav.username",
    "backup.webdav.password",
    "localMusic.watchDir",
    "private.mainWindowSize",
    "private.lyricWindowPosition",
    "private.lyricWindowSize",
    "private.minimodeWindowPosition",
    "private.pluginMeta",
    "private.minimode",
]);

const booleanConfigKeys = new Set<keyof IAppConfig>([
    "normal.checkUpdate",
    "normal.autoLoadMore",
    "normal.detailAutoHideMusicBar",
    "playMusic.caseSensitiveInSearch",
    "lyric.enableStatusBarLyric",
    "lyric.enableDesktopLyric",
    "lyric.lockLyric",
    "lyric.applyFontColorOnlyToPlayedLines",
    "lyric.showTranslation",
    "lyric.showRomanization",
    "shortCut.enableLocal",
    "shortCut.enableGlobal",
    "download.writeMetadata",
    "download.writeMetadataCover",
    "download.writeMetadataLyric",
    "download.downloadLyricFile",
    "download.enableWordByWordLyric",
    "plugin.autoUpdatePlugin",
    "plugin.notCheckPluginVersion",
    "network.proxy.enabled",
    "private.minimode",
]);

const enumConfigValues = new Map<keyof IAppConfig, ReadonlySet<string>>([
    ["normal.closeBehavior", new Set(["exit_app", "minimize"])],
    ["normal.taskbarThumb", new Set(["window", "artwork"])],
    ["normal.uiStyle", new Set(["glass", "flat"])],
    ["playMusic.defaultQuality", new Set(["mgg", "128k", "192k", "320k", "flac", "flac24bit", "hires", "vinyl", "dolby", "atmos", "atmos_plus", "master"])],
    ["playMusic.whenQualityMissing", new Set(["higher", "lower", "skip"])],
    ["playMusic.clickMusicList", new Set(["normal", "replace"])],
    ["playMusic.newSheetDefaultSort", new Set(["title", "artist", "album", "time", "time-rev"])],
    ["playMusic.playError", new Set(["pause", "skip"])],
    ["playMusic.whenDeviceRemoved", new Set(["pause", "play"])],
    ["download.defaultQuality", new Set(["mgg", "128k", "192k", "320k", "flac", "flac24bit", "hires", "vinyl", "dolby", "atmos", "atmos_plus", "master"])],
    ["download.whenQualityMissing", new Set(["higher", "lower"])],
    ["download.lyricFileFormat", new Set(["lrc", "txt"])],
    ["backup.resumeBehavior", new Set(["append", "overwrite"])],
]);

function isStringArray(
    value: unknown,
    maximum: number,
    allowedValues?: ReadonlySet<string>,
) {
    return Array.isArray(value)
        && value.length <= maximum
        && value.every((item) =>
            typeof item === "string"
            && item.length <= 32_768
            && (!allowedValues || allowedValues.has(item)),
        );
}

function validateRendererConfigValue(key: keyof IAppConfig, value: unknown) {
    if (value === null) {
        return;
    }
    if (booleanConfigKeys.has(key)) {
        if (typeof value !== "boolean") {
            throw new Error(`${key} must be boolean`);
        }
        return;
    }
    const enumValues = enumConfigValues.get(key);
    if (enumValues) {
        if (typeof value !== "string" || !enumValues.has(value)) {
            throw new Error(`${key} is outside its enum`);
        }
        return;
    }
    if (key === "normal.maxHistoryLength") {
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
            throw new Error(`${key} is outside its range`);
        }
        return;
    }
    if (key === "download.concurrency") {
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
            throw new Error(`${key} is outside its range`);
        }
        return;
    }
    if (key === "lyric.fontSize") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 6 || value > 256) {
            throw new Error(`${key} is outside its range`);
        }
        return;
    }
    if (key === "lyric.inactiveBrightness") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`${key} is outside its range`);
        }
        return;
    }
    if (key === "normal.musicListColumnsShown") {
        if (!isStringArray(value, 2, new Set(["duration", "platform"]))) {
            throw new Error(`${key} is not a valid list`);
        }
        return;
    }
    if (key === "download.lyricOrder") {
        if (!isStringArray(value, 3, new Set(["original", "translation", "romanization"]))) {
            throw new Error(`${key} is not a valid list`);
        }
        return;
    }
    if (key === "localMusic.watchDir") {
        if (!isStringArray(value, 128)) {
            throw new Error(`${key} is not a valid path list`);
        }
        for (const watchPath of value as string[]) {
            assertPathAccess(watchPath);
        }
        return;
    }
    if (key === "download.path") {
        if (typeof value !== "string") {
            throw new Error(`${key} is not a path`);
        }
        assertPathAccess(value);
        return;
    }
    if (
        key === "private.mainWindowSize"
        || key === "private.lyricWindowPosition"
        || key === "private.lyricWindowSize"
        || key === "private.minimodeWindowPosition"
    ) {
        assertPlainObject(value, key);
        for (const coordinate of Object.values(value)) {
            if (typeof coordinate !== "number" || !Number.isFinite(coordinate) || Math.abs(coordinate) > 100_000) {
                throw new Error(`${key} contains an invalid coordinate`);
            }
        }
        return;
    }
    if (
        key === "playMusic.audioOutputDevice"
        || key === "lyric.fontData"
        || key === "shortCut.shortcuts"
        || key === "private.pluginMeta"
    ) {
        assertPlainObject(value, key);
        return;
    }
    if (typeof value !== "string" || value.length > 32_768) {
        throw new Error(`${key} is not a bounded string`);
    }
}

class AppConfig {
    private _configPath = "";
    private windowManager!: IWindowManager;
    private config: IAppConfig | null = null;
    private configWriteTimer: NodeJS.Timeout | null = null;

    private onAppConfigUpdatedCallbacks = new Set<(patch: IAppConfig, config: IAppConfig, from: "main" | "renderer") => void>();

    get configPath() {
        if (!this._configPath) {
            this._configPath = path.resolve(app.getPath("userData"), "config.json");
        }
        return this._configPath;
    }

    private writeConfigAtomicSync(config: IAppConfig): void {
        const rawConfig = JSON.stringify(config, undefined, 4);
        const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
        try {
            originalFs.writeFileSync(temporaryPath, rawConfig, "utf-8");
            originalFs.renameSync(temporaryPath, this.configPath);
        } catch (error) {
            originalFs.rmSync(temporaryPath, { force: true });
            throw error;
        }
    }

    private flushConfigWrite = (): void => {
        if (this.configWriteTimer) {
            clearTimeout(this.configWriteTimer);
            this.configWriteTimer = null;
        }
        if (!this.config) {
            return;
        }

        try {
            this.writeConfigAtomicSync(this.config);
        } catch (error) {
            logger.logError("保存配置失败", toError(error));
        }
    };

    private scheduleConfigWrite(): void {
        if (this.configWriteTimer) {
            clearTimeout(this.configWriteTimer);
        }
        this.configWriteTimer = setTimeout(
            this.flushConfigWrite,
            CONFIG_WRITE_DEBOUNCE_MS,
        );
    }


    private async checkPath() {
        // 1. Check dir
        const configDirPath = app.getPath("userData");

        try {
            const res = await fs.stat(configDirPath);
            if (!res.isDirectory()) {
                await rimraf(configDirPath);
                throw new Error("Not a valid path");
            }
        } catch {
            await fs.mkdir(configDirPath, {
                recursive: true,
            });
        }

        // 2. Check file
        try {
            const res = await fs.stat(this.configPath);
            if (!res.isFile()) {
                await rimraf(this.configPath);
                throw new Error("Not a valid path");
            }
        } catch {
            this.writeConfigAtomicSync(_defaultAppConfig);
        }
    }

    async setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        await this.checkPath();
        await this.loadConfig();
        app.on("before-quit", this.flushConfigWrite);

        // Bind events
        // sync config
        ipcMain.handle("@shared/app-config/sync-app-config", (event) => {
            assertIpcSender(event, ["main", "lyric", "minimode"]);
            return this.config;
        });

        ipcMain.on("@shared/app-config/set-app-config", (event, data: IAppConfig) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            /**
             * data: {key: value}
             */
            try {
                assertIpcPayload(data, 512 * 1024);
                assertPlainObject(data, "app config update");
                if (Object.keys(data).some((key) =>
                    !rendererWritableConfigKeys.has(key as keyof IAppConfig),
                )) {
                    throw new Error("App config update contains an unknown key");
                }
                for (const [key, value] of Object.entries(data)) {
                    validateRendererConfigValue(key as keyof IAppConfig, value);
                }
            } catch {
                return;
            }
            this._setConfig(data, "renderer");
        });

        ipcMain.on("@shared/app-config/reset", (event) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            this.reset("renderer");
        });
    }

    public onConfigUpdated(
        callback: (
            patch: IAppConfig,
            config: IAppConfig,
            from: "main" | "renderer",
        ) => void,
    ) {
        this.onAppConfigUpdatedCallbacks.add(callback);
    }

    public offConfigUpdated(
        callback: (
            patch: IAppConfig,
            config: IAppConfig,
            from: "main" | "renderer",
        ) => void,
    ) {
        this.onAppConfigUpdatedCallbacks.delete(callback);
    }

    async migrateOldVersionConfig() {
        if ((this.config?.["$schema-version"] ?? -1) >= 0) {
            return;
        }
        // 1. 升级到v1
        try {
            const oldConfig = this.config as any;
            const newConfig: any = {
                "normal.closeBehavior": oldConfig.normal?.closeBehavior === "exit" ? "exit_app" : oldConfig.normal?.closeBehavior,
                "normal.maxHistoryLength": oldConfig.normal?.maxHistoryLength,
                "normal.checkUpdate": oldConfig.normal?.checkUpdate,
                "normal.autoLoadMore": oldConfig.normal?.autoLoadMore,
                "normal.taskbarThumb": oldConfig.normal?.taskbarThumb,
                "normal.musicListColumnsShown": oldConfig.normal?.musicListColumnsShown,
                "normal.language": oldConfig.normal?.language,

                "playMusic.caseSensitiveInSearch": oldConfig.playMusic?.caseSensitiveInSearch,
                "playMusic.defaultQuality": oldConfig.playMusic?.defaultQuality,
                "playMusic.whenQualityMissing": oldConfig.playMusic?.whenQualityMissing,
                "playMusic.clickMusicList": oldConfig.playMusic?.clickMusicList,
                "playMusic.playError": oldConfig.playMusic?.playError,
                "playMusic.audioOutputDevice": oldConfig.playMusic?.audioOutputDevice,
                "playMusic.whenDeviceRemoved": oldConfig.playMusic?.whenDeviceRemoved,

                "lyric.enableStatusBarLyric": oldConfig.lyric?.enableStatusBarLyric,
                "lyric.enableDesktopLyric": oldConfig.lyric?.enableDesktopLyric,
                "lyric.lockLyric": oldConfig.lyric?.lockLyric,
                "lyric.fontData": oldConfig.lyric?.fontData,
                "lyric.fontColor": oldConfig.lyric?.fontColor,
                "lyric.applyFontColorOnlyToPlayedLines": oldConfig.lyric?.applyFontColorOnlyToPlayedLines,
                "lyric.fontSize": oldConfig.lyric?.fontSize,
                "lyric.inactiveBrightness": oldConfig.lyric?.inactiveBrightness,

                "shortCut.enableLocal": oldConfig.shortCut?.enableLocal,
                "shortCut.enableGlobal": oldConfig.shortCut?.enableGlobal,
                "shortCut.shortcuts": {
                    ...oldConfig.shortCut?.shortcuts,
                    "toggle-main-window-visible": { local: null, global: null },
                },

                "download.path": oldConfig.download?.path,
                "download.defaultQuality": oldConfig.download?.defaultQuality,
                "download.whenQualityMissing": oldConfig.download?.whenQualityMissing,
                "download.concurrency": oldConfig.download?.concurrency,

                "plugin.autoUpdatePlugin": oldConfig.plugin?.autoUpdatePlugin,
                "plugin.notCheckPluginVersion": oldConfig.plugin?.notCheckPluginVersion,

                "network.proxy.enabled": oldConfig.network?.proxy?.enabled,
                "network.proxy.host": oldConfig.network?.proxy?.host,
                "network.proxy.port": oldConfig.network?.proxy?.port,
                "network.proxy.username": oldConfig.network?.proxy?.username,
                "network.proxy.password": oldConfig.network?.proxy?.password,

                "backup.resumeBehavior": oldConfig.backup?.resumeBehavior,
                "backup.webdav.url": oldConfig.backup?.webdav?.url,
                "backup.webdav.username": oldConfig.backup?.webdav?.username,
                "backup.webdav.password": oldConfig.backup?.webdav?.password,

                "localMusic.watchDir": oldConfig.localMusic?.watchDir,

                "private.lyricWindowPosition": oldConfig.private?.lyricWindowPosition,
                "private.minimodeWindowPosition": oldConfig.private?.minimodeWindowPosition,
                "private.pluginMeta": oldConfig.private?.pluginMeta,
                "private.minimode": oldConfig.private?.minimode,
            };
            this.config = newConfig;
            for (const k in _defaultAppConfig) {
                if (newConfig[k] === null || newConfig[k] === undefined) {
                    // @ts-ignore
                    newConfig[k] = _defaultAppConfig[k];
                }
            }
            this.writeConfigAtomicSync(newConfig);
        } catch (e) {
            logger.logError("迁移旧版配置失败", toError(e));
        }
    }

    async loadConfig() {
        try {
            if (!this.config) {
                const rawConfig = await fs.readFile(this.configPath, "utf8");
                this.config = JSON.parse(rawConfig);
                // 升级旧版设置
                await this.migrateOldVersionConfig();
            }
            this.config = {
                ..._defaultAppConfig,
                ...this.config,
            };
        } catch (e) {
            const error = toError(e) as NodeJS.ErrnoException;
            if (e instanceof SyntaxError || error.code === "EISDIR") {
                // JSON 解析异常 / 非文件
                await rimraf(this.configPath);
                await this.checkPath();
            } else if (error.code === "ENOENT") {
                // 文件不存在
                await this.checkPath();
            }
            this.config = { ..._defaultAppConfig };
        }
        return this.config;
    }

    public getAllConfig() {
        return this.config ?? {};
    }

    public reset(from: "main" | "renderer" = "main") {
        const update = createResetConfigUpdate(this.config, _defaultAppConfig);
        this.config = update.config;
        this.scheduleConfigWrite();
        this.broadcastConfigUpdate({
            ...update,
            replace: true,
        });
        this.notifyConfigUpdated(update.patch, update.config, from);
    }

    public getConfig<T extends keyof IAppConfig>(key: T): IAppConfig[T] {
        return this.config?.[key];
    }

    public setConfig(data: IAppConfig) {
        this._setConfig(data, "main");
    }

    private broadcastConfigUpdate(update: IAppConfigUpdate): void {
        try {
            const serializedUpdate = JSON.parse(JSON.stringify(update));
            this.windowManager.getAllWindows().forEach((window) => {
                if (!window.isDestroyed() && window.webContents && !window.webContents.isDestroyed()) {
                    try {
                        window.webContents.send(
                            "@shared/app-config/update-app-config",
                            serializedUpdate,
                        );
                    } catch (error) {
                        logger.logError("发送配置更新失败", toError(error));
                    }
                }
            });
        } catch (error) {
            logger.logError("序列化配置更新失败", toError(error));
        }
    }

    private notifyConfigUpdated(
        patch: IAppConfig,
        config: IAppConfig,
        from: "main" | "renderer",
    ): void {
        for (const callback of this.onAppConfigUpdatedCallbacks) {
            try {
                callback(patch, config, from);
            } catch (error) {
                logger.logError("配置更新回调执行失败", toError(error));
            }
        }
    }

    private _setConfig(data: IAppConfig, from: "main" | "renderer") {
        try {
            const changedPatch = createChangedConfigPatch(this.config, data);
            if (Object.keys(changedPatch).length === 0) {
                return;
            }

            const nextConfig = {
                ..._defaultAppConfig,
                ...this.config,
                ...changedPatch,
            };
            this.config = nextConfig;
            this.scheduleConfigWrite();
            this.broadcastConfigUpdate({ patch: changedPatch });
            this.notifyConfigUpdated(changedPatch, nextConfig, from);
        } catch (error) {
            logger.logError("设置配置失败", toError(error));
        }
    }

}

export default new AppConfig();
