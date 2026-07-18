import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, screen, shell } from "electron";
import { IWindowManager } from "@/types/window-manager";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { appUpdateApiSources, githubDownloadMirrors } from "@/common/constant";
import axios from "axios";
import { compare } from "compare-versions";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";
import AppConfig from "@shared/app-config/main";
import {
    assertBoolean,
    assertFiniteNumber,
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    assertString,
    assertUrl,
    grantPathAccess,
    isIpcSenderAllowed,
} from "@shared/ipc-security/main";

const UPDATE_PROGRESS_INTERVAL_MS = 150;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_RENDERER_FILE_BYTES = 64 * 1024 * 1024;
type AppPathName = Parameters<typeof app.getPath>[0];
type OpenDialogProperty = NonNullable<Electron.OpenDialogOptions["properties"]>[number];
type SaveDialogProperty = NonNullable<Electron.SaveDialogOptions["properties"]>[number];
const allowedAppPathNames = new Set<AppPathName>([
    "home",
    "appData",
    "userData",
    "sessionData",
    "temp",
    "desktop",
    "documents",
    "downloads",
    "music",
    "pictures",
    "videos",
    "recent",
    "logs",
    "crashDumps",
]);

interface IActiveUpdateDownload {
    controller: AbortController;
    fileStream: fsSync.WriteStream | null;
    responseStream: Readable | null;
    tempDirectory: string;
}

interface ICompletedUpdateDownload {
    filePath: string;
    tempDirectory: string;
}

