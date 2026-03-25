import { defaultFont } from "@/common/constant";
import { IAppConfig } from "@/types/app-config";

const _defaultAppConfig: IAppConfig =  {
    "$schema-version": 1,
    "playMusic.whenQualityMissing": "lower",
    "playMusic.defaultQuality": "320k",
    "playMusic.clickMusicList": "replace",
    "playMusic.caseSensitiveInSearch": false,
    "playMusic.newSheetDefaultSort": "time",
    "playMusic.playError": "skip",
    "playMusic.whenDeviceRemoved": "play",
    "normal.taskbarThumb": "window",
    "normal.closeBehavior": "minimize",
    "normal.checkUpdate": true,
    "normal.autoLoadMore": true,
    "normal.maxHistoryLength": 30,
    "download.defaultQuality": "320k",
    "download.whenQualityMissing": "lower",
    "lyric.enableDesktopLyric": false,
    "lyric.alwaysOnTop": false,
    "lyric.lockLyric": false,
    "lyric.fontData": defaultFont,
    "lyric.fontColor": "#fff",
    "lyric.strokeColor": "#b48f1d",
    "lyric.fontSize": 54,
    "shortCut.enableLocal": true,
    "shortCut.enableGlobal": false,
    "download.concurrency": 5,
    "normal.musicListColumnsShown": [],
    "backup.resumeBehavior": "append",
    "normal.language": "zh-CN",
    "private.lyricWindowSize": {
        width: 530,
        height: 163,
    },
};


export default _defaultAppConfig;
