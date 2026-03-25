import { app, BrowserWindow, globalShortcut, webContents } from "electron";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { setAutoFreeze } from "immer";

// Suppress Chromium GPU "Check failed: false" errors (non-fatal, Electron 25 known issue)
app.commandLine.appendSwitch("log-level", "3");

// Electron 40 on macOS 26.x can crash during startup when forcing this service
// into the browser process. Keep the optimization on other platforms.
if (process.platform !== "darwin") {
    app.commandLine.appendSwitch("enable-features", "RunVideoCaptureServiceInBrowserProcess");
}

if (!app.isPackaged) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

// Force UTF-8 console output on Windows
if (process.platform === "win32") {
    try {
        execSync("chcp 65001", { stdio: "ignore" });
    } catch { /* ignore */ }
}
import { setupGlobalContext } from "@/shared/global-context/main";
import { setupI18n } from "@/shared/i18n/main";
import { handleDeepLink } from "./deep-link";
import logger from "@shared/logger/main";
import { PlayerState } from "@/common/constant";
import ThumbBarUtil from "@/common/thumb-bar-util";
import windowManager from "@main/window-manager";
import AppConfig from "@shared/app-config/main";
import TrayManager from "@main/tray-manager";
import WindowDrag from "@shared/window-drag/main";
import { IAppConfig } from "@/types/app-config";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import PluginManager from "@shared/plugin-manager/main";
import ServiceManager from "@shared/service-manager/main";
import utils from "@shared/utils/main";
import messageBus from "@shared/message-bus/main";
import shortCut from "@shared/short-cut/main";
import voidCallback from "@/common/void-callback";

// portable
if (process.platform === "win32") {
    try {
        const appPath = app.getPath("exe");
        const portablePath = path.resolve(appPath, "../portable");
        const portableFolderStat = fs.statSync(portablePath);
        if (portableFolderStat.isDirectory()) {
            const appPathNames = ["appData", "userData"];
            appPathNames.forEach((it) => {
                app.setPath(it, path.resolve(portablePath, it));
            });
        }
    } catch {
        // pass
    }
}

setAutoFreeze(false);

const MAIN_MEMORY_LOG_INTERVAL = 15000;

function formatBytes(bytes?: number | null) {
    if (!Number.isFinite(bytes)) {
        return null;
    }

    const megaBytes = (bytes || 0) / 1024 / 1024;
    return `${megaBytes >= 100 ? megaBytes.toFixed(0) : megaBytes.toFixed(1)}MB`;
}

function formatKilobytes(kilobytes?: number | null) {
    if (!Number.isFinite(kilobytes)) {
        return null;
    }

    return formatBytes((kilobytes || 0) * 1024);
}

function getProcessLabels() {
    const labels = new Map<number, string>();

    const mainPid = windowManager.mainWindow?.webContents.getOSProcessId();
    const lyricPid = windowManager.lyricWindow?.webContents.getOSProcessId();
    const miniPid = windowManager.miniModeWindow?.webContents.getOSProcessId();

    if (mainPid) {
        labels.set(mainPid, "main-window");
    }
    if (lyricPid) {
        labels.set(lyricPid, "lyric-window");
    }
    if (miniPid) {
        labels.set(miniPid, "mini-window");
    }

    // Label webview/webContents child processes for memory diagnostics
    try {
        for (const wc of webContents.getAllWebContents()) {
            const pid = wc.getOSProcessId();
            if (pid && !labels.has(pid)) {
                const wcType = wc.getType(); // "window" | "webview" | "backgroundPage" | etc.
                const wcUrl = wc.getURL();
                const shortUrl = wcUrl ? wcUrl.slice(0, 80) : "unknown";
                labels.set(pid, `${wcType}:${shortUrl}`);
            }
        }
    } catch {
        // ignore
    }

    return labels;
}

function startMainMemoryTelemetry() {
    const logSnapshot = (reason: string) => {
        const labels = getProcessLabels();
        const processMemory = process.memoryUsage();
        const metrics = app.getAppMetrics()
            .map((metric: any) => ({
                pid: metric.pid,
                type: metric.type,
                label: labels.get(metric.pid) || metric.serviceName || null,
                workingSet: formatKilobytes(metric.memory?.workingSetSize),
                privateBytes: formatKilobytes(metric.memory?.privateBytes),
                sharedBytes: formatKilobytes(metric.memory?.sharedBytes),
            }))
            .sort((left, right) => {
                const leftWorkingSet = left.workingSet ? parseFloat(left.workingSet) : 0;
                const rightWorkingSet = right.workingSet ? parseFloat(right.workingSet) : 0;
                return rightWorkingSet - leftWorkingSet;
            });

        logger.logInfo("[memory][main]", {
            reason,
            rss: formatBytes(processMemory.rss),
            heapUsed: formatBytes(processMemory.heapUsed),
            heapTotal: formatBytes(processMemory.heapTotal),
            external: formatBytes(processMemory.external),
            arrayBuffers: formatBytes(processMemory.arrayBuffers),
            processes: metrics,
        });
    };

    logSnapshot("ready");

    const intervalId = setInterval(() => {
        logSnapshot("interval");
    }, MAIN_MEMORY_LOG_INTERVAL);

    intervalId.unref?.();

    app.on("before-quit", () => {
        clearInterval(intervalId);
    });
}


if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("bakamusic", process.execPath, [
            path.resolve(process.argv[1]),
        ]);
    }
} else {
    app.setAsDefaultProtocolClient("bakamusic");
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        windowManager.showMainWindow();
    }
});

if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

app.on("second-instance", (_evt, commandLine) => {
    if (windowManager.mainWindow) {
        windowManager.showMainWindow();
    }

    if (process.platform !== "darwin") {
        handleDeepLink(commandLine.pop());
    }
});