function sanitizeUpdateFileName(fileName: string): string {
    const withoutControlCharacters = Array.from(fileName, (character) =>
        character.charCodeAt(0) < 32 ? "_" : character,
    ).join("");
    return withoutControlCharacters
        .replace(/[<>:"/\\|?*]/g, "_")
        .slice(-180) || "bakamusic-update";
}

function sanitizeDialogFilters(filters: unknown): Electron.FileFilter[] | undefined {
    if (!Array.isArray(filters)) {
        return undefined;
    }
    return filters.slice(0, 20).flatMap((filter) => {
        if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
            return [];
        }
        const candidate = filter as { name?: unknown; extensions?: unknown };
        if (
            typeof candidate.name !== "string"
            || candidate.name.length > 128
            || !Array.isArray(candidate.extensions)
        ) {
            return [];
        }
        const extensions = candidate.extensions.filter((extension): extension is string =>
            typeof extension === "string"
            && /^[A-Za-z0-9*+_-]{1,20}$/.test(extension),
        ).slice(0, 32);
        return extensions.length ? [{ name: candidate.name, extensions }] : [];
    });
}

function optionalDialogString(value: unknown, maxLength: number) {
    return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function assertExternalUrl(value: unknown) {
    assertString(value, "external URL", 8192);
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return assertUrl(value, ["https:", "http:"], 8192);
    }
    if (
        parsed.protocol === "mailto:"
        && parsed.pathname.length <= 320
        && /^[^\s@]+@[^\s@]+$/.test(decodeURIComponent(parsed.pathname))
        && !/%0[ad]/i.test(parsed.toString())
    ) {
        return parsed;
    }
    throw new Error("External URL protocol is not accepted");
}

function sanitizeOpenDialogOptions(value: unknown): Electron.OpenDialogOptions {
    assertIpcPayload(value, 64 * 1024);
    assertPlainObject(value, "dialog options");
    const allowedProperties = new Set<OpenDialogProperty>([
        "openFile",
        "openDirectory",
        "multiSelections",
        "showHiddenFiles",
        "createDirectory",
        "promptToCreate",
        "noResolveAliases",
        "treatPackageAsDirectory",
        "dontAddToRecent",
    ]);
    const properties = Array.isArray(value.properties)
        ? value.properties.filter((property): property is OpenDialogProperty =>
            typeof property === "string"
            && allowedProperties.has(property as OpenDialogProperty),
        )
        : undefined;
    let defaultPath: string | undefined;
    if (typeof value.defaultPath === "string") {
        try {
            defaultPath = assertPathAccess(value.defaultPath, { allowMissing: true });
        } catch {
            defaultPath = undefined;
        }
    }
    return {
        title: optionalDialogString(value.title, 256),
        buttonLabel: optionalDialogString(value.buttonLabel, 128),
        message: optionalDialogString(value.message, 1024),
        defaultPath,
        filters: sanitizeDialogFilters(value.filters),
        properties,
    };
}

function sanitizeSaveDialogOptions(value: unknown): Electron.SaveDialogOptions {
    assertIpcPayload(value, 64 * 1024);
    assertPlainObject(value, "dialog options");
    let defaultPath: string | undefined;
    if (typeof value.defaultPath === "string") {
        try {
            defaultPath = assertPathAccess(value.defaultPath, { allowMissing: true });
        } catch {
            defaultPath = undefined;
        }
    }
    const allowedProperties = new Set<SaveDialogProperty>([
        "showHiddenFiles",
        "createDirectory",
        "treatPackageAsDirectory",
        "showOverwriteConfirmation",
        "dontAddToRecent",
    ]);
    const properties = Array.isArray(value.properties)
        ? value.properties.filter((property): property is SaveDialogProperty =>
            typeof property === "string" && allowedProperties.has(property as SaveDialogProperty),
        )
        : undefined;
    return {
        title: optionalDialogString(value.title, 256),
        buttonLabel: optionalDialogString(value.buttonLabel, 128),
        message: optionalDialogString(value.message, 1024),
        nameFieldLabel: optionalDialogString(value.nameFieldLabel, 128),
        defaultPath,
        filters: sanitizeDialogFilters(value.filters),
        showsTagField: value.showsTagField === true,
        properties,
    };
}

class Utils {
    private windowManager!: IWindowManager;
    private readonly activeUpdateDownloads = new Map<number, IActiveUpdateDownload>();
    private readonly availableUpdateDownloads = new Map<number, string[]>();
    private readonly completedUpdateDownloads = new Map<number, ICompletedUpdateDownload>();
    private displaySleepBlockerId: number | null = null;
    /**
     * Immersive fullscreen restore snapshot.
     * On Windows, frameless + maximized windows can fail native setFullScreen;
     * we then fall back to display.bounds coverage and track state here.
     */
    private immersiveRestore: {
        bounds: Electron.Rectangle;
        wasMaximized: boolean;
        usedBoundsFallback: boolean;
    } | null = null;

    public setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        this.windowManager.on("WindowCreated", ({ windowName, browserWindow }) => {
            if (windowName !== "main") {
                return;
            }
            browserWindow.on("enter-full-screen", () => {
                this.setImmersiveSessionEffects(true);
            });
            browserWindow.on("leave-full-screen", () => {
                // A delayed leave event can belong to the failed native attempt
                // immediately before the display-bounds fallback takes over.
                this.setImmersiveSessionEffects(
                    this.immersiveRestore?.usedBoundsFallback === true,
                );
            });
            browserWindow.on("closed", () => {
                this.immersiveRestore = null;
                this.setImmersiveSessionEffects(false);
            });
        });

        const grantConfiguredPaths = () => {
            const downloadPath = AppConfig.getConfig("download.path");
            if (downloadPath) {
                grantPathAccess(downloadPath, true);
            }
            for (const watchPath of AppConfig.getConfig("localMusic.watchDir") ?? []) {
                if (watchPath) {
                    grantPathAccess(watchPath, true);
                }
            }
        };
        grantConfiguredPaths();
        AppConfig.onConfigUpdated((patch) => {
            if ("download.path" in patch || "localMusic.watchDir" in patch) {
                grantConfiguredPaths();
            }
        });

        this.setupFsUtil();
        this.setupAppUtil();
        this.setupWindowUtil();
        this.setupShellUtil();
        this.setupDialogUtil();
    }

    private getMainWindow() {
        const mainWindow = this.windowManager.mainWindow;
        if (!mainWindow || mainWindow.isDestroyed()) {
            return null;
        }
        return mainWindow;
    }

    private isImmersiveFullScreen(mainWindow: BrowserWindow) {
        return mainWindow.isFullScreen() || this.immersiveRestore !== null;
    }

    private notifyMainWindowFullScreen(enabled: boolean) {
        const mainWindow = this.getMainWindow();
        if (!mainWindow) {
            return;
        }
        mainWindow.webContents.send(
            "@shared/utils/main-window-fullscreen-changed",
            enabled,
        );
    }

    private markImmersiveSession(mainWindow: BrowserWindow, active: boolean) {
        // Used by window-manager resize persistence to skip saving fullscreen size.
        (mainWindow as BrowserWindow & {
            __immersiveFullscreen?: boolean;
        }).__immersiveFullscreen = active;
    }

    private setImmersiveSessionEffects(active: boolean) {
        if (active) {
            this.windowManager.setAuxiliaryWindowsSuppressed(true);
            if (
                this.displaySleepBlockerId === null
                || !powerSaveBlocker.isStarted(this.displaySleepBlockerId)
            ) {
                this.displaySleepBlockerId = powerSaveBlocker.start("prevent-display-sleep");
            }
            return;
        }

        if (this.displaySleepBlockerId !== null) {
            if (powerSaveBlocker.isStarted(this.displaySleepBlockerId)) {
                powerSaveBlocker.stop(this.displaySleepBlockerId);
            }
            this.displaySleepBlockerId = null;
        }
        this.windowManager.setAuxiliaryWindowsSuppressed(false);
    }

    private setImmersiveFullScreen(enabled: boolean): boolean {
        const mainWindow = this.getMainWindow();
        if (!mainWindow) {
            if (!enabled) {
                this.setImmersiveSessionEffects(false);
            }
            return false;
        }

        if (enabled) {
            if (this.isImmersiveFullScreen(mainWindow)) {
                this.setImmersiveSessionEffects(true);
                return true;
            }

            const wasMaximized = mainWindow.isMaximized();
            const bounds = mainWindow.getBounds();
            // Native fullscreen from a maximized frameless window is unreliable on Windows.
            if (wasMaximized) {
                mainWindow.unmaximize();
            }

            // Prefer native fullscreen first (covers taskbar / exclusive mode).
            try {
                mainWindow.setFullScreenable(true);
                mainWindow.setFullScreen(true);
            } catch {
                // fall through to bounds fallback
            }

            if (mainWindow.isFullScreen()) {
                this.immersiveRestore = {
                    bounds,
                    wasMaximized,
                    usedBoundsFallback: false,
                };
                this.markImmersiveSession(mainWindow, true);
                this.setImmersiveSessionEffects(true);
                this.notifyMainWindowFullScreen(true);
                return true;
            }

            // Fallback for Windows frameless: cover the full display bounds.
            // On some builds isFullScreen() stays false even after setFullScreen(true),
            // so always keep a reliable bounds path.
            try {
                // Clear a half-applied native fullscreen attempt.
                mainWindow.setFullScreen(false);
            } catch {
                // ignore
            }
            const display = screen.getDisplayMatching(bounds);
            mainWindow.setBounds(display.bounds);
            this.immersiveRestore = {
                bounds,
                wasMaximized,
                usedBoundsFallback: true,
            };
            this.markImmersiveSession(mainWindow, true);
            this.setImmersiveSessionEffects(true);
            this.notifyMainWindowFullScreen(true);
            return true;
        }

        this.markImmersiveSession(mainWindow, false);

        if (mainWindow.isFullScreen()) {
            try {
                mainWindow.setFullScreen(false);
            } catch {
                // ignore
            }
        }

        const restore = this.immersiveRestore;
        this.immersiveRestore = null;

        if (restore) {
            if (restore.usedBoundsFallback || !mainWindow.isFullScreen()) {
                if (restore.wasMaximized) {
                    mainWindow.maximize();
                } else {
                    mainWindow.setBounds(restore.bounds);
                }
            }
        }

        this.setImmersiveSessionEffects(false);
        this.notifyMainWindowFullScreen(false);
        return false;
    }

    private toggleImmersiveFullScreen(): boolean {
        const mainWindow = this.getMainWindow();
        if (!mainWindow) {
            return false;
        }
        return this.setImmersiveFullScreen(!this.isImmersiveFullScreen(mainWindow));
    }

    private setupFsUtil() {
        ipcMain.on("@shared/utils/grant-dropped-path", (event, filePath) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            try {
                assertString(filePath, "dropped path", 32768);
                const stat = fsSync.statSync(filePath);
                grantPathAccess(filePath, stat.isDirectory());
            } catch {
                // Ignore malformed drag-and-drop paths.
            }
        });

        ipcMain.handle("@shared/utils/fs-write-file", async (event, filePath, data, encoding) => {
            assertIpcSender(event, ["main"]);
            assertString(filePath, "path", 32768);
            assertString(data, "data", MAX_RENDERER_FILE_BYTES, true);
            if (encoding !== undefined && encoding !== "utf8" && encoding !== "utf-8") {
                throw new Error("File encoding is not accepted");
            }
            const targetPath = assertPathAccess(filePath, { allowMissing: true });
            const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
            try {
                await fs.writeFile(temporaryPath, data, "utf8");
                await fs.rename(temporaryPath, targetPath);
            } finally {
                await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
            }
        });

        ipcMain.handle("@shared/utils/fs-read-file", async (event, filePath, encoding) => {
            assertIpcSender(event, ["main"]);
            if (encoding !== undefined && encoding !== "utf8" && encoding !== "utf-8") {
                throw new Error("File encoding is not accepted");
            }
            const targetPath = assertPathAccess(filePath);
            const stat = await fs.stat(targetPath);
            if (!stat.isFile() || stat.size > MAX_RENDERER_FILE_BYTES) {
                throw new Error("File is not readable through this bridge");
            }
            return fs.readFile(targetPath, "utf8");
        });

        ipcMain.handle("@shared/utils/fs-is-file", async (event, filePath) => {
            assertIpcSender(event, ["main"]);
            try {
                return (await fs.stat(assertPathAccess(filePath))).isFile();
            } catch {
                return false;
            }
        });

        ipcMain.handle("@shared/utils/fs-is-folder", async (event, filePath) => {
            assertIpcSender(event, ["main"]);
            try {
                return (await fs.stat(assertPathAccess(filePath))).isDirectory();
            } catch {
                return false;
            }
        });

        ipcMain.handle("@shared/utils/fs-remove-file", async (event, filePath) => {
            assertIpcSender(event, ["main"]);
            const targetPath = assertPathAccess(filePath);
            const stat = await fs.stat(targetPath);
            if (!stat.isFile()) {
                throw new Error("Only files may be removed through this bridge");
            }
            await fs.rm(targetPath, { force: true });
        });
    }

    private abortUpdateDownload(senderId: number): void {
        const downloadState = this.activeUpdateDownloads.get(senderId);
        if (!downloadState) {
            return;
        }

        this.activeUpdateDownloads.delete(senderId);
        downloadState.controller.abort();
        downloadState.responseStream?.destroy();
        downloadState.fileStream?.destroy();
    }

    private async removeCompletedUpdateDownload(senderId: number): Promise<void> {
        const completedDownload = this.completedUpdateDownloads.get(senderId);
        if (!completedDownload) {
            return;
        }

        this.completedUpdateDownloads.delete(senderId);
        await fs.rm(completedDownload.tempDirectory, {
            force: true,
            recursive: true,
        }).catch((): undefined => undefined);
    }

    private sendUpdateDownloadProgress(
        sender: Electron.WebContents,
        downloaded: number,
        total: number,
    ): void {
        if (sender.isDestroyed()) {
            return;
        }

        sender.send("@shared/utils/update-download-progress", {
            downloaded,
            total,
        });
    }

    private async downloadUpdateUrl(
        sender: Electron.WebContents,
        url: string,
        downloadState: IActiveUpdateDownload,
    ): Promise<string> {
        const rawFileName = path.basename(new URL(url).pathname) || "bakamusic-update";
        const fileName = sanitizeUpdateFileName(rawFileName);
        const filePath = path.join(downloadState.tempDirectory, fileName);
        const response = await axios.get<Readable>(url, {
            maxRedirects: 5,
            responseType: "stream",
            signal: downloadState.controller.signal,
            timeout: UPDATE_DOWNLOAD_TIMEOUT_MS,
        });

        if (response.status < 200 || response.status >= 300) {
            response.data.destroy();
            throw new Error(`HTTP ${response.status}`);
        }

        const contentLengthHeader = response.headers["content-length"];
        const contentLength = typeof contentLengthHeader === "string" || typeof contentLengthHeader === "number"
            ? contentLengthHeader
            : undefined;
        const total = typeof contentLength === "string" || typeof contentLength === "number"
            ? Number.parseInt(String(contentLength), 10)
            : 0;
        let downloaded = 0;
        let lastProgressAt = 0;
        const currentStream = fsSync.createWriteStream(filePath, { flags: "wx" });
        downloadState.fileStream = currentStream;
        downloadState.responseStream = response.data;

        response.data.on("data", (chunk: Buffer) => {
            downloaded += chunk.length;
            const now = Date.now();
            if (
                now - lastProgressAt >= UPDATE_PROGRESS_INTERVAL_MS ||
                (total > 0 && downloaded >= total)
            ) {
                lastProgressAt = now;
                this.sendUpdateDownloadProgress(sender, downloaded, total);
            }
        });

        try {
            await pipeline(response.data, currentStream, {
                signal: downloadState.controller.signal,
            });
            this.sendUpdateDownloadProgress(sender, downloaded, total);
            const stat = await fs.stat(filePath);
            if (stat.size < 512 * 1024) {
                throw new Error(`File too small (${stat.size} bytes), likely an error page`);
            }

            return filePath;
        } catch (error) {
            response.data.destroy();
            currentStream.destroy();
            await fs.unlink(filePath).catch((): undefined => undefined);
            throw error;
        } finally {
            if (downloadState.fileStream === currentStream) {
                downloadState.fileStream = null;
            }
            if (downloadState.responseStream === response.data) {
                downloadState.responseStream = null;
            }
        }
    }

    private async downloadUpdate(sender: Electron.WebContents): Promise<void> {
        if (sender.isDestroyed()) {
            throw new Error("Update download sender was destroyed");
        }
        const senderId = sender.id;
        const urls = this.availableUpdateDownloads.get(senderId);
        if (!urls?.length) {
            throw new Error("No update download is available");
        }

        this.abortUpdateDownload(senderId);
        await this.removeCompletedUpdateDownload(senderId);
        const tempDirectory = await fs.mkdtemp(path.join(app.getPath("temp"), "bakamusic-update-"));
        const downloadState: IActiveUpdateDownload = {
            controller: new AbortController(),
            fileStream: null,
            responseStream: null,
            tempDirectory,
        };
        this.activeUpdateDownloads.set(senderId, downloadState);
        const abortOnSenderDestroyed = () => this.abortUpdateDownload(senderId);
        sender.once("destroyed", abortOnSenderDestroyed);
        let lastError: unknown;

        try {
            for (const url of urls) {
                try {
                    const filePath = await this.downloadUpdateUrl(sender, url, downloadState);
                    this.completedUpdateDownloads.set(senderId, {
                        filePath,
                        tempDirectory,
                    });
                    return;
                } catch (error) {
                    if (downloadState.controller.signal.aborted) {
                        throw new Error("Download cancelled");
                    }
                    lastError = error;
                }
            }
            throw lastError ?? new Error("All download sources failed");
        } finally {
            sender.removeListener("destroyed", abortOnSenderDestroyed);
            if (this.activeUpdateDownloads.get(senderId) === downloadState) {
                this.activeUpdateDownloads.delete(senderId);
            }
            const completedDownload = this.completedUpdateDownloads.get(senderId);
            if (completedDownload?.tempDirectory !== tempDirectory) {
                await fs.rm(tempDirectory, {
                    force: true,
                    recursive: true,
                }).catch((): undefined => undefined);
            }
        }
    }


    private setupAppUtil() {
        ipcMain.on("@shared/utils/exit-app", (event) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            app.quit();
        });

        ipcMain.handle("@shared/utils/app-get-path", (event, pathName) => {
            assertIpcSender(event, ["main"]);
            assertString(pathName, "pathName", 32);
            if (!allowedAppPathNames.has(pathName as AppPathName)) {
                throw new Error("Application path name is not accepted");
            }
            return app.getPath(pathName as AppPathName);
        });

        ipcMain.handle("@shared/utils/check-update", async (evt) => {
            assertIpcSender(evt, ["main"]);
            const currentVersion = app.getVersion();
            const updateInfo: ICommon.IUpdateInfo = {
                version: currentVersion,
            };
            this.availableUpdateDownloads.delete(evt.sender.id);

            for (const apiUrl of appUpdateApiSources) {
                try {
                    const response = await axios.get(apiUrl, {
                        headers: { Accept: "application/vnd.github.v3+json" },
                        timeout: 10000,
                    });
                    const release = response.data;
                    const latestVersion = (release.tag_name as string).replace(/^v/, "");

                    if (compare(latestVersion, currentVersion, ">")) {
                        const asset = findReleaseAsset(release.assets, process.platform, process.arch);
                        const downloadUrls = asset
                            ? buildMirrorUrls(asset.browser_download_url)
                            : [];

                        updateInfo.update = {
                            version: latestVersion,
                            changeLog: parseReleaseBody(release.body as string),
                            download: downloadUrls,
                        };
                        this.availableUpdateDownloads.set(evt.sender.id, downloadUrls);
                    }
                    return updateInfo;
                } catch {
                    // 尝试下一个源
                }
            }
            return updateInfo;
        });

        ipcMain.on("@shared/utils/clear-cache", (event) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            const mainWindow = this.windowManager.mainWindow;
            if (mainWindow) {
                mainWindow.webContents.session.clearCache?.();
            }
        });

        ipcMain.handle("@shared/utils/get-cache-size", async (event) => {
            assertIpcSender(event, ["main"]);
            const mainWindow = this.windowManager.mainWindow;
            if (mainWindow) {
                return mainWindow.webContents.session.getCacheSize?.();
            }
            return NaN;
        });

        ipcMain.handle("@shared/utils/download-update", async (evt) => {
            assertIpcSender(evt, ["main"]);
            await this.downloadUpdate(evt.sender);
        });

        ipcMain.on("@shared/utils/cancel-update-download", (evt) => {
            if (!isIpcSenderAllowed(evt, ["main"])) {
                return;
            }
            this.abortUpdateDownload(evt.sender.id);
        });

        ipcMain.handle("@shared/utils/install-update", async (evt) => {
            assertIpcSender(evt, ["main"]);
            const completedDownload = this.completedUpdateDownloads.get(evt.sender.id);
            if (!completedDownload) {
                throw new Error("No completed update download is available");
            }
            const openError = await shell.openPath(completedDownload.filePath);
            if (openError) {
                throw new Error(openError);
            }
            app.quit();
        });
    }

    private setupWindowUtil() {
        ipcMain.on("@shared/utils/min-main-window", (event, data) => {
            if (!isIpcSenderAllowed(event, ["main", "lyric", "minimode"])) {
                return;
            }
            try {
                assertPlainObject(data, "window options");
                if (data.skipTaskBar !== undefined) {
                    assertBoolean(data.skipTaskBar, "skipTaskBar");
                }
            } catch {
                return;
            }
            const skipTaskBar = data.skipTaskBar === true;
            const mainWindow = this.windowManager.mainWindow;
            if (mainWindow) {
                if (skipTaskBar) {
                    mainWindow.hide();
                    mainWindow.setSkipTaskbar(true);
                } else {
                    mainWindow.minimize();
                }
            }
        });

        ipcMain.on("@shared/utils/show-main-window", (event) => {
            if (!isIpcSenderAllowed(event, ["main", "lyric", "minimode"])) {
                return;
            }
            this.windowManager.showMainWindow();
        });

        ipcMain.on("@shared/utils/set-lyric-window", (event, enabled) => {
            if (!isIpcSenderAllowed(event, ["main", "lyric", "minimode"])) {
                return;
            }
            try {
                assertBoolean(enabled, "enabled");
            } catch {
                return;
            }
            if (enabled) {
                this.windowManager.showLyricWindow();
            } else {
                this.windowManager.closeLyricWindow();
            }
        });

        ipcMain.on("@shared/utils/set-minimode-window", (event, enabled) => {
            if (!isIpcSenderAllowed(event, ["main", "lyric", "minimode"])) {
                return;
            }
            try {
                assertBoolean(enabled, "enabled");
            } catch {
                return;
            }
            if (enabled) {
                this.windowManager.showMiniModeWindow();
            } else {
                this.windowManager.closeMiniModeWindow();
            }
        });

        ipcMain.handle("@shared/utils/get-current-window-bounds", (evt) => {
            assertIpcSender(evt, ["main", "lyric", "minimode"]);
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            return targetWindow?.getBounds() ?? null;
        });

        ipcMain.handle("@shared/utils/get-all-work-areas", (event) => {
            assertIpcSender(event, ["main", "lyric", "minimode"]);
            return screen.getAllDisplays().map((display) => display.workArea);
        });


        ipcMain.on("@shared/utils/ignore-mouse-event", (evt, ignore) => {
            if (!isIpcSenderAllowed(evt, ["main", "lyric", "minimode"])) {
                return;
            }
            try {
                assertBoolean(ignore, "ignore");
            } catch {
                return;
            }
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (!targetWindow) {
                return;
            }
            targetWindow.setIgnoreMouseEvents(ignore, {
                forward: true,
            });
        });

        ipcMain.on("@shared/utils/set-current-window-bounds", (evt, bounds: Electron.Rectangle) => {
            if (!isIpcSenderAllowed(evt, ["main", "lyric", "minimode"])) {
                return;
            }
            try {
                assertIpcPayload(bounds, 1024);
                assertPlainObject(bounds, "bounds");
                assertFiniteNumber(bounds.width, "bounds.width", 1, 32768);
                assertFiniteNumber(bounds.height, "bounds.height", 1, 32768);
                if (bounds.x !== undefined) {
                    assertFiniteNumber(bounds.x, "bounds.x", -100000, 100000);
                }
                if (bounds.y !== undefined) {
                    assertFiniteNumber(bounds.y, "bounds.y", -100000, 100000);
                }
            } catch {
                return;
            }
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (!targetWindow || !Number.isFinite(bounds?.width) || !Number.isFinite(bounds?.height)) {
                return;
            }

            const currentBounds = targetWindow.getBounds();
            const [minWidth, minHeight] = targetWindow.getMinimumSize();
            const [maxWidth, maxHeight] = targetWindow.getMaximumSize();
            const nextWidth = Math.max(
                minWidth,
                Math.min(Math.round(bounds.width), maxWidth || Number.MAX_SAFE_INTEGER),
            );
            const nextHeight = Math.max(
                minHeight,
                Math.min(Math.round(bounds.height), maxHeight || Number.MAX_SAFE_INTEGER),
            );
            const nextX = Number.isFinite(bounds.x) ? Math.round(bounds.x) : currentBounds.x;
            const nextY = Number.isFinite(bounds.y) ? Math.round(bounds.y) : currentBounds.y;

            targetWindow.setBounds({
                x: nextX,
                y: nextY,
                width: nextWidth,
                height: nextHeight,
            }, false);
        });

        ipcMain.on("@shared/utils/toggle-maximize-main-window", (event) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            const mainWindow = this.windowManager.mainWindow;

            if (mainWindow) {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
            }
        });

        ipcMain.on("@shared/utils/set-main-window-fullscreen", (event, enabled: boolean) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            try {
                assertBoolean(enabled, "enabled");
            } catch {
                return;
            }
            this.setImmersiveFullScreen(Boolean(enabled));
        });

        ipcMain.handle("@shared/utils/toggle-main-window-fullscreen", (event) => {
            assertIpcSender(event, ["main"]);
            return this.toggleImmersiveFullScreen();
        });

        ipcMain.handle("@shared/utils/is-main-window-fullscreen", (event) => {
            assertIpcSender(event, ["main"]);
            const mainWindow = this.getMainWindow();
            if (!mainWindow) {
                return false;
            }
            return this.isImmersiveFullScreen(mainWindow);
        });

        ipcMain.on("@shared/utils/toggle-main-window-visible", (event) => {
            if (!isIpcSenderAllowed(event, ["main", "lyric", "minimode"])) {
                return;
            }
            const mainWindow = this.windowManager.mainWindow;
            if (!mainWindow) {
                this.windowManager.showMainWindow();
                return;
            }

            if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
                mainWindow.show();
            } else {
                mainWindow.hide();
                mainWindow.setSkipTaskbar(true);
            }
        });

    }

    private setupShellUtil() {
        ipcMain.on("@shared/utils/open-url", (event, url) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            try {
                const target = assertExternalUrl(url);
                void shell.openExternal(target.toString());
            } catch {
                // Ignore rejected shell requests.
            }
        });

        ipcMain.on("@shared/utils/open-path", (event, filePath) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            try {
                void shell.openPath(assertPathAccess(filePath));
            } catch {
                // Ignore rejected shell requests.
            }
        });

        ipcMain.handle("@shared/utils/show-item-in-folder", async (event, filePath) => {
            assertIpcSender(event, ["main"]);
            try {
                const targetPath = assertPathAccess(filePath);
                await fs.stat(targetPath);
                shell.showItemInFolder(targetPath);
                return true;
            } catch {
                return false;
            }
        });
    }

    private setupDialogUtil() {
        ipcMain.handle("@shared/utils/show-open-dialog", async (event, options) => {
            assertIpcSender(event, ["main"]);
            const ownerWindow = BrowserWindow.fromWebContents(event.sender);
            if (!ownerWindow) {
                throw new Error("Invalid Window");
            }
            const sanitizedOptions = sanitizeOpenDialogOptions(options);
            const result = await dialog.showOpenDialog(ownerWindow, sanitizedOptions);
            if (!result.canceled) {
                for (const filePath of result.filePaths) {
                    let recursive = sanitizedOptions.properties?.includes("openDirectory") ?? false;
                    try {
                        recursive = (await fs.stat(filePath)).isDirectory();
                    } catch {
                        // Keep the requested selection type.
                    }
                    grantPathAccess(filePath, recursive);
                }
            }
            return result;
        });

        ipcMain.handle("@shared/utils/show-save-dialog", async (event, options) => {
            assertIpcSender(event, ["main"]);
            const ownerWindow = BrowserWindow.fromWebContents(event.sender);
            if (!ownerWindow) {
                throw new Error("Invalid Window");
            }
            const result = await dialog.showSaveDialog(
                ownerWindow,
                sanitizeSaveDialogOptions(options),
            );
            if (!result.canceled && result.filePath) {
                grantPathAccess(result.filePath, false);
            }
            return result;
        });
    }

}


