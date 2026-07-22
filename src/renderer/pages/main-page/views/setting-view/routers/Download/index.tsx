import "./index.scss";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import PathSettingItem from "../../components/PathSettingItem";
import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import SettingGroup from "../../components/SettingGroup";
import Downloader from "@/renderer/core/downloader";
import SvgAsset from "@/renderer/components/SvgAsset";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import {
    DEFAULT_FILE_NAMING_CONFIG,
    FILE_NAMING_PRESETS,
    getPresetTemplate,
    previewFilename,
    resolveFileNamingTemplate,
    validateTemplate,
    type FileNamingPreset,
    type FileNamingType,
} from "@/common/file-naming-formatter";

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
            <div className="lyric-order-content">
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
                                        aria-label={t("settings.download.move_up")}
                                        type="button"
                                        title={t("settings.download.move_up")}
                                        disabled={!checked || currentIndex <= 0}
                                        onClick={() => {
                                            moveLyricType(item.key, -1);
                                        }}
                                    >
                                        <SvgAsset iconName="chevron-double-up" size={16}></SvgAsset>
                                    </button>
                                    <button
                                        aria-label={t("settings.download.move_down")}
                                        type="button"
                                        title={t("settings.download.move_down")}
                                        disabled={!checked || currentIndex >= lyricOrder.length - 1}
                                        onClick={() => {
                                            moveLyricType(item.key, 1);
                                        }}
                                    >
                                        <SvgAsset iconName="chevron-double-down" size={16}></SvgAsset>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function FileNamingSettingGroup() {
    const { t } = useTranslation();
    const fileNamingType = (useAppConfig("download.fileNamingType")
        ?? DEFAULT_FILE_NAMING_CONFIG.type) as FileNamingType;
    const fileNamingPreset = (useAppConfig("download.fileNamingPreset")
        ?? DEFAULT_FILE_NAMING_CONFIG.preset) as FileNamingPreset;
    const fileNamingCustom = useAppConfig("download.fileNamingCustom")
        ?? DEFAULT_FILE_NAMING_CONFIG.custom
        ?? "{title}-{artist}";

    const [customDraft, setCustomDraft] = useState(fileNamingCustom);
    const [customError, setCustomError] = useState<string | null>(null);

    useEffect(() => {
        setCustomDraft(fileNamingCustom);
        setCustomError(null);
    }, [fileNamingCustom]);

    const activeTemplate = useMemo(() => {
        if (fileNamingType === "custom") {
            return customDraft.trim() || fileNamingCustom;
        }
        return resolveFileNamingTemplate({
            type: "preset",
            preset: fileNamingPreset,
            maxLength: DEFAULT_FILE_NAMING_CONFIG.maxLength,
            keepExtension: true,
        });
    }, [customDraft, fileNamingCustom, fileNamingPreset, fileNamingType]);

    const preview = useMemo(() => {
        const validation = validateTemplate(activeTemplate);
        if (!validation.valid) {
            return null;
        }
        return previewFilename(activeTemplate);
    }, [activeTemplate]);

    const commitCustomTemplate = () => {
        const next = customDraft.trim();
        const validation = validateTemplate(next);
        if (!validation.valid) {
            setCustomError(
                t(`settings.download.file_naming_error_${validation.error}`),
            );
            setCustomDraft(fileNamingCustom);
            return;
        }
        setCustomError(null);
        if (next !== fileNamingCustom) {
            AppConfig.setConfig({
                "download.fileNamingCustom": next,
            });
        }
        setCustomDraft(next);
    };

    return (
        <SettingGroup
            title={t("settings.group.download_file_naming")}
            description={t("settings.group.download_file_naming_desc")}
        >
            <RadioGroupSettingItem
                label={t("settings.download.file_naming_type")}
                keyPath="download.fileNamingType"
                options={["preset", "custom"]}
                renderItem={(item) =>
                    t(`settings.download.file_naming_type_${item}`)
                }
            ></RadioGroupSettingItem>

            {fileNamingType === "preset" ? (
                <ListBoxSettingItem
                    keyPath="download.fileNamingPreset"
                    options={[...FILE_NAMING_PRESETS]}
                    label={t("settings.download.file_naming_preset")}
                    renderItem={(item) =>
                        item
                            ? t(`settings.download.preset_${item}`)
                            : t("settings.download.preset_title-artist")
                    }
                ></ListBoxSettingItem>
            ) : (
                <div className="setting-row setting-view--download-file-naming-custom">
                    <div className="label-container">
                        {t("settings.download.file_naming_custom")}
                    </div>
                    <div className="file-naming-custom-content">
                        <input
                            spellCheck={false}
                            value={customDraft}
                            placeholder={t(
                                "settings.download.file_naming_custom_placeholder",
                            )}
                            onChange={(event) => {
                                setCustomDraft(event.target.value);
                                if (customError) {
                                    setCustomError(null);
                                }
                            }}
                            onBlur={commitCustomTemplate}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                        <div className="file-naming-tip">
                            {t("settings.download.file_naming_custom_tip")}
                        </div>
                        {customError ? (
                            <div className="file-naming-error" role="alert">
                                {customError}
                            </div>
                        ) : null}
                    </div>
                </div>
            )}

            <div className="setting-row setting-view--download-file-naming-preview">
                <div className="label-container">
                    {t("settings.download.file_naming_preview")}
                </div>
                <div className="file-naming-preview-content">
                    <code className="file-naming-preview-sample">
                        {preview
                            ? `${preview}.mp3`
                            : getPresetTemplate("title-artist")}
                    </code>
                </div>
            </div>
        </SettingGroup>
    );
}

export default function Download() {
    const { t } = useTranslation();
    const writeMetadata = useAppConfig("download.writeMetadata") ?? true;
    const writeMetadataLyric = useAppConfig("download.writeMetadataLyric") ?? true;
    const downloadLyricFile = useAppConfig("download.downloadLyricFile") ?? false;
    const showLyricSettings = (writeMetadata && writeMetadataLyric) || downloadLyricFile;

    return (
        <div className="setting-view--download-container">
            <SettingGroup
                title={t("settings.group.download_basic")}
                description={t("settings.group.download_basic_desc")}
            >
                <PathSettingItem
                    keyPath="download.path"
                    label={t("settings.download.download_folder")}
                ></PathSettingItem>
                <ListBoxSettingItem
                    keyPath="download.concurrency"
                    options={concurrencyList}
                    onChange={(_evt, newConfig) => {
                        Downloader.setDownloadingConcurrency(newConfig ?? 1);
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
                        "vinyl",
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
            </SettingGroup>

            <FileNamingSettingGroup />

            <SettingGroup
                title={t("settings.group.download_metadata")}
                description={t("settings.group.download_metadata_desc")}
            >
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
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.download_lyric")}
                description={t("settings.group.download_lyric_desc")}
            >
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
            </SettingGroup>
        </div>
    );
}
