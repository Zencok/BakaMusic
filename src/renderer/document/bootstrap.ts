import { isPlaybackActive, localPluginHash, PlayerState, RepeatMode, supportLocalMediaType } from "@/common/constant";
import MusicSheet from "../core/music-sheet";
import trackPlayer from "../core/track-player";
import { setAutoFreeze } from "immer";
import Downloader from "../core/downloader";
import AppConfig from "@shared/app-config/renderer";
import { i18n, setupI18n } from "@/shared/i18n/renderer";
import ThemePack from "@/shared/themepack/renderer";
import { setupListeningStatistics } from "../core/listening-statistics";
import ServiceManager from "@shared/service-manager/renderer";
import { CurrentTime, PlayerEvents } from "@renderer/core/track-player/enum";
import { appWindowUtil, fsUtil } from "@shared/utils/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import messageBus from "@shared/message-bus/renderer/main";
import throttle from "lodash.throttle";
import { IAppState } from "@shared/message-bus/type";
import MusicDetail from "@renderer/components/MusicDetail";
import shortCut from "@shared/short-cut/renderer";
import * as Electron from "electron";
import { applyUiStyle } from "@renderer/utils/ui-style";
import { toast } from "react-toastify";


setAutoFreeze(false);

export default async function () {
    await Promise.all([
        AppConfig.setup(),
        PluginManager.setup(),
    ]);
    // Apply UI style as early as possible after config is ready
    applyUiStyle(AppConfig.getConfig("normal.uiStyle"));
    AppConfig.onConfigUpdate((patch, config) => {
        if ("normal.uiStyle" in patch) {
            applyUiStyle(config["normal.uiStyle"]);
        }
    });

    await setupListeningStatistics();
    await Promise.all([
        MusicSheet.frontend.setupMusicSheets(),
        trackPlayer.setup(),
    ]);
    await setupI18n();
    shortCut.setup();
    dropHandler();
    clearDefaultBehavior();
    setupCommandAndEvents();
    setupDeviceChange();
    await Downloader.setupDownloader();
    // 本地服务
    await ServiceManager.setup();

    // 自动更新插件
    if (AppConfig.getConfig("plugin.autoUpdatePlugin")) {
        const lastUpdated = +(localStorage.getItem("pluginLastupdatedTime") || 0);
        const now = Date.now();
        if (Math.abs(now - lastUpdated) > 86400000) {
            localStorage.setItem("pluginLastupdatedTime", `${now}`);
            PluginManager.updateAllPlugins();
        }
    }

}

function getDroppedFilePath(file: File) {
    const webUtils = (Electron as typeof Electron & {
        webUtils?: {
            getPathForFile?: (target: File) => string;
        };
    }).webUtils;

    return webUtils?.getPathForFile?.(file) || (file as File & { path?: string }).path || "";
}

function dropHandler() {
    document.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const validMusicList: IMusic.IMusicItem[] = [];
        const fileList = event.dataTransfer?.files;
        if (!fileList) {
            return;
        }

        for (const f of fileList) {
            const filePath = getDroppedFilePath(f);

            if (!filePath) {
                continue;
            }

            if (f.type === "" && (await fsUtil.isFolder(filePath))) {
                const importedMusicList = await PluginManager.callPluginDelegateMethod(
                    {
                        hash: localPluginHash,
                    },
                    "importMusicSheet",
                    filePath,
                );
                if (importedMusicList) {
                    validMusicList.push(
                        ...importedMusicList,
                    );
                }
            } else if (
                supportLocalMediaType.some((postfix) => filePath.endsWith(postfix))
            ) {
                const importedMusicItem = await PluginManager.callPluginDelegateMethod(
                    {
                        hash: localPluginHash,
                    },
                    "importMusicItem",
                    filePath,
                );
                if (importedMusicItem) {
                    validMusicList.push(importedMusicItem);
                }
            } else if (filePath.endsWith(".mftheme")) {
                // 主题包
                const themeConfig = await ThemePack.installThemePack(filePath);
                if (themeConfig) {
                    await ThemePack.selectTheme(themeConfig);
                }
            }
        }
        if (validMusicList.length) {
            trackPlayer.playMusicWithReplaceQueue(validMusicList);
        }
    });

    document.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
}

function clearDefaultBehavior() {
    const killSpaceBar = function (evt: any) {
        // https://greasyfork.org/en/scripts/25035-disable-space-bar-scrolling/code
        const target = evt.target || {},
            isInput =
                "INPUT" == target.tagName ||
                "TEXTAREA" == target.tagName ||
                "SELECT" == target.tagName ||
                "EMBED" == target.tagName;

        // if we're an input or not a real target exit
        if (isInput || !target.tagName) return;

        // if we're a fake input like the comments exit
        if (
            target &&
            target.getAttribute &&
            target.getAttribute("role") === "textbox"
        )
            return;

        // ignore the space
        if (evt.keyCode === 32) {
            evt.preventDefault();
        }
    };

    document.addEventListener("keydown", killSpaceBar, false);
}


