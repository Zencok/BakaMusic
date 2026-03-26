import "./index.scss";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import PathSettingItem from "../../components/PathSettingItem";
import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import Downloader from "@/renderer/core/downloader";
import SvgAsset from "@/renderer/components/SvgAsset";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";
import { useTranslation } from "react-i18next";

type DownloadLyricOrderItem = "original" | "translation" | "romanization";

const concurrencyList = Array(20)
    .fill(0)
    .map((_, index) => index + 1);

const lyricFormatList = ["lrc", "txt"] as const;
const defaultLyricOrder: DownloadLyricOrderItem[] = [
    "romanization",
    "original",
    "translation",
];
const lyricOrderItems: Array<{
    key: DownloadLyricOrderItem;
    labelKey: string;
}> = [
    {
        key: "original",
        labelKey: "settings.download.lyric_original",
    },
    {
        key: "translation",
        labelKey: "settings.download.lyric_translation",
    },
    {
        key: "romanization",
        labelKey: "settings.download.lyric_romanization",
    },
];

function normalizeLyricOrder(value?: DownloadLyricOrderItem[] | null) {
    if (!Array.isArray(value)) {
        return [...defaultLyricOrder];
    }

    const result: DownloadLyricOrderItem[] = [];
    for (const item of value) {
        if (
            (item === "original" || item === "translation" || item === "romanization")
            && !result.includes(item)
        ) {
            result.push(item);
        }
    }

    return result;
}

function LyricOrderSettingItem() {
    const { t } = useTranslation();
    const configValue = useAppConfig("download.lyricOrder");
    const lyricOrder = normalizeLyricOrder(configValue);

    const updateLyricOrder = (nextOrder: DownloadLyricOrderItem[]) => {
        AppConfig.setConfig({
            "download.lyricOrder": nextOrder,
        });
    };

    const toggleLyricType = (item: DownloadLyricOrderItem) => {
        if (lyricOrder.includes(item)) {
            updateLyricOrder(lyricOrder.filter((current) => current !== item));
            return;
        }

        updateLyricOrder([...lyricOrder, item]);
    };

    const moveLyricType = (
        item: DownloadLyricOrderItem,
        direction: -1 | 1,
    ) => {
        const currentIndex = lyricOrder.indexOf(item);
        const targetIndex = currentIndex + direction;

        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= lyricOrder.length) {
            return;
        }

        const nextOrder = [...lyricOrder];
        [nextOrder[currentIndex], nextOrder[targetIndex]] = [
            nextOrder[targetIndex],
            nextOrder[currentIndex],
        ];
        updateLyricOrder(nextOrder);
    };

    return (
        <div className="setting-row setting-view--download-lyric-order">
            <div className="label-container">
                {t("settings.download.lyric_content_order")}
            </div>
            <div className="lyric-order-tip">
                {t("settings.download.lyric_content_order_tip")}
            </div>
            <div className="lyric-order-list">
                {lyricOrderItems.map((item) => {
                    const checked = lyricOrder.includes(item.key);
                    const currentIndex = lyricOrder.indexOf(item.key);

                    return (
                        <div className="lyric-order-item" key={item.key}>
                            <div
                                className={`option-item-container ${checked ? "highlight" : ""}`}
                                role="button"
                                title={t(item.labelKey)}
                                onClick={() => {
                                    toggleLyricType(item.key);
                                }}
                            >
                                <div className="checkbox">
                                    {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
                                </div>
                                {t(item.labelKey)}
                            </div>
                            <div className="lyric-order-actions">
                                <button
                                    type="button"
                                    disabled={!checked || currentIndex <= 0}
                                    onClick={() => {
                                        moveLyricType(item.key, -1);
                                    }}
                                >
                                    {t("settings.download.move_up")}
                                </button>
                                <button
                                    type="button"
                                    disabled={!checked || currentIndex >= lyricOrder.length - 1}
                                    onClick={() => {
                                        moveLyricType(item.key, 1);
                                    }}
                                >
                                    {t("settings.download.move_down")}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function Download() {
    const { t } = useTranslation();
    const writeMetadata = useAppConfig("download.writeMetadata") ?? false;
    const writeMetadataLyric = useAppConfig("download.writeMetadataLyric") ?? true;
    const downloadLyricFile = useAppConfig("download.downloadLyricFile") ?? false;
    const showLyricSettings = (writeMetadata && writeMetadataLyric) || downloadLyricFile;

    return (
        <div className="setting-view--download-container">
            <PathSettingItem
                keyPath="download.path"
                label={t("settings.download.download_folder")}
            ></PathSettingItem>
            <ListBoxSettingItem
                keyPath="download.concurrency"
                options={concurrencyList}
                onChange={(_evt, newConfig) => {
                    Downloader.setDownloadingConcurrency(newConfig);
                }}
                label={t("settings.download.max_concurrency")}
            ></ListBoxSettingItem>
            <RadioGroupSettingItem
                label={t("settings.download.default_download_quality")}
                keyPath="download.defaultQuality"
                options={[
                    "mgg",
                    "128k",
                    "192k",
                    "320k",
                    "flac",
                    "flac24bit",
                    "hires",
                    "dolby",
                    "atmos",
                    "atmos_plus",
                    "master",
                ]}
                renderItem={(item) => t("media.music_quality_" + item)}
            ></RadioGroupSettingItem>
            <RadioGroupSettingItem
                label={t("settings.download.when_quality_missing")}
                keyPath="download.whenQualityMissing"
                options={[
                    "lower",
                    "higher",
                ]}
                renderItem={(item) => t("settings.download.download_" + item + "_quality_version")}
            ></RadioGroupSettingItem>
            <CheckBoxSettingItem
                label={t("settings.download.write_metadata")}
                keyPath="download.writeMetadata"
            ></CheckBoxSettingItem>
            {writeMetadata ? (
                <>
                    <CheckBoxSettingItem
                        label={t("settings.download.write_metadata_cover")}
                        keyPath="download.writeMetadataCover"
                    ></CheckBoxSettingItem>
                    <CheckBoxSettingItem
                        label={t("settings.download.write_metadata_lyric")}
                        keyPath="download.writeMetadataLyric"
                    ></CheckBoxSettingItem>
                </>
            ) : null}
            <CheckBoxSettingItem
                label={t("settings.download.download_lyric_file")}
                keyPath="download.downloadLyricFile"
            ></CheckBoxSettingItem>
            {showLyricSettings ? (
                <>
                    <LyricOrderSettingItem></LyricOrderSettingItem>
                    <CheckBoxSettingItem
                        label={t("settings.download.enable_word_by_word_lyric")}
                        keyPath="download.enableWordByWordLyric"
                    ></CheckBoxSettingItem>
                    {downloadLyricFile ? (
                        <ListBoxSettingItem
                            keyPath="download.lyricFileFormat"
                            options={[...lyricFormatList]}
                            label={t("settings.download.lyric_file_format")}
                            renderItem={(item) => `.${item}`}
                        ></ListBoxSettingItem>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}