/** 根据平台和架构匹配 Release Asset */
function findReleaseAsset(assets: any[], platform: string, arch: string): any {
    if (platform === "win32") {
        // 优先非 legacy 安装包，排除 portable
        return (
            assets.find((a: any) =>
                a.name.includes("win32-x64") &&
                a.name.endsWith("-setup.exe") &&
                !a.name.includes("legacy"),
            ) ||
            assets.find((a: any) =>
                a.name.includes("win32-x64") && a.name.endsWith("-setup.exe"),
            )
        );
    }
    if (platform === "darwin") {
        const archStr = arch === "arm64" ? "arm64" : "x64";
        return (
            assets.find((a: any) => a.name.includes(`darwin-${archStr}`) && a.name.endsWith(".dmg")) ||
            assets.find((a: any) => a.name.includes("darwin") && a.name.endsWith(".dmg")) ||
            assets.find((a: any) => a.name.includes("darwin") && a.name.endsWith(".zip"))
        );
    }
    if (platform === "linux") {
        return (
            assets.find((a: any) => a.name.includes("linux") && a.name.endsWith(".deb")) ||
            assets.find((a: any) => a.name.includes("linux"))
        );
    }
    return null;
}

/** 为 GitHub 下载链接生成镜像 URL 列表（镜像优先） */
function buildMirrorUrls(originalUrl: string): string[] {
    return githubDownloadMirrors.map((prefix) => `${prefix}${originalUrl}`);
}

/** 将 Release body 解析为 changelog 行数组 */
function parseReleaseBody(body: string): string[] {
    if (!body) return [];
    return body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, 30);
}

export default new Utils();
