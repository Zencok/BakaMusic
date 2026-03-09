import PluginManager from "@shared/plugin-manager/main";
import voidCallback from "@/common/void-callback";
import messageBus from "@shared/message-bus/main";

export function handleDeepLink(url: string) {
    if (!url) {
        return;
    }

    try {
        const urlObj = new URL(url);
        if (urlObj.protocol === "bakamusic:") {
            handleBakaMusicScheme(urlObj);
        }
    } catch {
        // pass
    }
}

async function handleBakaMusicScheme(url: URL) {
    const hostname = url.hostname;
    if (hostname === "install") {
        try {
            const pluginUrlStr =
                url.pathname.slice(1) || url.searchParams.get("plugin");
            const pluginUrls = pluginUrlStr.split(",").map(decodeURIComponent);
            await Promise.all(
                pluginUrls.map((it) => PluginManager.installPluginFromRemoteUrl(it).catch(voidCallback)),
            );
        } catch {
            // pass
        }
    } else if (hostname === "play") {
        const platform = url.searchParams.get("platform");
        const id = url.searchParams.get("id");
        const quality = url.searchParams.get("quality") as IMusic.IQualityKey | null;
        if (platform && id) {
            messageBus.sendCommand("PlayMusicById", { platform, id, quality: quality || undefined });
        }
    }
}

