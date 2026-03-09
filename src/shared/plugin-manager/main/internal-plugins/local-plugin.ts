import { localPluginHash, localPluginName } from "@/common/constant";
import { Plugin } from "../plugin";
import { addFileScheme, parseLocalMusicItem, parseLocalMusicItemFolder } from "@/common/file-util";
import url from "url";

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

    return null;
}

function localPluginDefine(): IPlugin.IPluginInstance {
    return {
        platform: localPluginName,
        _path: "",
        async getMediaSource(musicItem) {
            return {
                url: addFileScheme(musicItem.url),
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
