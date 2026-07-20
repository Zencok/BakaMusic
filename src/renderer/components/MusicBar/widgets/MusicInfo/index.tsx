import SvgAsset from "@/renderer/components/SvgAsset";
import "./index.scss";

import Tag from "@/renderer/components/Tag";
import { secondsToDuration } from "@/common/time-util";
import MusicDetail, { useMusicDetailShown } from "@/renderer/components/MusicDetail";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { useTranslation } from "react-i18next";
import { useCurrentMusic, useProgress } from "@renderer/core/track-player/hooks";
import { hidePanel } from "@renderer/components/Panel";
import { useEffect, useState } from "react";
import normalizeArtworkDisplaySrc from "@/renderer/utils/normalize-artwork-display-src";

function StableArtwork(props: {
    src?: string;
    title?: string;
}) {
    const rawSrc = props.src ?? albumImg;
    const [displaySrc, setDisplaySrc] = useState(rawSrc);

    useEffect(() => {
        let canceled = false;
        setDisplaySrc(rawSrc);

        void normalizeArtworkDisplaySrc(rawSrc).then((nextSrc) => {
            if (!canceled) {
                setDisplaySrc(nextSrc ?? rawSrc);
            }
        });

        return () => {
            canceled = true;
        };
    }, [rawSrc]);

    return (
        <span
            className="music-cover"
            aria-hidden="true"
            title={props.title}
            style={{
                all: "unset",
                position: "absolute",
                inset: 0,
                display: "block",
                backgroundImage: `url("${displaySrc}")`,
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
            }}
        ></span>
    );
}

export default function MusicInfo() {
    const musicItem = useCurrentMusic();
    const musicDetailShown = useMusicDetailShown();
    const { t } = useTranslation();

    function toggleMusicDetail() {
        if (musicDetailShown) {
            MusicDetail.hide();
        } else {
            MusicDetail.show();
            hidePanel();
        }
    }

    if (!musicItem) {
        return (
            <div className="music-info-container music-info-empty">
                <div className="music-info-placeholder-icon">
                    <SvgAsset iconName="musical-note" size={22}></SvgAsset>
                </div>
                <div className="music-info-copy">
                    <div className="music-title-row">
                        <span className="music-title">{t("media.unknown_title")}</span>
                    </div>
                    <div className="music-subtitle">{t("media.unknown_artist")}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="music-info-container">
            <div
                className="music-cover-wrap"
                data-open={musicDetailShown}
                role="button"
                tabIndex={0}
                onClick={toggleMusicDetail}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleMusicDetail();
                    }
                }}
            >
                <StableArtwork
                    src={musicItem.coverImg ?? musicItem.artwork ?? albumImg}
                    title={musicItem.title}
                ></StableArtwork>
                <div
                    className="open-detail"
                    title={
                        musicDetailShown
                            ? t("music_bar.close_music_detail_page")
                            : t("music_bar.open_music_detail_page")
                    }
                >
                    <SvgAsset
                        iconName={musicDetailShown ? "chevron-double-down" : "chevron-double-up"}
                        size={18}
                    ></SvgAsset>
                </div>
            </div>

            <div className="music-info-copy">
                <div className="music-title-row">
                    <span
                        className="music-title"
                        role="button"
                        tabIndex={0}
                        onClick={toggleMusicDetail}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleMusicDetail();
                            }
                        }}
                        title={musicItem.title}
                    >
                        {musicItem.title}
                    </span>
                    {musicItem.platform ? (
                        <Tag fill style={{ fontSize: "0.76rem" }}>
                            {musicItem.platform}
                        </Tag>
                    ) : null}
                </div>
                <div className="music-subtitle" title={musicItem.artist}>
                    {musicItem.artist}
                </div>
                <div className="music-meta-row">
                    <Progress></Progress>
                </div>
            </div>

        </div>
    );
}

function Progress() {
    const { currentTime, duration } = useProgress();

    return (
        <div className="progress">
            {isFinite(duration)
                ? `${secondsToDuration(currentTime)}/${secondsToDuration(duration)}`
                : "--:--/--:--"}
        </div>
    );
}