app.on("open-url", (_evt, url) => {
    handleDeepLink(url);
});

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
app.whenReady().then(async () => {
    logger.logPerf("App Ready");
    setupGlobalContext();
    await AppConfig.setup(windowManager);

    await setupI18n({
        getDefaultLang() {
            return AppConfig.getConfig("normal.language");
        },
        onLanguageChanged(lang) {
            AppConfig.setConfig({
                "normal.language": lang,
            });
            if (process.platform === "win32") {

                ThumbBarUtil.setThumbBarButtons(windowManager.mainWindow, messageBus.getAppState().playerState === PlayerState.Playing);
            }
        },
    });
    utils.setup(windowManager);
    PluginManager.setup(windowManager);
    TrayManager.setup(windowManager);
    WindowDrag.setup();
    shortCut.setup().then(voidCallback);
    logger.logPerf("Create Main Window");
    // Setup message bus & app state
    messageBus.onAppStateChange((_, patch) => {
        if ("musicItem" in patch) {
            TrayManager.buildTrayMenu();
            const musicItem = patch.musicItem;
            const mainWindow = windowManager.mainWindow;

            if (mainWindow) {
                const thumbStyle = AppConfig.getConfig("normal.taskbarThumb");
                if (process.platform === "win32" && thumbStyle === "artwork") {
                    ThumbBarUtil.setThumbImage(mainWindow, musicItem?.artwork);
                }
                if (musicItem) {
                    mainWindow.setTitle(
                        musicItem.title + (musicItem.artist ? ` - ${musicItem.artist}` : ""),
                    );
                } else {
                    mainWindow.setTitle(app.name);
                }
            }
        } else if ("playerState" in patch) {
            TrayManager.buildTrayMenu();
            const playerState = patch.playerState;

            if (process.platform === "win32") {
                ThumbBarUtil.setThumbBarButtons(windowManager.mainWindow, playerState === PlayerState.Playing);
            }
        } else if ("repeatMode" in patch) {
            TrayManager.buildTrayMenu();
        } else if ("lyricText" in patch && process.platform === "darwin") {
            if (AppConfig.getConfig("lyric.enableStatusBarLyric")) {
                TrayManager.setTitle(patch.lyricText);
            } else {
                TrayManager.setTitle("");
            }
        }
    });

    messageBus.setup(windowManager);

    windowManager.showMainWindow();
    // startMainMemoryTelemetry();

    bootstrap();

});

async function bootstrap() {
    ServiceManager.setup(windowManager);

    const downloadPath = AppConfig.getConfig("download.path");
    if (!downloadPath) {
        AppConfig.setConfig({
            "download.path": app.getPath("downloads"),
        });
    }

    const minimodeEnabled = AppConfig.getConfig("private.minimode");

    if (minimodeEnabled) {
        windowManager.showMiniModeWindow();
    }

    /** 一些初始化设置 */
    // 初始化桌面歌词
    const desktopLyricEnabled = AppConfig.getConfig("lyric.enableDesktopLyric");

    if (desktopLyricEnabled) {
        windowManager.showLyricWindow();
    }

    AppConfig.onConfigUpdated((patch) => {
        // 桌面歌词锁定状态
        if ("lyric.lockLyric" in patch) {
            const lyricWindow = windowManager.lyricWindow;
            const lockState = patch["lyric.lockLyric"];

            if (!lyricWindow) {
                return;
            }
            if (lockState) {
                lyricWindow.setIgnoreMouseEvents(true, {
                    forward: true,
                });
            } else {
                lyricWindow.setIgnoreMouseEvents(false);
            }
        }
        if ("shortCut.enableGlobal" in patch) {
            const enableGlobal = patch["shortCut.enableGlobal"];
            if (enableGlobal) {
                shortCut.registerAllGlobalShortCuts();
            } else {
                shortCut.unregisterAllGlobalShortCuts();
            }
        }
    });


    // 初始化代理
    const proxyConfigKeys: Array<keyof IAppConfig> = [
        "network.proxy.enabled",
        "network.proxy.host",
        "network.proxy.port",
        "network.proxy.username",
        "network.proxy.password",
    ];

    AppConfig.onConfigUpdated((patch, config) => {
        let proxyUpdated = false;
        for (const proxyConfigKey of proxyConfigKeys) {
            if (proxyConfigKey in patch) {
                proxyUpdated = true;
                break;
            }
        }

        if (proxyUpdated) {
            if (config["network.proxy.enabled"]) {
                handleProxy(true, config["network.proxy.host"], config["network.proxy.port"], config["network.proxy.username"], config["network.proxy.password"]);
            } else {
                handleProxy(false);
            }
        }
    });

    handleProxy(
        AppConfig.getConfig("network.proxy.enabled"),
        AppConfig.getConfig("network.proxy.host"),
        AppConfig.getConfig("network.proxy.port"),
        AppConfig.getConfig("network.proxy.username"),
        AppConfig.getConfig("network.proxy.password"),
    );


}


function handleProxy(enabled: boolean, host?: string | null, port?: string | null, username?: string | null, password?: string | null) {
    try {
        if (!enabled) {
            axios.defaults.httpAgent = undefined;
            axios.defaults.httpsAgent = undefined;
        } else if (host) {
            const proxyUrl = new URL(host);
            proxyUrl.port = port;
            proxyUrl.username = username;
            proxyUrl.password = password;
            const agent = new HttpsProxyAgent(proxyUrl);

            axios.defaults.httpAgent = agent;
            axios.defaults.httpsAgent = agent;
        } else {
            throw new Error("Unknown Host");
        }
    } catch {
        axios.defaults.httpAgent = undefined;
        axios.defaults.httpsAgent = undefined;
    }
}
