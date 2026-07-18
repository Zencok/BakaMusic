import { app, dialog } from "electron";
import path from "path";
import PluginManager from "@shared/plugin-manager/main";
import messageBus from "@shared/message-bus/main";
import windowManager from "@main/window-manager";
import logger from "@shared/logger/main";
import { toError } from "@/common/error-util";
import { qualityKeys } from "@/common/constant";

const MAX_DEEP_LINK_LENGTH = 32_768;
const MAX_PLUGIN_URLS = 10;

export function handleDeepLink(url: string) {
    if (!url || url.length > MAX_DEEP_LINK_LENGTH) {
        return;
    }
    void handleDeepLinkImpl(url).catch((error) => {
        logger.logError("Deep link handling failed", toError(error));
    });
}

async function handleDeepLinkImpl(rawUrl: string) {
    const url = new URL(rawUrl);
    if (url.protocol !== "bakamusic:") {
        return;
    }
    await app.whenReady();
    if (url.hostname === "install") {
        await handlePluginInstall(url);
    } else if (url.hostname === "play") {
        handlePlay(url);
    }
}

function parsePluginUrls(url: URL) {
    const rawPluginUrls = url.pathname.slice(1) || url.searchParams.get("plugin");
    if (!rawPluginUrls) {
        return [];
    }
    const values = rawPluginUrls.split(",");
    if (values.length > MAX_PLUGIN_URLS) {
        throw new Error("Deep link contains too many plugin URLs");
    }
    return values.map((value) => {
        const pluginUrl = new URL(decodeURIComponent(value));
        const extension = path.posix.extname(pluginUrl.pathname).toLocaleLowerCase();
        if (pluginUrl.protocol !== "https:" || ![".js", ".json"].includes(extension)) {
            throw new Error("Deep link plugin URL is not accepted");
        }
        return pluginUrl.toString();
    });
}

async function handlePluginInstall(url: URL) {
    const pluginUrls = parsePluginUrls(url);
    if (!pluginUrls.length) {
        return;
    }
    await PluginManager.whenReady();
    windowManager.showMainWindow();
    const owner = windowManager.mainWindow;
    if (!owner) {
        return;
    }
    const hosts = pluginUrls.map((pluginUrl) => new URL(pluginUrl).hostname);
    const result = await dialog.showMessageBox(owner, {
        type: "warning",
        title: "安装插件确认",
        message: `是否安装 ${pluginUrls.length} 个插件？`,
        detail: `来源：${hosts.join("、")}\n安装前将校验 TLS、SHA-256，并在独立插件进程中解析。`,
        buttons: ["安装", "取消"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    });
    if (result.response !== 0) {
        return;
    }
    for (const pluginUrl of pluginUrls) {
        await PluginManager.installPluginFromRemoteUrl(pluginUrl);
    }
}

function handlePlay(url: URL) {
    const platform = url.searchParams.get("platform");
    const id = url.searchParams.get("id");
    const quality = url.searchParams.get("quality") as IMusic.IQualityKey | null;
    if (
        platform
        && id
        && platform.length <= 128
        && id.length <= 2048
        && (!quality || qualityKeys.includes(quality))
    ) {
        messageBus.sendCommand("PlayMusicById", {
            platform,
            id,
            quality: quality || undefined,
        });
    }
}
