import { useEffect, useMemo, useRef, useState } from "react";
import "./index.scss";
import trackPlayer from "@renderer/core/track-player";
import { useProgress } from "@renderer/core/track-player/hooks";
import { secondsToDuration } from "@/common/time-util";
import { useTranslation } from "react-i18next";

function clampPercent(value: number) {
    return Math.max(0, Math.min(1, value));
}

export default function Slider() {
    const [seekPercent, setSeekPercent] = useState<number | null>(null);
    const sliderRef = useRef<HTMLDivElement>(null);
    const isPressedRef = useRef(false);
    const { currentTime, duration } = useProgress();
    const { t } = useTranslation();
    const canSeek = isFinite(duration) && duration > 0;

    const activePercent = useMemo(() => {
        if (seekPercent !== null) {
            return clampPercent(seekPercent);
        }
        if (!isFinite(duration) || duration <= 0) {
            return 0;
        }
        return clampPercent(currentTime / duration);
    }, [currentTime, duration, seekPercent]);

    function getPercentFromClientX(clientX: number) {
        const rect = sliderRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) {
            return 0;
        }
        return clampPercent((clientX - rect.left) / rect.width);
    }

    function commitSeek(percent: number) {
        const realDuration = trackPlayer.progress.duration;
        if (!isFinite(realDuration) || realDuration <= 0) {
            return;
        }
        trackPlayer.seekTo(realDuration * clampPercent(percent));
    }

    function seekByKeyboard(key: string, largeStep: boolean) {
        if (!canSeek) {
            return false;
        }

        const step = largeStep ? 15 : 5;
        switch (key) {
            case "ArrowLeft":
            case "ArrowDown":
                trackPlayer.seekTo(Math.max(0, currentTime - step));
                return true;
            case "ArrowRight":
            case "ArrowUp":
                trackPlayer.seekTo(Math.min(duration, currentTime + step));
                return true;
            case "Home":
                trackPlayer.seekTo(0);
                return true;
            case "End":
                trackPlayer.seekTo(duration);
                return true;
            default:
                return false;
        }
    }

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!isPressedRef.current) {
                return;
            }
            setSeekPercent(getPercentFromClientX(e.clientX));
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isPressedRef.current) {
                return;
            }
            const nextPercent = getPercentFromClientX(e.clientX);
            isPressedRef.current = false;
            commitSeek(nextPercent);
            setSeekPercent(null);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    const currentTimeText = isFinite(currentTime)
        ? secondsToDuration(Math.max(0, currentTime))
        : "--:--";
    const durationText = canSeek ? secondsToDuration(duration) : "--:--";

    return (
        <div
            className="music-bar--slider-container"
            data-seeking={seekPercent !== null}
        >
            <div
                ref={sliderRef}
                className="timeline-track"
                role="slider"
                tabIndex={canSeek ? 0 : -1}
                aria-label={t("music_bar.seek")}
                aria-disabled={!canSeek}
                aria-valuemin={0}
                aria-valuemax={canSeek ? Math.round(duration) : 0}
                aria-valuenow={canSeek ? Math.round(currentTime) : 0}
                aria-valuetext={`${currentTimeText} / ${durationText}`}
                onKeyDown={(event) => {
                    if (seekByKeyboard(event.key, event.shiftKey)) {
                        event.preventDefault();
                    }
                }}
                onMouseDown={(event) => {
                    if (!canSeek) {
                        return;
                    }
                    event.preventDefault();
                    isPressedRef.current = true;
                    setSeekPercent(getPercentFromClientX(event.clientX));
                }}
            >
                <div className="bar"></div>
                <div
                    className="active-bar"
                    style={{
                        width: `${activePercent * 100}%`,
                    }}
                ></div>
                <div
                    className="thumb"
                    style={{
                        left: `${activePercent * 100}%`,
                    }}
                ></div>
            </div>
            <span className="timeline-time timeline-time-summary" aria-hidden="true">
                <span className="timeline-time-elapsed">{currentTimeText}</span>
                <span>/</span>
                <span>{durationText}</span>
            </span>
        </div>
    );
}
