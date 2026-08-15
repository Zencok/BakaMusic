import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { hideModal } from "../..";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import PluginManager from "@shared/plugin-manager/renderer";
import {
    getUserPreference,
    setUserPreference,
} from "@/renderer/utils/user-perference";
import PluginInputPanel from "../PluginInputPanel";
import Base from "../Base";
import SvgAsset from "@/renderer/components/SvgAsset";
import LazyImage from "@/renderer/components/LazyImage";
import albumImg from "@/assets/imgs/album-cover.jpg";
import getCompactArtworkSrc from "@/renderer/utils/get-compact-artwork-src";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import "./index.scss";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

function rememberImportMusicSheetPlugin(plugin: IPlugin.IPluginDelegate) {
    if (!plugin?.hash) {
        return;
    }
    setUserPreference("importMusicSheetPluginHash", plugin.hash);
}

function createImportedSheetId(
    plugin: IPlugin.IPluginDelegate,
    input: string,
) {
    let hash = 2166136261;
    const identity = `${plugin.hash}\0${input}`;
    for (let index = 0; index < identity.length; index++) {
        hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    }
    return `import-${(hash >>> 0).toString(36)}`;
}

function pickImportedSheetArtwork(...candidates: unknown[]) {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }
    return undefined;
}

export function normalizeImportedMusicSheet(
    result: IPlugin.IImportMusicSheetResult | null,
    plugin: IPlugin.IPluginDelegate,
    input: string,
    fallbackTitle: string,
): IMusic.IMusicSheetItem | null {
    if (!result) {
        return null;
    }

    const sourceSheet = Array.isArray(result) ? null : result;
    const musicList = Array.isArray(result)
        ? result
        : Array.isArray(result.musicList)
            ? result.musicList
            : [];
    if (!musicList.length) {
        return null;
    }

    const title = typeof sourceSheet?.title === "string"
        ? sourceSheet.title.trim()
        : "";
    const id = sourceSheet?.id === undefined || sourceSheet.id === null
        ? createImportedSheetId(plugin, input)
        : String(sourceSheet.id);
    const musicWithArtwork = musicList.find(
        (item) => item.artwork || item.coverImg,
    );

    return {
        ...(sourceSheet ?? {}),
        id,
        platform: plugin.platform,
        title: title || fallbackTitle,
        artwork: pickImportedSheetArtwork(
            sourceSheet?.artwork,
            sourceSheet?.coverImg,
            musicWithArtwork?.artwork,
            musicWithArtwork?.coverImg,
        ),
        worksNum: sourceSheet?.worksNum ?? musicList.length,
        musicList,
        isImported: true,
    };
}

export default function ImportMusicSheet(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [parsedSheet, setParsedSheet] = useState<IMusic.IMusicSheetItem | null>(
        null,
    );
    const rememberedPluginHash = getUserPreference("importMusicSheetPluginHash");

    if (parsedSheet) {
        const artwork = getCompactArtworkSrc(parsedSheet, 360) ?? albumImg;
        return (
            <Base withBlur={false} defaultClose>
                <div className="modal--import-music-sheet-result shadow">
                    <Base.Header>
                        {t("plugin.import_music_sheet_result_heading")}
                    </Base.Header>
                    <div className="import-music-sheet-result-body">
                        <button
                            aria-label={t("plugin.import_music_sheet_open", {
                                title: parsedSheet.title,
                            })}
                            className="import-music-sheet-result-card"
                            title={t("plugin.import_music_sheet_open", {
                                title: parsedSheet.title,
                            })}
                            type="button"
                            onClick={() => {
                                hideModal();
                                navigate(
                                    `/main/musicsheet/${encodeURIComponent(parsedSheet.platform)}/${encodeURIComponent(parsedSheet.id)}`,
                                    {
                                        state: {
                                            sheetItem: parsedSheet,
                                        },
                                    },
                                );
                            }}
                        >
                            <LazyImage
                                alt={parsedSheet.title}
                                className="import-music-sheet-result-artwork"
                                fallbackSrc={albumImg}
                                onError={setFallbackAlbum}
                                root={null}
                                releaseWhenHidden={false}
                                src={artwork}
                            ></LazyImage>
                            <span className="import-music-sheet-result-info">
                                <span className="import-music-sheet-result-platform">
                                    {parsedSheet.platform}
                                </span>
                                <strong title={parsedSheet.title}>
                                    {parsedSheet.title}
                                </strong>
                                <span className="import-music-sheet-result-meta">
                                    {parsedSheet.artist ? (
                                        <span>{parsedSheet.artist}</span>
                                    ) : null}
                                    <span>
                                        {t("modal.total_music_num", {
                                            number: parsedSheet.musicList?.length ?? 0,
                                        })}
                                    </span>
                                </span>
                                {parsedSheet.description ? (
                                    <span className="import-music-sheet-result-description">
                                        {parsedSheet.description}
                                    </span>
                                ) : null}
                            </span>
                            <SvgAsset iconName="chevron-right" size={20}></SvgAsset>
                        </button>
                    </div>
                    <div className="import-music-sheet-result-footer">
                        <button
                            className="plugin-input-button"
                            type="button"
                            onClick={hideModal}
                        >
                            {t("common.close")}
                        </button>
                        <button
                            className="plugin-input-button plugin-input-button-primary"
                            type="button"
                            onClick={() => setParsedSheet(null)}
                        >
                            <SvgAsset iconName="arrow-path"></SvgAsset>
                            <span>{t("plugin.import_music_sheet_parse_another")}</span>
                        </button>
                    </div>
                </div>
            </Base>
        );
    }

    return (
        <PluginInputPanel
            cancelText={t("common.cancel")}
            emptySupportMethod={t("plugin.method_import_music_sheet")}
            errorText={t("plugin_management_page.import_failed")}
            hintMethod="importMusicSheet"
            hintTitle={t("plugin.input_panel_hints")}
            hints={(plugin) => [t("plugin.import_music_sheet_hint", {
                plugin: plugin.platform,
            })]}
            iconName="playlist"
            initialPluginHash={rememberedPluginHash}
            inputLabel={t("plugin.import_music_sheet_input_label")}
            loadingText={t("plugin_management_page.importing_media")}
            maxLength={1000}
            placeholder={(plugin) => t(
                "plugin_management_page.placeholder_import_music_sheet",
                { plugin: plugin.platform },
            )}
            plugins={plugins}
            selectLabel={t("plugin_management_page.choose_plugin")}
            submitText={t("plugin.import_music_sheet_submit")}
            title={t("plugin.method_import_music_sheet")}
            variant="import-music-sheet"
            onSelectedPluginChange={rememberImportMusicSheetPlugin}
            onSubmit={async (plugin, input) => {
                const result = await PluginManager.callPluginDelegateMethod(
                    plugin,
                    "importMusicSheet",
                    input,
                );
                const sheet = normalizeImportedMusicSheet(
                    result,
                    plugin,
                    input,
                    t("plugin.import_music_sheet_fallback_title", {
                        plugin: plugin.platform,
                    }),
                );
                if (!sheet) {
                    toast.warn(t("plugin.import_music_sheet_empty"));
                    return;
                }

                setParsedSheet(sheet);
            }}
        ></PluginInputPanel>
    );
}
