import { useEffect, useMemo, useRef, useState } from "react";
import "./index.scss";
import trackPlayer from "@renderer/core/track-player";
import { useProgress } from "@renderer/core/track-player/hooks";

function clampPercent(value: number) {
    return Math.max(0, Math.min(1, value));
}

export default function Slider() {
    const [seekPercent, setSeekPercent] = useState<number | null>(null);
    const sliderRef = useRef<HTMLDivElement>(null);
    const isPressedRef = useRef(false);
    const { currentTime, duration } = useProgress();

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

    return (
        <div
            ref={sliderRef}
            className="music-bar--slider-container"
            data-seeking={seekPercent !== null}
            onMouseDown={(e) => {
                if (!isFinite(duration) || duration <= 0) {
                    return;
                }
                e.preventDefault();
                isPressedRef.current = true;
                setSeekPercent(getPercentFromClientX(e.clientX));
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
    );
}
