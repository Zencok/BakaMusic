import "./index.scss";
import { getMediaPrimaryKey } from "@/common/media-util";
import { mapLyricLinesToAml } from "@/common/amll-lyric";
import AppleMusicLyricPlayer from "@/renderer/components/AppleMusicLyricPlayer";
import { lyricStartMsToSeekSeconds } from "@/renderer/components/AppleMusicLyricPlayer/line-seek";
import { showCustomContextMenu } from "@/renderer/components/ContextMenu";
import Loading from "@/renderer/components/Loading";
import { hideModal, showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import { getLinkedLyric, unlinkLyric } from "@/renderer/core/link-lyric";
import trackPlayer from "@renderer/core/track-player";
import {
    useCurrentMusic,
    useLyric,
    usePlayerState,
    useProgress,
    useSpeed,
} from "@renderer/core/track-player/hooks";
import LyricParser from "@/renderer/utils/lyric-parser";
import {
    getUserPreference,
    setUserPreference,
    useUserPreference,
} from "@/renderer/utils/user-perference";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";
import { dialogUtil, fsUtil } from "@shared/utils/renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { PlayerState } from "@/common/constant";
import {
    buildDownloadFileBaseName,
    DEFAULT_FILE_NAMING_CONFIG,
    type FileNamingPreset,
    type FileNamingType,
} from "@/common/file-naming-formatter";
import {
    formatLyricsFromItems,
    resolveLyricExportOrder,
} from "@/common/download-postprocess";
import { resolveFilePath } from "@/common/path-util";
import { getGlobalContext } from "@shared/global-context/renderer";
import nodeRuntime from "@shared/node-runtime/renderer";
import isLocalMusic from "@/renderer/utils/is-local-music";
import { serializeEmbeddedLyric } from "@/renderer/utils/embedded-lyric";
import { toError } from "@/common/error-util";
import type { LyricLine } from "@amll-core/interfaces";

type MusicDetailCoverStyle = "cover" | "vinyl";
type MusicDetailVinylTonearm = "none" | "classic" | "glass";
type MusicDetailVinylTonearmReach = "outer" | "inner";

interface ILyricProps {
    active: boolean;
    playerReady: boolean;
    isFullscreen: boolean;
    onRequestFullscreen: () => void;
}

export default function Lyric({
    active,
    playerReady,
    isFullscreen,
    onRequestFullscreen,
}: ILyricProps) {
    const currentMusic = useCurrentMusic();
    const lyricContext = useLyric();
    const lyricParser = lyricContext?.parser;
    const progress = useProgress();
    const playerState = usePlayerState();
    const speed = useSpeed();
    const [fontSize, setFontSize] = useState<string | null>(
        getUserPreference("inlineLyricFontSize"),
    );
    const showTranslation = useAppConfig("lyric.showTranslation");
    const showRomanization = useAppConfig("lyric.showRomanization");
    const { t } = useTranslation();

    const lyricLines = useMemo(() => {
        if (!lyricParser) {
            return [];
        }

        return mapLyricLinesToAml(lyricParser.getLyricItems(), {
            includeTranslation: !!showTranslation && lyricParser.hasTranslation,
            includeRomanization: !!showRomanization && lyricParser.hasRomanization,
        });
    }, [lyricParser, showRomanization, showTranslation]);

    // Music detail unmounts while closed. When reopened after startup restore,
    // re-request only while the store is still in the initial "loading" state.
    // `{}` means "loaded, no lyric" — do not loop-fetch in that case.
    useEffect(() => {
        if (!currentMusic || lyricContext !== null) {
            return;
        }
        void trackPlayer.fetchCurrentLyric(true);
    }, [currentMusic, lyricContext]);

    const displayFontSize = fontSize ? Math.max(24, +fontSize * 2.15) : undefined;

    const openSearchLyric = useCallback(() => {
        showModal("SearchLyric", {
            defaultTitle: currentMusic?.title,
            musicItem: currentMusic ?? undefined,
        });
    }, [currentMusic]);

    const openContextMenu = useCallback((x: number, y: number) => {
        showCustomContextMenu({
            x,
            y,
            width: 244,
            height: currentMusic && isLocalMusic(currentMusic) ? 366 : 328,
            component: (
                <LyricContextMenu
                    lyricParser={lyricParser}
                    setLyricFontSize={setFontSize}
                ></LyricContextMenu>
            ),
        });
    }, [currentMusic, lyricParser]);

    const handleLyricLineClick = useCallback((line: LyricLine) => {
        const seconds = lyricStartMsToSeekSeconds(line.startTime);
        if (seconds === null) {
            return;
        }
        trackPlayer.seekTo(seconds);
    }, []);

    return (
        <div className="music-detail-lyric-panel">
            <div className="music-detail-lyric-toolbar">
                <div className="music-detail-lyric-toolbar-title">
                    <SvgAsset iconName="lyric"></SvgAsset>
                    <span>{t("media.media_type_lyric")}</span>
                </div>
                <div className="music-detail-lyric-toolbar-actions">
                    <div
                        className="music-detail-lyric-toolbar-button"
                        data-active={!!showTranslation && (lyricParser?.hasTranslation ?? false)}
                        data-disabled={!lyricParser?.hasTranslation}
                        role="button"
                        title={t("music_detail.translation")}
                        onClick={() => {
                            if (lyricParser?.hasTranslation) {
                                AppConfig.setConfig({
                                    "lyric.showTranslation": !showTranslation,
                                });
                            }
                        }}
                    >
                        <SvgAsset iconName="language"></SvgAsset>
                    </div>
                    <div
                        className="music-detail-lyric-toolbar-button"
                        role="button"
                        title={t("music_detail.search_lyric")}
                        onClick={openSearchLyric}
                    >
                        <SvgAsset iconName="magnifying-glass"></SvgAsset>
                    </div>
                    {isFullscreen ? (
                        <div
                            className="music-detail-lyric-toolbar-button"
                            role="button"
                            title="关闭全屏沉浸模式"
                            onClick={onRequestFullscreen}
                        >
                            <SvgAsset iconName="arrows-pointing-in"></SvgAsset>
                        </div>
                    ) : null}
                    <CoverStyleSelector></CoverStyleSelector>
                </div>
            </div>

            <div
                className="music-detail-lyric-stage"
                onContextMenu={(event) => {
                    event.preventDefault();
                    openContextMenu(event.clientX, event.clientY);
                }}
            >
                {lyricContext === null ? (
                    <div className="music-detail-lyric-loading">
                        <Loading></Loading>
                    </div>
                ) : lyricParser && playerReady ? (
                    <AppleMusicLyricPlayer
                        active={active}
                        lyricLines={lyricLines}
                        currentTimeMs={(progress?.currentTime ?? 0) * 1000}
                        playing={playerState === PlayerState.Playing}
                        speed={speed}
                        fontSize={displayFontSize || "clamp(28px, 2.8vw, 48px)"}
                        textColor="#ffffff"
                        hoverBackgroundColor="rgba(255,255,255,0.04)"
                        alignAnchor="center"
                        alignPosition={0.42}
                        enableBlur
                        enableScale
                        enableSpring
                        wordFadeWidth={0.66}
                        onLineClick={handleLyricLineClick}
                    ></AppleMusicLyricPlayer>
                ) : lyricParser ? (
                    <div className="music-detail-lyric-loading">
                        <Loading></Loading>
                    </div>
                ) : (
                    <div className="music-detail-lyric-empty">
                        <div className="music-detail-lyric-empty-title">
                            {t("music_detail.no_lyric")}
                        </div>
                        <div className="music-detail-lyric-empty-subtitle">
                            {currentMusic?.title || "BakaMusic"}
                        </div>
                        <div
                            className="music-detail-lyric-empty-button"
                            role="button"
                            onClick={openSearchLyric}
                        >
                            {t("music_detail.search_lyric")}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function CoverStyleSelector() {
    const [isOpen, setIsOpen] = useState(false);
    const [storedCoverStyle, setStoredCoverStyle] = useUserPreference(
        "musicDetailCoverStyle",
    );
    const [storedVinylTonearm, setStoredVinylTonearm] = useUserPreference(
        "musicDetailVinylTonearm",
    );
    const [storedTonearmReach, setStoredTonearmReach] = useUserPreference(
        "musicDetailVinylTonearmReach",
    );
    const selectorRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const coverStyle: MusicDetailCoverStyle = storedCoverStyle === "cover"
        ? "cover"
        : "vinyl";
    const vinylTonearm: MusicDetailVinylTonearm =
        storedVinylTonearm === "glass" || storedVinylTonearm === "classic"
            ? storedVinylTonearm
            : "none";
    const tonearmReach: MusicDetailVinylTonearmReach =
        storedTonearmReach === "inner" ? "inner" : "outer";

    const options = useMemo<Array<{
        key: MusicDetailCoverStyle;
        iconName: "album" | "cd";
        label: string;
    }>>(() => [
        {
            key: "cover",
            iconName: "album",
            label: t("music_detail.cover_style_cover"),
        },
        {
            key: "vinyl",
            iconName: "cd",
            label: t("music_detail.cover_style_vinyl"),
        },
    ], [t]);

    const tonearmOptions = useMemo<Array<{
        key: MusicDetailVinylTonearm;
        label: string;
    }>>(() => [
        {
            key: "none",
            label: t("music_detail.cover_style_tonearm_none"),
        },
        {
            key: "classic",
            label: t("music_detail.cover_style_tonearm_classic"),
        },
        {
            key: "glass",
            label: t("music_detail.cover_style_tonearm_glass"),
        },
    ], [t]);

    const reachOptions = useMemo<Array<{
        key: MusicDetailVinylTonearmReach;
        label: string;
    }>>(() => [
        {
            key: "outer",
            label: t("music_detail.cover_style_tonearm_reach_outer"),
        },
        {
            key: "inner",
            label: t("music_detail.cover_style_tonearm_reach_inner"),
        },
    ], [t]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!selectorRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isOpen]);

    return (
        <div
            className="music-detail-cover-style-selector"
            data-open={isOpen}
            ref={selectorRef}
        >
            <div
                className="music-detail-lyric-toolbar-button"
                data-active={coverStyle === "vinyl"}
                role="button"
                title={t("music_detail.cover_style")}
                onClick={(event) => {
                    event.stopPropagation();
                    setIsOpen((value) => !value);
                }}
            >
                <SvgAsset iconName="cd"></SvgAsset>
            </div>
            {isOpen ? (
                <div
                    className="music-detail-cover-style-popover"
                    onClick={(event) => event.stopPropagation()}
                >
                    {options.map((option) => (
                        <div
                            className="music-detail-cover-style-option"
                            data-active={coverStyle === option.key}
                            key={option.key}
                            role="button"
                            onClick={() => {
                                setStoredCoverStyle(option.key);
                                setIsOpen(false);
                            }}
                        >
                            <div className="music-detail-cover-style-option-icon">
                                <SvgAsset iconName={option.iconName}></SvgAsset>
                            </div>
                            <span>{option.label}</span>
                            <SvgAsset iconName="check"></SvgAsset>
                        </div>
                    ))}
                    {coverStyle === "vinyl" ? (
                        <div className="music-detail-cover-style-tonearm">
                            <div className="music-detail-cover-style-tonearm-title">
                                {t("music_detail.cover_style_tonearm")}
                            </div>
                            <div className="music-detail-cover-style-tonearm-tabs">
                                {tonearmOptions.map((option) => (
                                    <div
                                        className="music-detail-cover-style-tonearm-tab"
                                        data-active={vinylTonearm === option.key}
                                        key={option.key}
                                        role="button"
                                        onClick={() => {
                                            setStoredVinylTonearm(option.key);
                                        }}
                                    >
                                        {option.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {coverStyle === "vinyl" && vinylTonearm !== "none" ? (
                        <div className="music-detail-cover-style-tonearm">
                            <div className="music-detail-cover-style-tonearm-title">
                                {t("music_detail.cover_style_tonearm_reach")}
                            </div>
                            <div className="music-detail-cover-style-tonearm-tabs">
                                {reachOptions.map((option) => (
                                    <div
                                        className="music-detail-cover-style-tonearm-tab"
                                        data-active={tonearmReach === option.key}
                                        key={option.key}
                                        role="button"
                                        onClick={() => {
                                            setStoredTonearmReach(option.key);
                                        }}
                                    >
                                        {option.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

interface ILyricContextMenuProps {
    setLyricFontSize: (val: string) => void;
    lyricParser?: LyricParser;
}

function LyricContextMenu({ lyricParser, setLyricFontSize }: ILyricContextMenuProps) {
    const [fontSize, setFontSize] = useState<string | null>(
        getUserPreference("inlineLyricFontSize") ?? "13",
    );
    const showTranslation = useAppConfig("lyric.showTranslation");
    const showRomanization = useAppConfig("lyric.showRomanization");
    const [linkedLyricInfo, setLinkedLyricInfo] = useState<IMedia.IUnique | null>(null);
    const { t } = useTranslation();

    const currentMusicRef = useRef<IMusic.IMusicItem>(
        trackPlayer.currentMusic ?? ({} as any),
    );
    const currentMusic = currentMusicRef.current;
    const localMusicPath = currentMusic.localPath || currentMusic.$$localPath;
    const canOverwriteEmbeddedLyric = !!linkedLyricInfo
        && !!lyricParser
        && !!localMusicPath
        && isLocalMusic(currentMusic);

    useEffect(() => {
        let cancelled = false;

        if (currentMusicRef.current?.platform) {
            void getLinkedLyric(currentMusicRef.current).then((linked) => {
                if (!cancelled && linked) {
                    setLinkedLyricInfo(linked);
                }
            });
        }

        return () => {
            cancelled = true;
        };
    }, []);

    function handleFontSize(val: string | number) {
        if (!val) {
            return;
        }

        const numericValue = +val;
        if (numericValue < 8 || numericValue > 32) {
            return;
        }

        setUserPreference("inlineLyricFontSize", `${numericValue}`);
        setLyricFontSize(`${numericValue}`);
    }

    async function downloadLyric(fileType: "lrc" | "txt") {
        if (!lyricParser) {
            return;
        }

        // Follow lyric-page display toggles + keep real word-by-word timing when present
        const lyricOrder = resolveLyricExportOrder({
            showTranslation: !!showTranslation && lyricParser.hasTranslation,
            showRomanization: !!showRomanization && lyricParser.hasRomanization,
            preferredOrder: AppConfig.getConfig("download.lyricOrder"),
        });
        const rawLyric = formatLyricsFromItems(
            lyricParser.getLyricItems(),
            lyricOrder,
            {
                // Lyric page renders word timeline when available — export the same way
                enableWordByWord: true,
                withTimestamp: fileType === "lrc",
                meta: lyricParser.getMeta(),
            },
        );

        if (!rawLyric.trim()) {
            toast.error(t("music_detail.lyric_ctx_download_fail"));
            return;
        }

        const musicItem = currentMusicRef.current;
        const fileBaseName = buildDownloadFileBaseName(musicItem, {
            type: (AppConfig.getConfig("download.fileNamingType")
                ?? DEFAULT_FILE_NAMING_CONFIG.type) as FileNamingType,
            preset: (AppConfig.getConfig("download.fileNamingPreset")
                ?? DEFAULT_FILE_NAMING_CONFIG.preset) as FileNamingPreset,
            custom: AppConfig.getConfig("download.fileNamingCustom")
                ?? DEFAULT_FILE_NAMING_CONFIG.custom,
            maxLength: AppConfig.getConfig("download.fileNamingMaxLength")
                ?? DEFAULT_FILE_NAMING_CONFIG.maxLength,
            keepExtension: true,
        });
        const fileName = `${fileBaseName}.${fileType}`;
        const downloadBasePath = AppConfig.getConfig("download.path")
            ?? getGlobalContext().appPath.downloads;
        const defaultPath = downloadBasePath
            ? resolveFilePath(downloadBasePath, `./${fileName}`)
            : fileName;

        try {
            const result = await dialogUtil.showSaveDialog({
                title: t("music_detail.lyric_ctx_download_lyric"),
                defaultPath,
                filters: [{
                    name: t("media.media_type_lyric"),
                    extensions: ["lrc", "txt"],
                }],
            });

            // User cancelled the save dialog — not a failure
            if (result.canceled || !result.filePath) {
                return;
            }

            await fsUtil.writeFile(result.filePath, rawLyric, "utf-8");
            toast.success(t("music_detail.lyric_ctx_download_success"));
        } catch {
            toast.error(t("music_detail.lyric_ctx_download_fail"));
        }
    }

    function confirmOverwriteEmbeddedLyric() {
        if (!canOverwriteEmbeddedLyric || !lyricParser || !localMusicPath) {
            return;
        }

        let lyricContent = "";
        try {
            lyricContent = serializeEmbeddedLyric(lyricParser);
        } catch (error) {
            toast.error(
                `${t("music_detail.overwrite_embedded_lyric_failed")}: ${
                    toError(error).message
                }`,
            );
            return;
        }
        if (!lyricContent.trim()) {
            toast.error(t("music_detail.overwrite_embedded_lyric_failed"));
            return;
        }

        showModal("Reconfirm", {
            title: t("music_detail.overwrite_embedded_lyric"),
            content: t("music_detail.overwrite_embedded_lyric_confirm", {
                title: currentMusic.title,
            }),
            async onConfirm() {
                hideModal();
                try {
                    await nodeRuntime.overwriteEmbeddedLyric(
                        localMusicPath,
                        lyricContent,
                    );
                    await unlinkLyric(currentMusic);
                    setLinkedLyricInfo(null);
                    if (trackPlayer.isCurrentMusic(currentMusic)) {
                        await trackPlayer.fetchCurrentLyric(true);
                    }
                    toast.success(
                        t("music_detail.overwrite_embedded_lyric_success"),
                    );
                } catch (error) {
                    toast.error(
                        `${t("music_detail.overwrite_embedded_lyric_failed")}: ${
                            toError(error).message
                        }`,
                    );
                }
            },
        });
    }

    return (
        <>
            <div className="lyric-ctx-menu--set-font-title">
                {t("music_detail.lyric_ctx_set_font_size")}
            </div>
            <div
                className="lyric-ctx-menu--font-container"
                onClick={(event) => event.stopPropagation()}
            >
                <div
                    role="button"
                    className="font-size-button"
                    onClick={() => {
                        if (!fontSize) {
                            return;
                        }
                        // Do not call parent setState inside setState updater — React forbids
                        // updating Lyric while rendering LyricContextMenu.
                        const nextValue = Math.max(8, +(fontSize ?? "13") - 1);
                        setFontSize(`${nextValue}`);
                        handleFontSize(nextValue);
                    }}
                >
                    <SvgAsset iconName="font-size-smaller"></SvgAsset>
                </div>
                <input
                    type="number"
                    max={32}
                    min={8}
                    value={fontSize ?? ""}
                    onChange={(event) => {
                        const value = event.target.value.trim();
                        setFontSize(value);
                        handleFontSize(value);
                    }}
                ></input>
                <div
                    role="button"
                    className="font-size-button"
                    onClick={() => {
                        if (!fontSize) {
                            return;
                        }
                        const nextValue = Math.min(32, +(fontSize ?? "13") + 1);
                        setFontSize(`${nextValue}`);
                        handleFontSize(nextValue);
                    }}
                >
                    <SvgAsset iconName="font-size-larger"></SvgAsset>
                </div>
            </div>
            <div className="divider"></div>
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                data-disabled={!lyricParser?.hasTranslation}
                onClick={() => {
                    if (lyricParser?.hasTranslation) {
                        AppConfig.setConfig({
                            "lyric.showTranslation": !showTranslation,
                        });
                    }
                }}
            >
                {showTranslation
                    ? t("music_detail.hide_translation")
                    : t("music_detail.show_translation")}
            </div>
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                data-disabled={!lyricParser?.hasRomanization}
                onClick={() => {
                    if (lyricParser?.hasRomanization) {
                        AppConfig.setConfig({
                            "lyric.showRomanization": !showRomanization,
                        });
                    }
                }}
            >
                {showRomanization
                    ? t("music_detail.hide_romanization")
                    : t("music_detail.show_romanization")}
            </div>
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                data-disabled={!lyricParser}
                onClick={() => downloadLyric("lrc")}
            >
                {t("music_detail.lyric_ctx_download_lyric_lrc")}
            </div>
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                data-disabled={!lyricParser}
                onClick={() => downloadLyric("txt")}
            >
                {t("music_detail.lyric_ctx_download_lyric_txt")}
            </div>
            <div className="divider"></div>
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                onClick={() => {
                    showModal("SearchLyric", {
                        defaultTitle: currentMusicRef.current.title,
                        musicItem: currentMusicRef.current,
                    });
                }}
            >
                <span>
                    {linkedLyricInfo
                        ? `${t("music_detail.media_lyric_linked")} ${getMediaPrimaryKey(linkedLyricInfo)}`
                        : t("music_detail.search_lyric")}
                </span>
            </div>
            {isLocalMusic(currentMusic) ? (
                <div
                    className="lyric-ctx-menu--row-container"
                    role="button"
                    data-disabled={!canOverwriteEmbeddedLyric}
                    onClick={confirmOverwriteEmbeddedLyric}
                >
                    {t("music_detail.overwrite_embedded_lyric")}
                </div>
            ) : null}
            <div
                className="lyric-ctx-menu--row-container"
                role="button"
                data-disabled={!linkedLyricInfo}
                onClick={async () => {
                    if (!linkedLyricInfo) {
                        return;
                    }

                    try {
                        await unlinkLyric(currentMusicRef.current);
                        setLinkedLyricInfo(null);
                        if (trackPlayer.isCurrentMusic(currentMusicRef.current)) {
                            await trackPlayer.fetchCurrentLyric(true);
                        }
                        toast.success(t("music_detail.toast_media_lyric_unlinked"));
                    } catch {
                        // ignore
                    }
                }}
            >
                {t("music_detail.unlink_media_lyric")}
            </div>
        </>
    );
}
