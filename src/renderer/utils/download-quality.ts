import { localPluginName } from "@/common/constant";
import { showModal } from "@/renderer/components/Modal";
import Downloader from "@/renderer/core/downloader";
import { i18n } from "@/shared/i18n/renderer";
import AppConfig from "@shared/app-config/renderer";
import { toast } from "react-toastify";
import { getPreferredQualityChoices, resolveMusicQualityChoices } from "./music-quality";

function getDownloadQualityModalTitle() {
    return i18n.language?.startsWith("zh")
        ? "选择下载音质"
        : "Select Download Quality";
}

export async function promptDownloadWithQuality(
    musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
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

    let choices = getPreferredQualityChoices(t);
    if (validItems.length === 1) {
        const result = await resolveMusicQualityChoices(validItems[0], t);
        choices = result.choices;

        if (!choices.length) {
            toast.warn(t("music_bar.no_music_quality_available"));
            return;
        }
    }

    showModal("SelectOne", {
        title: getDownloadQualityModalTitle(),
        defaultValue,
        choices,
        autoOkOnSelect: true,
        onOk(value) {
            Downloader.startDownload(
                Array.isArray(musicItems) ? validItems : validItems[0],
                value as IMusic.IQualityKey,
            );
        },
    });
}
