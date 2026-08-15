import { localPluginName } from "@/common/constant";
import { showQualitySelectPopover } from "@/renderer/components/QualitySelectPopover";
import Downloader from "@/renderer/core/downloader";
import { i18n } from "@/shared/i18n/renderer";
import AppConfig from "@shared/app-config/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import { toast } from "react-toastify";
import { getPreferredQualityChoices, resolveMusicQualityChoices } from "./music-quality";

function getDownloadQualityModalTitle() {
    return i18n.language?.startsWith("zh")
        ? "选择下载音质"
        : "Select Download Quality";
}

export async function promptDownloadWithQuality(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
    options?: {
        anchor?: HTMLElement | DOMRect | null;
    },
) {
    const items = Array.isArray(musicItems) ? musicItems : [musicItems];
    const validItems = items.filter(
        (item) => item && item.platform !== localPluginName && !Downloader.isDownloaded(item),
    );

    if (!validItems.length) {
        return;
    }

    const t = i18n.t.bind(i18n);
    const defaultValue = AppConfig.getConfig("download.defaultQuality");

    const lxQualityOverrides = validItems.flatMap((item) => {
        const qualities = PluginManager.getLxQualityOverride(item.platform);
        return qualities ? [PluginManager.getMediaQualityKeys(item)] : [];
    });
    const allowedQualities = lxQualityOverrides.length
        ? lxQualityOverrides.reduce((commonQualities, qualities) =>
            commonQualities.filter((quality) => qualities.includes(quality)),
        )
        : undefined;
    let choices = getPreferredQualityChoices(t, undefined, allowedQualities);
    if (validItems.length === 1) {
        const validItem = validItems[0];
        if (!validItem) {
            return;
        }
        const result = await resolveMusicQualityChoices(validItem, t);
        choices = result.choices;

        if (!choices.length) {
            toast.warn(t("music_bar.no_music_quality_available"));
            return;
        }
    }

    showQualitySelectPopover({
        title: getDownloadQualityModalTitle(),
        defaultValue: defaultValue ?? undefined,
        choices,
        anchor: options?.anchor,
        onSelect(value) {
            const downloadItems = Array.isArray(musicItems) ? validItems : validItems[0];
            if (!downloadItems) {
                return;
            }

            Downloader.startDownload(
                downloadItems,
                value,
            );
        },
    });
}
