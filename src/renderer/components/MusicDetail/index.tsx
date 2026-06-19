import AnimatedDiv from "../AnimatedDiv";
import "./index.scss";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { PlayerState, qualityText } from "@/common/constant";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { useUserPreference } from "@/renderer/utils/user-perference";
import AppConfig from "@shared/app-config/renderer";
import { appUtil, appWindowUtil } from "@shared/utils/renderer";
import SvgAsset, { type SvgAssetIconNames } from "../SvgAsset";
import Lyric from "./widgets/Lyric";
import { useTranslation } from "react-i18next";
import {
    useCurrentMusic,
    usePlayerState,
    useQuality,
} from "@renderer/core/track-player/hooks";
import { useEffect } from "react";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";

export const isMusicDetailShown = musicDetailShownStore.getValue;
export const useMusicDetailShown = musicDetailShownStore.useValue;

function MusicDetail() {
    const musicItem = useCurrentMusic();
    const playerState = usePlayerState();
    const quality = useQuality();
    const musicDetailShown = musicDetailShownStore.useValue();
    const [storedCoverStyle] = useUserPreference("musicDetailCoverStyle");
    const [storedVinylTonearm] = useUserPreference("musicDetailVinylTonearm");
    const [storedTonearmReach] = useUserPreference("musicDetailVinylTonearmReach");
    const { t } = useTranslation();

    useEffect(() => {
        const escHandler = (event: KeyboardEvent) => {
            if (event.code === "Escape") {
                event.preventDefault();
                musicDetailShownStore.setValue(false);
            }
        };

        window.addEventListener("keydown", escHandler);
        return () => {
            window.removeEventListener("keydown", escHandler);
        };
    }, []);

    const artwork = musicItem?.coverImg ?? musicItem?.artwork ?? albumImg;
    const qualityLabel = quality ? (qualityText[quality] || quality).replace(/^.*?\s/, "") : null;
    const title = musicItem?.title || t("media.unknown_title");
    const subtitle = [musicItem?.artist || t("media.unknown_artist"), musicItem?.album]
        .filter(Boolean)
        .join(" · ");
    const coverStyle = storedCoverStyle === "vinyl" ? "vinyl" : "cover";
    const vinylTonearm =
        storedVinylTonearm === "glass" || storedVinylTonearm === "classic"
            ? storedVinylTonearm
            : "none";
    const tonearmReach = storedTonearmReach === "inner" ? "inner" : "outer";

    return (
        <AnimatedDiv
            showIf={musicDetailShown}
            className="music-detail--container animate__animated"
            mountClassName="animate__fadeInUp"
            unmountClassName="animate__fadeOutDown"
            onAnimationEnd={() => {
                setTimeout(() => {
                    document.body.style.width = "0";
                    document.body.getBoundingClientRect();
                    document.body.style.width = "";
                }, 120);
            }}
        >
            <div
                className="music-detail-background"
                style={{
                    backgroundImage: `url(${artwork})`,
                }}
            ></div>
            <div className="music-detail-overlay"></div>

            <div className="music-detail-shell">
                <div className="music-detail-topbar">
                    <div className="music-detail-topbar-left">
                        <RoundButton
                            iconName="chevron-double-down"
                            title={t("music_bar.close_music_detail_page")}
                            onClick={() => {
                                musicDetailShownStore.setValue(false);
                            }}
                        ></RoundButton>

                        <div className="music-detail-info-bar">
                            <img
                                className="music-detail-info-artwork"
                                onError={setFallbackAlbum}
                                src={artwork}
                            ></img>
                            <div className="music-detail-info-copy">
                                <div className="music-detail-info-title" title={title}>
                                    {title}
                                </div>
                                <div className="music-detail-info-meta-row">
                                    <div className="music-detail-info-subtitle" title={subtitle}>
                                        {subtitle}
                                    </div>
                                    {musicItem?.platform ? (
                                        <div className="music-detail-info-badge">
                                            {musicItem.platform}
                                        </div>
                                    ) : null}
                                    {qualityLabel ? (
                                        <div className="music-detail-info-badge music-detail-info-badge--strong">
                                            {qualityLabel}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="music-detail-topbar-right">
                        <RoundButton
                            iconName="minus"
                            title={t("app_header.minimize")}
                            onClick={() => {
                                appWindowUtil.minMainWindow();
                            }}
                        ></RoundButton>
                        <RoundButton
                            iconName="square"
                            title=""
                            onClick={() => {
                                appWindowUtil.toggleMainWindowMaximize();
                            }}
                        ></RoundButton>
                        <RoundButton
                            iconName="x-mark"
                            title={t("app_header.exit")}
                            onClick={() => {
                                const closeBehavior = AppConfig.getConfig("normal.closeBehavior");
                                if (closeBehavior === "minimize") {
                                    appWindowUtil.minMainWindow(true);
                                } else {
                                    appUtil.exitApp();
                                }
                            }}
                        ></RoundButton>
                    </div>
                </div>

                <div className="music-detail-content">
                    <div className="music-detail-primary-column">
                        <div
                            className="music-detail-primary-stage"
                            data-cover-style={coverStyle}
                        >
                            {coverStyle === "vinyl" ? (
                                <div
                                    className="music-detail-vinyl-player"
                                    data-playing={playerState === PlayerState.Playing}
                                >
                                    {vinylTonearm === "glass" ? (
                                        <GlassVinylTonearm reach={tonearmReach}></GlassVinylTonearm>
                                    ) : null}
                                    {vinylTonearm === "classic" ? (
                                        <ClassicVinylTonearm reach={tonearmReach}></ClassicVinylTonearm>
                                    ) : null}
                                    <div className="music-detail-vinyl-cover">
                                        <div className="music-detail-vinyl-record"></div>
                                        <div className="music-detail-vinyl-label">
                                            <img
                                                className="music-detail-vinyl-artwork"
                                                onError={setFallbackAlbum}
                                                src={artwork}
                                            ></img>
                                            <div className="music-detail-vinyl-label-shine"></div>
                                        </div>
                                        <div className="music-detail-vinyl-center-hole"></div>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    className="music-detail-artwork"
                                    onError={setFallbackAlbum}
                                    src={artwork}
                                ></img>
                            )}
                        </div>
                    </div>

                    <div className="music-detail-lyric-column">
                        <Lyric></Lyric>
                    </div>
                </div>
            </div>
        </AnimatedDiv>
    );
}

interface IButtonProps {
    iconName: SvgAssetIconNames;
    title?: string;
    onClick: () => void;
}

function RoundButton({ iconName, onClick, title }: IButtonProps) {
    return (
        <div
            className="music-detail-round-button"
            title={title}
            role="button"
            onClick={onClick}
        >
            <SvgAsset iconName={iconName}></SvgAsset>
        </div>
    );
}

interface ITonearmProps {
    reach: "outer" | "inner";
}

function GlassVinylTonearm({ reach }: ITonearmProps) {
    return (
        <div
            className="music-detail-vinyl-tonearm"
            data-reach={reach}
            aria-hidden="true"
        >
            <div className="music-detail-vinyl-tonearm-assembly">
                <svg
                    className="music-detail-vinyl-tonearm-svg"
                    viewBox="0 0 300 640"
                    focusable="false"
                >
                    <defs>
                        <linearGradient
                            id="musicDetailTonearmTubeGradient"
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="1"
                        >
                            <stop offset="0" stopColor="#ffffff" stopOpacity="0.5"></stop>
                            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.2"></stop>
                            <stop offset="1" stopColor="#ffffff" stopOpacity="0.36"></stop>
                        </linearGradient>
                        <linearGradient
                            id="musicDetailTonearmShellGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop offset="0" stopColor="#ffffff" stopOpacity="0.44"></stop>
                            <stop offset="1" stopColor="#ffffff" stopOpacity="0.16"></stop>
                        </linearGradient>
                    </defs>
                    <rect
                        className="music-detail-vinyl-tonearm-counterweight"
                        x="210"
                        y="-58"
                        width="60"
                        height="58"
                        rx="28"
                    ></rect>
                    <path
                        className="music-detail-vinyl-tonearm-tube-border"
                        d="M240 40 C258 250 217 476 144 584"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-tube"
                        d="M240 40 C258 250 217 476 144 584"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-tube-core"
                        d="M234 46 C251 250 211 470 139 577"
                    ></path>
                    <g transform="translate(144 584) rotate(34)">
                        <rect
                            className="music-detail-vinyl-tonearm-headshell"
                            x="-26"
                            y="-10"
                            width="52"
                            height="78"
                            rx="16"
                        ></rect>
                        <circle
                            className="music-detail-vinyl-tonearm-stylus-glow"
                            cx="0"
                            cy="52"
                            r="20"
                        ></circle>
                        <circle
                            className="music-detail-vinyl-tonearm-stylus"
                            cx="0"
                            cy="52"
                            r="9"
                        ></circle>
                    </g>
                </svg>
            </div>
            <div className="music-detail-vinyl-tonearm-base">
                <div className="music-detail-vinyl-tonearm-base-cap"></div>
            </div>
        </div>
    );
}

function ClassicVinylTonearm({ reach }: ITonearmProps) {
    return (
        <div
            className="music-detail-vinyl-tonearm-classic"
            data-reach={reach}
            aria-hidden="true"
        >
            <div className="music-detail-vinyl-tonearm-classic-assembly">
                <svg
                    className="music-detail-vinyl-tonearm-classic-svg"
                    viewBox="0 0 230 410"
                    focusable="false"
                >
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm"
                        d="M179 46 L174.3 -3.8"
                    ></path>
                    <rect
                        className="music-detail-vinyl-tonearm-classic-counterweight"
                        x="162"
                        y="-10.8"
                        width="26"
                        height="30"
                        rx="9"
                        transform="rotate(-5.4 175 4.2)"
                    ></rect>
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm"
                        d="M179 46 C190.3 177.3 164.6 318.5 119 386"
                    ></path>
                    <path
                        className="music-detail-vinyl-tonearm-classic-arm-shade"
                        d="M182.5 47.4 C193.8 178.7 168.1 319.9 122.5 387.4"
                    ></path>
                    <g transform="rotate(34 119 386)">
                        <rect
                            className="music-detail-vinyl-tonearm-classic-cartridge"
                            x="109"
                            y="379"
                            width="20"
                            height="14"
                            rx="4"
                        ></rect>
                        <rect
                            className="music-detail-vinyl-tonearm-classic-head"
                            x="106"
                            y="393"
                            width="26"
                            height="30"
                            rx="5"
                        ></rect>
                        <line
                            className="music-detail-vinyl-tonearm-classic-groove"
                            x1="114"
                            y1="413"
                            x2="114"
                            y2="420"
                        ></line>
                        <line
                            className="music-detail-vinyl-tonearm-classic-groove"
                            x1="124"
                            y1="413"
                            x2="124"
                            y2="420"
                        ></line>
                    </g>
                </svg>
            </div>
            <div className="music-detail-vinyl-tonearm-classic-base">
                <div className="music-detail-vinyl-tonearm-classic-base-cap"></div>
            </div>
        </div>
    );
}

MusicDetail.show = () => {
    musicDetailShownStore.setValue(true);
};

MusicDetail.hide = () => {
    musicDetailShownStore.setValue(false);
};

export default MusicDetail;
