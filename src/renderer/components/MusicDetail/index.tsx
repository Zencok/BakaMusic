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
                                    className="music-detail-vinyl-cover"
                                    data-playing={playerState === PlayerState.Playing}
                                >
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

MusicDetail.show = () => {
    musicDetailShownStore.setValue(true);
};

MusicDetail.hide = () => {
    musicDetailShownStore.setValue(false);
};

export default MusicDetail;
