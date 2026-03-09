import "./index.scss";
import { getMediaPrimaryKey } from "@/common/media-util";
import { mapLyricLinesToAml } from "@/common/amll-lyric";
import AppleMusicLyricPlayer from "@/renderer/components/AppleMusicLyricPlayer";
import { showCustomContextMenu } from "@/renderer/components/ContextMenu";
import Loading from "@/renderer/components/Loading";
import { showModal } from "@/renderer/components/Modal";
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
import { dialogUtil, fsUtil } from "@shared/utils/renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { PlayerState } from "@/common/constant";

export default function Lyric() {
    const currentMusic = useCurrentMusic();
    const lyricContext = useLyric();
    const lyricParser = lyricContext?.parser;
    const progress = useProgress();
    const playerState = usePlayerState();
    const speed = useSpeed();
    const [fontSize, setFontSize] = useState<string | null>(
        getUserPreference("inlineLyricFontSize"),
    );
    const [showTranslation, setShowTranslation] =
        useUserPreference("showTranslation");
    const [showRomanization] = useUserPreference("showRomanization");
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

    const displayFontSize = fontSize ? Math.max(24, +fontSize * 2.15) : undefined;

    const openSearchLyric = useCallback(() => {
        showModal("SearchLyric", {
            defaultTitle: currentMusic?.title,
            musicItem: currentMusic,
        });
    }, [currentMusic]);

    const openContextMenu = useCallback((x: number, y: number) => {
        showCustomContextMenu({
            x,
            y,
            width: 244,
            height: 292,
            component: (
                <LyricContextMenu
                    lyricParser={lyricParser}
                    setLyricFontSize={setFontSize}
                ></LyricContextMenu>
            ),
        });
    }, [lyricParser]);

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
                                setShowTranslation(!showTranslation);
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
                    <div
                        className="music-detail-lyric-toolbar-button"
                        role="button"
                        title={t("media.media_type_lyric")}
                        onClick={(event) => {
                            const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                            openContextMenu(rect.left, rect.bottom + 8);
                        }}
                    >
                        <SvgAsset iconName="list-bullet"></SvgAsset>
                    </div>
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
                ) : lyricParser ? (
                    <AppleMusicLyricPlayer
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
                    ></AppleMusicLyricPlayer>
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

interface ILyricContextMenuProps {
    setLyricFontSize: (val: string) => void;
    lyricParser?: LyricParser;
}

function LyricContextMenu({ lyricParser, setLyricFontSize }: ILyricContextMenuProps) {
    const [fontSize, setFontSize] = useState<string | null>(
        getUserPreference("inlineLyricFontSize") ?? "13",
    );
    const [showTranslation, setShowTranslation] =
        useUserPreference("showTranslation");
    const [linkedLyricInfo, setLinkedLyricInfo] = useState<IMedia.IUnique>(null);
    const { t } = useTranslation();

    const currentMusicRef = useRef<IMusic.IMusicItem>(
        trackPlayer.currentMusic ?? ({} as any),
    );

    useEffect(() => {
        if (currentMusicRef.current?.platform) {
            getLinkedLyric(currentMusicRef.current).then((linked) => {
                if (linked) {
                    setLinkedLyricInfo(linked);
                }
            });
        }
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

        const rawLyric = fileType === "lrc"
            ? lyricParser.toString({ withTimestamp: true })
            : lyricParser.toString();

        try {
            const result = await dialogUtil.showSaveDialog({
                title: t("music_detail.lyric_ctx_download_lyric"),
                defaultPath:
                    currentMusicRef.current.title +
                    (fileType === "lrc" ? ".lrc" : ".txt"),
                filters: [{
                    name: t("media.media_type_lyric"),
                    extensions: ["lrc", "txt"],
                }],
            });

            if (!result.canceled && result.filePath) {
                await fsUtil.writeFile(result.filePath, rawLyric, "utf-8");
                toast.success(t("music_detail.lyric_ctx_download_success"));
            } else {
                throw new Error("cancelled");
            }
        } catch {
            toast.error(t("music_detail.lyric_ctx_download_fail"));
        }
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
                        if (fontSize) {
                            setFontSize((previousValue) => {
                                const nextValue = Math.max(8, +previousValue - 1);
                                handleFontSize(nextValue);
                                return `${nextValue}`;
                            });
                        }
                    }}
                >
                    <SvgAsset iconName="font-size-smaller"></SvgAsset>
                </div>
                <input
                    type="number"
                    max={32}
                    min={8}
                    value={fontSize}
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
                        if (fontSize) {
                            setFontSize((previousValue) => {
                                const nextValue = Math.min(32, +previousValue + 1);
                                handleFontSize(nextValue);
                                return `${nextValue}`;
                            });
                        }
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
                        setShowTranslation(!showTranslation);
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
                        if (trackPlayer.isCurrentMusic(currentMusicRef.current)) {
                            trackPlayer.fetchCurrentLyric(true);
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
