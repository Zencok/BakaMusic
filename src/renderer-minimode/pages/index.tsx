import { useMemo, useState } from "react";
import ThemeSafeRoundButton from "@/renderer/components/ThemeSafeRoundButton";
import { PlayerState } from "@/common/constant";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";

import "./index.scss";
import { useTranslation } from "react-i18next";
import { useUserPreference } from "@/renderer/utils/user-perference";
import { appWindowUtil } from "@shared/utils/renderer";
import messageBus, { useAppStatePartial } from "@shared/message-bus/renderer/extension";

export default function MinimodePage() {
    const [hover, setHover] = useState(false);
    const currentMusicItem = useAppStatePartial("musicItem");
    const playerState = useAppStatePartial("playerState");
    const lyricItem = useAppStatePartial("parsedLrc");

    const { t } = useTranslation();
    const [showTranslation] = useUserPreference("showTranslation");
    const [showRomanization] = useUserPreference("showRomanization");

    const title = currentMusicItem?.title || t("media.unknown_title");
    const artist = currentMusicItem?.artist || t("media.unknown_artist");
    const artwork = currentMusicItem?.artwork || albumImg;
    const currentLyric = lyricItem?.lrc || title;
    const romanization = showRomanization ? lyricItem?.romanization : undefined;
    const translation = showTranslation ? lyricItem?.translation : undefined;
    const isPlaying = playerState === PlayerState.Playing;
    const lyricTitle = [romanization, currentLyric, translation]
        .filter((line) => !!line)
        .join("\n");

    const fullTitle = useMemo(() => {
        return `${title} - ${artist}`;
    }, [artist, title]);

    function openMainWindow() {
        appWindowUtil.showMainWindow();
    }

    function closeMinimode() {
        appWindowUtil.setMinimodeWindow(false);
        appWindowUtil.showMainWindow();
    }

    return (
        <div
            className="minimode-page-container"
            data-hover={hover}
            onMouseEnter={() => {
                setHover(true);
            }}
            onMouseLeave={() => {
                setHover(false);
            }}
            onDoubleClick={openMainWindow}
        >
            <div
                className="minimode-page-backdrop"
                style={{
                    backgroundImage: `url(${artwork})`,
                }}
            ></div>
            <div className="minimode-page-overlay"></div>
            <div className="minimode-page-shell">
                <div
                    className="minimode-cover-wrap"
                    role="button"
                    title={fullTitle}
                    onClick={openMainWindow}
                >
                    <img
                        draggable="false"
                        className="minimode-cover"
                        src={artwork}
                        onError={setFallbackAlbum}
                    ></img>
                </div>

                <div className="minimode-content">
                    <div
                        className="minimode-meta"
                        role="button"
                        title={fullTitle}
                        onClick={openMainWindow}
                    >
                        <div className="minimode-title">{title}</div>
                        <div className="minimode-artist">{artist}</div>
                    </div>
                    <div
                        className="minimode-lyric-block"
                        role="button"
                        title={lyricTitle || currentLyric}
                        onClick={openMainWindow}
                    >
                        {romanization ? (
                            <div className="minimode-romanization">{romanization}</div>
                        ) : null}
                        <div className="minimode-lyric">{currentLyric}</div>
                        {translation ? (
                            <div className="minimode-translation">{translation}</div>
                        ) : null}
                    </div>
                </div>

                <div className="minimode-actions">
                    <ThemeSafeRoundButton
                        iconName="x-mark"
                        iconSize={16}
                        size={32}
                        color="rgba(255, 255, 255, 0.74)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        style={{ marginRight: "4px" }}
                        onClick={closeMinimode}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName="skip-left"
                        iconSize={18}
                        size={32}
                        color="rgba(255, 255, 255, 0.9)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        onClick={() => {
                            messageBus.sendCommand("SkipToPrevious");
                        }}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName={isPlaying ? "pause" : "play"}
                        iconSize={20}
                        size={38}
                        color="#0b0b0f"
                        background="rgba(255, 255, 255, 0.96)"
                        hoverBackground="rgba(255, 255, 255, 0.9)"
                        borderColor="rgba(255, 255, 255, 0.5)"
                        shadow="0 10px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.36)"
                        onClick={() => {
                            messageBus.sendCommand("TogglePlayerState");
                        }}
                    ></ThemeSafeRoundButton>
                    <ThemeSafeRoundButton
                        iconName="skip-right"
                        iconSize={18}
                        size={32}
                        color="rgba(255, 255, 255, 0.9)"
                        background="rgba(255, 255, 255, 0.08)"
                        hoverBackground="rgba(255, 255, 255, 0.16)"
                        borderColor="rgba(255, 255, 255, 0.08)"
                        shadow="inset 0 1px 0 rgba(255, 255, 255, 0.12)"
                        onClick={() => {
                            messageBus.sendCommand("SkipToNext");
                        }}
                    ></ThemeSafeRoundButton>
                </div>
            </div>
        </div>
    );
}
