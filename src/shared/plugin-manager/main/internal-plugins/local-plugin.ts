import { localPluginHash, localPluginName } from "@/common/constant";
import { Plugin } from "../plugin";
import { addFileScheme, parseLocalMusicItem, parseLocalMusicItemFolder } from "@/common/file-util";
import url from "url";
import {
    LOCAL_MEDIA_PROTOCOL,
    parseLocalMediaUrl,
} from "@shared/local-media/common";
import { grantPathAccess } from "@shared/ipc-security/main";

function getLocalMusicFilePath(musicBase: IMedia.IMediaBase | IMusic.IMusicItemPartial) {
    const localPath =
        (musicBase as IMusic.IMusicItemPartial)?.localPath ||
        (musicBase as IMusic.IMusicItemPartial)?.$$localPath;

    if (localPath) {
        return localPath;
    }

    const musicUrl = (musicBase as IMusic.IMusicItemPartial)?.url;
    if (musicUrl?.startsWith?.("file:")) {
        try {
            return url.fileURLToPath(musicUrl);
        } catch {
            return null;
        }
    }
    if (musicUrl?.startsWith?.(`${LOCAL_MEDIA_PROTOCOL}:`)) {
        try {
            return parseLocalMediaUrl(musicUrl);
        } catch {
            return null;
        }
    }

    return null;
}

function localPluginDefine(): IPlugin.IPluginInstance {
    return {
        platform: localPluginName,
        _path: "",
        async getMediaSource(musicItem) {
            const localFilePath = getLocalMusicFilePath(musicItem);
            if (!localFilePath) {
                return null;
            }

            // Persisted local-library entries may be played after restart,
            // before a dialog/drop event re-grants their path. Grant this
            // exact file just before the media protocol validates it.
            grantPathAccess(localFilePath);

            return {
                url: addFileScheme(localFilePath),
            };
        },
        async getLyric(musicItem) {
            return {
                rawLrc: musicItem.rawLrc,
            };
        },
        async getMusicInfo(musicBase) {
            const localFilePath = getLocalMusicFilePath(musicBase);

            if (!localFilePath) {
                return null;
            }

            const parsedMusicItem = await parseLocalMusicItem(localFilePath);

            return {
                ...parsedMusicItem,
                artwork: (musicBase as IMusic.IMusicItemPartial)?.artwork,
                coverImg: parsedMusicItem.artwork,
            };
        },
        async importMusicItem(filePath) {
            return parseLocalMusicItem(filePath);
        },
        async importMusicSheet(folderPath) {
            return parseLocalMusicItemFolder(folderPath);
        },
    };
}

const localPlugin = new Plugin(localPluginDefine, "");
localPlugin.hash = localPluginHash;
export default localPlugin;
