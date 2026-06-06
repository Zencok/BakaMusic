import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { IWindowManager } from "@/types/main/window-manager";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { appUpdateApiSources, githubDownloadMirrors } from "@/common/constant";
import axios from "axios";
import { compare } from "compare-versions";

const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONUP = 0x0202;
const MK_LBUTTON = 0x0001;

interface IWindowResizeOptions {
    axis: "x" | "y" | "xy";
    startScreenX: number;
    startScreenY: number;
    startWidth: number;
    startHeight: number;
}

class Utils {
    private windowManager: IWindowManager;
    private stopWindowResizeSessionMap = new WeakMap<BrowserWindow, () => void>();

    public setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        this.setupAppUtil();
        this.setupWindowUtil();
        this.setupShellUtil();
        this.setupDialogUtil();
    }


    private setupAppUtil() {
        ipcMain.on("@shared/utils/exit-app", () => {
            app.exit(0);
        });

        ipcMain.handle("@shared/utils/app-get-path", (_, pathName) => {
            return app.getPath(pathName);
        });

        ipcMain.handle("@shared/utils/check-update", async () => {
            const currentVersion = app.getVersion();
            const updateInfo: ICommon.IUpdateInfo = {
                version: currentVersion,
            };

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
                    }
                    return updateInfo;
                } catch {
                    // 尝试下一个源
                }
            }
            return updateInfo;
        });

        ipcMain.on("@shared/utils/clear-cache", () => {
            const mainWindow = this.windowManager.mainWindow;
            if (mainWindow) {
                mainWindow.webContents.session.clearCache?.();
            }
        });

        ipcMain.handle("@shared/utils/get-cache-size", async () => {
            const mainWindow = this.windowManager.mainWindow;
            if (mainWindow) {
                return mainWindow.webContents.session.getCacheSize?.();
            }
            return NaN;
        });

        // 下载更新文件，通过 IPC 事件推送进度
        ipcMain.handle("@shared/utils/download-update", async (evt, urls: string[]) => {
            const tempDir = app.getPath("temp");
            let lastError: unknown;

            for (const url of urls) {
                let filePath = "";
                let fileStream: fsSync.WriteStream | null = null;
                try {
                    const fileName = path.basename(new URL(url).pathname) || "bakamusic-update";
                    filePath = path.join(tempDir, `bakamusic-update-${fileName}`);

                    const response = await axios.get<NodeJS.ReadableStream>(url, {
                        responseType: "stream",
                        maxRedirects: 5,
                    });

                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const total = parseInt(response.headers["content-length"] || "0", 10);
                    let downloaded = 0;

                    fileStream = fsSync.createWriteStream(filePath);

                    await new Promise<void>((res, rej) => {
                        response.data.on("data", (chunk: Buffer) => {
                            downloaded += chunk.length;
                            if (!evt.sender.isDestroyed()) {
                                evt.sender.send("@shared/utils/update-download-progress", { downloaded, total });
                            }
                        });
                        response.data.on("error", rej);
                        response.data.pipe(fileStream!);
                        fileStream!.on("finish", res);
                        fileStream!.on("error", rej);
                    });
                    fileStream = null;

                    // 校验文件大小，防止下载到错误页
                    const stat = await fs.stat(filePath);
                    if (stat.size < 512 * 1024) {
                        throw new Error(`File too small (${stat.size} bytes), likely an error page`);
                    }

                    return filePath;
                } catch (e) {
                    fileStream?.destroy();
                    if (filePath) await fs.unlink(filePath).catch(() => {});
                    lastError = e;
                    // 尝试下一个镜像
                }
            }
            throw lastError ?? new Error("All download sources failed");
        });

        ipcMain.on("@shared/utils/cancel-update-download", () => {
            // net.fetch 不支持 abort，取消由 renderer 侧忽略结果实现
        });

        ipcMain.on("@shared/utils/install-update", (_, filePath: string) => {
            shell.openPath(filePath).then(() => {
                app.quit();
            });
        });
    }

    private setupWindowUtil() {
        ipcMain.on("@shared/utils/min-main-window", (_, { skipTaskBar }) => {
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

        ipcMain.on("@shared/utils/show-main-window", () => {
            this.windowManager.showMainWindow();
        });

        ipcMain.on("@shared/utils/set-lyric-window", (_, enabled) => {
            if (enabled) {
                this.windowManager.showLyricWindow();
            } else {
                this.windowManager.closeLyricWindow();
            }
        });

        ipcMain.on("@shared/utils/set-minimode-window", (_, enabled) => {
            if (enabled) {
                this.windowManager.showMiniModeWindow();
            } else {
                this.windowManager.closeMiniModeWindow();
            }
        });

        ipcMain.handle("@shared/utils/get-current-window-bounds", (evt) => {
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            return targetWindow?.getBounds() ?? null;
        });

        ipcMain.handle("@shared/utils/get-all-work-areas", () => {
            return screen.getAllDisplays().map((display) => display.workArea);
        });


        ipcMain.on("@shared/utils/ignore-mouse-event", (evt, ignore) => {
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (!targetWindow) {
                return;
            }
            targetWindow.setIgnoreMouseEvents(ignore, {
                forward: true,
            });
        });

        ipcMain.on("@shared/utils/set-current-window-size", (evt, size?: { width?: number | Partial<ICommon.ISize>; height?: number }) => {
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (!targetWindow) {
                return;
            }

            let width = size?.width;
            let height = size?.height;

            if (typeof width === "object" && width !== null) {
                height = width.height;
                width = width.width;
            }

            if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) {
                return;
            }

            const [minWidth, minHeight] = targetWindow.getMinimumSize();
            const [maxWidth, maxHeight] = targetWindow.getMaximumSize();
            const nextWidth = Math.max(
                minWidth,
                Math.min(Math.round(width), maxWidth || Number.MAX_SAFE_INTEGER),
            );
            const nextHeight = Math.max(
                minHeight,
                Math.min(Math.round(height), maxHeight || Number.MAX_SAFE_INTEGER),
            );

            targetWindow.setSize(
                nextWidth,
                nextHeight,
            );
        });

        ipcMain.on("@shared/utils/start-current-window-resize", (evt, options?: IWindowResizeOptions) => {
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (process.platform !== "win32" || !targetWindow || !this.isValidWindowResizeOptions(options)) {
                return;
            }

            this.stopWindowResizeSession(targetWindow);

            const resizeWindow = () => {
                if (targetWindow.isDestroyed()) {
                    this.stopWindowResizeSession(targetWindow);
                    return;
                }

                const point = screen.getCursorScreenPoint();
                const deltaX = point.x - options.startScreenX;
                const deltaY = point.y - options.startScreenY;
                let nextWidth = options.startWidth;
                let nextHeight = options.startHeight;

                if (options.axis === "x" || options.axis === "xy") {
                    nextWidth = options.startWidth + deltaX;
                }

                if (options.axis === "y" || options.axis === "xy") {
                    nextHeight = options.startHeight + deltaY;
                }

                this.setWindowSizeSafely(targetWindow, nextWidth, nextHeight);
            };

            const stopResize = () => this.stopWindowResizeSession(targetWindow);
            const resizeTimer = setInterval(resizeWindow, 16);
            const safetyTimer = setTimeout(stopResize, 15000);

            targetWindow.hookWindowMessage(WM_MOUSEMOVE, (wParam: Buffer) => {
                const wParamNumber = wParam.readInt16LE(0);
                if (!(wParamNumber & MK_LBUTTON)) {
                    stopResize();
                    return;
                }
                resizeWindow();
            });
            targetWindow.hookWindowMessage(WM_LBUTTONUP, stopResize);
            targetWindow.once("closed", stopResize);

            this.stopWindowResizeSessionMap.set(targetWindow, () => {
                clearInterval(resizeTimer);
                clearTimeout(safetyTimer);
                if (!targetWindow.isDestroyed()) {
                    targetWindow.unhookWindowMessage(WM_MOUSEMOVE);
                    targetWindow.unhookWindowMessage(WM_LBUTTONUP);
                    targetWindow.off("closed", stopResize);
                }
            });
        });

        ipcMain.on("@shared/utils/stop-current-window-resize", (evt) => {
            const targetWindow = BrowserWindow.fromWebContents(evt.sender);
            if (!targetWindow) {
                return;
            }
            this.stopWindowResizeSession(targetWindow);
        });

        ipcMain.on("@shared/utils/set-current-window-bounds", (evt, bounds: Electron.Rectangle) => {
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

        ipcMain.on("@shared/utils/toggle-maximize-main-window", () => {
            const mainWindow = this.windowManager.mainWindow;

            if (mainWindow) {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
            }
        });

        ipcMain.on("@shared/utils/toggle-main-window-visible", () => {
            const mainWindow = this.windowManager.mainWindow;

            if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
                mainWindow.show();
            } else {
                mainWindow.hide();
                mainWindow.setSkipTaskbar(true);
            }
        });

    }

    private stopWindowResizeSession(targetWindow: BrowserWindow) {
        const stop = this.stopWindowResizeSessionMap.get(targetWindow);
        if (!stop) {
            return;
        }
        this.stopWindowResizeSessionMap.delete(targetWindow);
        stop();
    }

    private isValidWindowResizeOptions(options?: IWindowResizeOptions): options is IWindowResizeOptions {
        return !!options
            && (options.axis === "x" || options.axis === "y" || options.axis === "xy")
            && Number.isFinite(options.startScreenX)
            && Number.isFinite(options.startScreenY)
            && Number.isFinite(options.startWidth)
            && Number.isFinite(options.startHeight);
    }

    private setWindowSizeSafely(targetWindow: BrowserWindow, width: number, height: number) {
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return;
        }

        const [minWidth, minHeight] = targetWindow.getMinimumSize();
        const [maxWidth, maxHeight] = targetWindow.getMaximumSize();
        const nextWidth = Math.max(
            minWidth,
            Math.min(Math.round(width), maxWidth || Number.MAX_SAFE_INTEGER),
        );
        const nextHeight = Math.max(
            minHeight,
            Math.min(Math.round(height), maxHeight || Number.MAX_SAFE_INTEGER),
        );

        targetWindow.setSize(nextWidth, nextHeight);
    }

    private setupShellUtil() {
        ipcMain.on("@shared/utils/open-url", (_, url) => {
            shell.openExternal(url);
        });

        ipcMain.on("@shared/utils/open-path", (_, path) => {
            shell.openPath(path);
        });

        ipcMain.handle("@shared/utils/show-item-in-folder", async (_, path) => {
            try {
                await fs.stat(path);
                shell.showItemInFolder(path);
                return true;
            } catch {
                return false;
            }
        });
    }

    private setupDialogUtil() {
        ipcMain.handle("@shared/utils/show-open-dialog", async (_, options) => {
            const mainWindow = this.windowManager.mainWindow;
            if (!mainWindow) {
                throw new Error("Invalid Window");
            }
            return dialog.showOpenDialog(options);
        });

        ipcMain.handle("@shared/utils/show-save-dialog", async (_, options) => {
            const mainWindow = this.windowManager.mainWindow;
            if (!mainWindow) {
                throw new Error("Invalid Window");
            }
            return dialog.showSaveDialog(options);
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
