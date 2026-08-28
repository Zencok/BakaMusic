/**
 * Thumb Bar Util
 */

import { BrowserWindow, nativeImage, nativeTheme } from "electron";
import getResourcePath from "@/common/get-resource-path";
import { t } from "@shared/i18n/main";
import { ResourceName } from "@/common/constant";
import fs from "fs/promises";
import logger from "@shared/logger/main";
import axios from "axios";
import messageBus from "@shared/message-bus/main";
import { toError } from "@/common/error-util";

/**
 * 设置缩略图按钮
 * @param window 当前窗口
 * @param isPlaying 当前是否正在播放音乐
 */
function setThumbBarButtons(window: BrowserWindow, isPlaying?: boolean) {
    if (!window) {
        return;
    }

    window.setThumbarButtons([
        {
            icon: nativeImage.createFromPath(getResourcePath(ResourceName.SKIP_LEFT_ICON)),
            tooltip: t("main.previous_music"),
            click() {
                messageBus.sendCommand("SkipToPrevious");
            },
        },
        {
            icon: nativeImage.createFromPath(
                getResourcePath(isPlaying ? ResourceName.PAUSE_ICON : ResourceName.PLAY_ICON),
            ),
            tooltip: isPlaying
                ? t("media.music_state_pause")
                : t("media.music_state_play"),
            click() {
                messageBus.sendCommand(
                    "TogglePlayerState",
                );
            },
        },
        {
            icon: nativeImage.createFromPath(getResourcePath(ResourceName.SKIP_RIGHT_ICON)),
            tooltip: t("main.next_music"),
            click() {
                messageBus.sendCommand("SkipToNext");
            },
        },
    ]);

}


// Cache each scheme separately so a system theme change immediately selects the
// matching artwork without retaining the image from the previous scheme.
const defaultAlbumCoverCache = new Map<"dark" | "light", Promise<Buffer>>();

function getDefaultAlbumCoverImage() {
    const scheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const cached = defaultAlbumCoverCache.get(scheme);
    if (cached) {
        return cached;
    }

    const resourceName = scheme === "dark"
        ? ResourceName.DEFAULT_ALBUM_COVER_DARK_IMAGE
        : ResourceName.DEFAULT_ALBUM_COVER_LIGHT_IMAGE;
    const loading = fs.readFile(getResourcePath(resourceName));
    defaultAlbumCoverCache.set(scheme, loading);
    return loading;
}

let hookedFlag = false;

/**
 * 设置缩略图
 * @param window 窗口
 * @param src 图片url
 */
async function setThumbImage(window: BrowserWindow, src: string) {
    if (!window) {
        return;
    }

    // only support windows
    if (process.platform !== "win32") {
        return;
    }

    try {
        const hwnd = window.getNativeWindowHandle().readBigUInt64LE(0);

        const taskBarThumbManager = (await import("@native/TaskbarThumbnailManager/TaskbarThumbnailManager.node")).default;

        if (!hookedFlag) {
            taskBarThumbManager.config(hwnd);
            hookedFlag = true;
        }

        let buffer: Buffer;
        if (!src) {
            buffer = await getDefaultAlbumCoverImage();
        } else if (src.startsWith("http")) {
            try {
                buffer = (
                    await axios.get(src, {
                        responseType: "arraybuffer",
                    })
                ).data;
            } catch {
                buffer = await getDefaultAlbumCoverImage();
            }
        } else if (src.startsWith("data:image")) {
            buffer = Buffer.from(src.split(";base64,").pop() ?? "", "base64");
        } else {
            buffer = await getDefaultAlbumCoverImage();
        }

        const size = 106;

        const sharp = (await import("sharp")).default;
        const result = await sharp(buffer)
            .resize(size, size, {
                fit: "cover",
            })
            .png()
            .ensureAlpha(1)
            .raw()
            .toBuffer({
                resolveWithObject: true,
            });

        taskBarThumbManager.sendIconicRepresentation(
            hwnd,
            {
                width: size,
                height: size,
            },
            result.data,
        );
    } catch (ex) {
        logger.logError("Fail to setThumbImage", toError(ex));
    }


}


const ThumbBarManager = {
    setThumbBarButtons,
    setThumbImage,
};

export default ThumbBarManager;