/** 设置事件 */
function setupCommandAndEvents() {
    messageBus.onCommand("SkipToNext", () => {
        trackPlayer.skipToNext();
    });
    messageBus.onCommand("SkipToPrevious", () => {
        trackPlayer.skipToPrev();
    });
    messageBus.onCommand("TogglePlayerState", () => {
        if (isPlaybackActive(trackPlayer.playerState)) {
            trackPlayer.pause();
        } else {
            trackPlayer.resume();
        }
    });
    messageBus.onCommand("SetRepeatMode", (mode) => {
        trackPlayer.setRepeatMode(mode);
    });
    messageBus.onCommand("VolumeUp", (val = 0.04) => {
        trackPlayer.adjustVolume(Math.abs(val));
    });

    messageBus.onCommand("VolumeDown", (val = 0.04) => {
        trackPlayer.adjustVolume(-Math.abs(val));
    });

    messageBus.onCommand("ToggleFavorite", async (item) => {
        const realItem = item || trackPlayer.currentMusic;
        if (!realItem) {
            return;
        }

        if (MusicSheet.frontend.isFavoriteMusic(realItem)) {
            MusicSheet.frontend.removeMusicFromFavorite(realItem);
        } else {
            MusicSheet.frontend.addMusicToFavorite(realItem);
        }
    });

    messageBus.onCommand("ToggleDesktopLyric", () => {
        const enableDesktopLyric = AppConfig.getConfig("lyric.enableDesktopLyric");
        appWindowUtil.setLyricWindow(!enableDesktopLyric);
        AppConfig.setConfig({
            "lyric.enableDesktopLyric": !enableDesktopLyric,
        });
    });

    messageBus.onCommand("OpenMusicDetailPage", () => {
        MusicDetail.show();
    });

    messageBus.onCommand("ToggleMainWindowVisible", () => {
        appWindowUtil.toggleMainWindowVisible();
    });

    messageBus.onCommand("PlayMusicById", (data) => {
        if (!data?.platform || !data?.id) {
            return;
        }

        void trackPlayer
            .playMusicById(data.platform, data.id, data.quality)
            .then(() => {
                toast.success(i18n.t("plugin.play_by_id_success"));
            })
            .catch(() => {
                toast.warn(i18n.t("plugin.play_by_id_failed"));
            });
    });


    const sendAppStateTo = (from: "main" | number) => {
        const appState: IAppState = {
            repeatMode: trackPlayer.repeatMode || RepeatMode.Queue,
            playerState: trackPlayer.playerState || PlayerState.None,
            musicItem: trackPlayer.currentMusicBasicInfo || null,
            lyricText: trackPlayer.lyric?.currentLrc?.lrc || null,
            parsedLrc: trackPlayer.lyric?.currentLrc || null,
            fullLyric: trackPlayer.lyric?.parser?.getLyricItems() || [],
            progress: trackPlayer.progress?.currentTime || 0,
            duration: trackPlayer.progress?.duration || 0,
            lyricClock: {
                anchorProgress: trackPlayer.progress?.currentTime || 0,
                sentAt: Date.now(),
                speed: trackPlayer.speed || 1,
                playerState: trackPlayer.playerState || PlayerState.None,
            },
        };

        messageBus.syncAppState(appState, from);
    };

    messageBus.onCommand("SyncAppState", (_, from) => {
        sendAppStateTo(from);
    });
    sendAppStateTo("main");

    // 状态同步
    trackPlayer.on(PlayerEvents.StateChanged, state => {
        messageBus.syncAppState({
            playerState: state,
            lyricClock: {
                anchorProgress: trackPlayer.progress?.currentTime || 0,
                sentAt: Date.now(),
                speed: trackPlayer.speed || 1,
                playerState: state,
            },
        });
    });

    trackPlayer.on(PlayerEvents.RepeatModeChanged, mode => {
        messageBus.syncAppState({
            repeatMode: mode,
        });
    });

    trackPlayer.on(PlayerEvents.CurrentLyricChanged, lyric => {
        messageBus.syncAppState({
            lyricText: lyric?.lrc ?? null,
            parsedLrc: lyric,
        });
    });

    trackPlayer.on(PlayerEvents.LyricChanged, lyric => {
        messageBus.syncAppState({
            fullLyric: lyric?.getLyricItems?.() || [],
        });
    });

    const progressChangedHandler = throttle((currentTime: CurrentTime) => {
        messageBus.syncAppState({
            progress: currentTime?.currentTime || 0,
            duration: currentTime.duration || 0,
            lyricClock: {
                anchorProgress: currentTime?.currentTime || 0,
                sentAt: Date.now(),
                speed: trackPlayer.speed || 1,
                playerState: trackPlayer.playerState,
            },
        });
    }, 250);

    trackPlayer.on(PlayerEvents.ProgressChanged, progressChangedHandler);

    trackPlayer.on(PlayerEvents.MusicChanged, (musicItem) => {
        if (!musicItem) {
            messageBus.syncAppState({
                musicItem: null,
                lyricText: null,
                fullLyric: [],
                parsedLrc: null,
                progress: 0,
                duration: 0,
            });
            return;
        }

        messageBus.syncAppState({
            musicItem,
            lyricText: null,
            fullLyric: [],
            parsedLrc: null,
            progress: 0,
            duration: 0,
        });
    });
}

async function setupDeviceChange() {
    const getAudioDevices = async (): Promise<MediaDeviceInfo[]> =>
        await navigator.mediaDevices.enumerateDevices().catch((): [] => []);
    let devices = (await getAudioDevices()) || [];

    navigator.mediaDevices.ondevicechange = async () => {
        const newDevices = await getAudioDevices();
        if (
            newDevices.length < devices.length &&
            AppConfig.getConfig("playMusic.whenDeviceRemoved") === "pause"
        ) {
            trackPlayer.pause();
        }
        devices = newDevices;
    };
}
