import PluginManager from "@shared/plugin-manager/renderer";

/** Keep MV actions opt-in for plugins and items that actually identify video. */
export function canPlayMusicVideo(musicItem?: IMusic.IMusicItem | null) {
    if (!musicItem || !PluginManager.isSupportFeatureMethod(musicItem.platform, "getMvSource")) {
        return false;
    }

    const item = musicItem as Record<string, unknown>;
    return [
        "mv", "mvId", "mvid", "mvHash", "mvVid",
        "mvCopyrightId", "videoId", "is_video", "bvid",
    ].some((key) => Boolean(item[key]));
}
