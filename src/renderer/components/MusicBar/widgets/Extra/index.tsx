import SvgAsset from "@/renderer/components/SvgAsset";
import "./index.scss";
import SwitchCase from "@/renderer/components/SwitchCase";
import trackPlayer from "@renderer/core/track-player";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import Condition from "@/renderer/components/Condition";
import throttle from "lodash.throttle";
import { showModal } from "@/renderer/components/Modal";
import classNames from "@/renderer/utils/classnames";
import { getCurrentPanel, hidePanel, showPanel } from "@/renderer/components/Panel";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { isCN } from "@/shared/i18n/renderer";
import useAppConfig from "@/hooks/useAppConfig";
import { RepeatMode } from "@/common/constant";
import { getQualityDisplayText, resolveMusicQualityChoices } from "@/renderer/utils/music-quality";
import { useCurrentMusic, useIsMute, useQuality, useRepeatMode, useSpeed, useVolume } from "@renderer/core/track-player/hooks";
import { appWindowUtil } from "@shared/utils/renderer";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { createPortal } from "react-dom";

export default function Extra() {
    const repeatMode = useRepeatMode();
    const { t } = useTranslation();

    return (
        <div className="music-extra">
            <QualityBtn></QualityBtn>
            <SpeedBtn></SpeedBtn>
            <VolumeBtn></VolumeBtn>
            <LyricBtn></LyricBtn>
            <div
                className="extra-btn"
                role="button"
                onClick={() => {
                    trackPlayer.toggleRepeatMode();
                }}
                title={
                    repeatMode === RepeatMode.Loop
                        ? t("media.music_repeat_mode_loop")
                        : repeatMode === RepeatMode.Queue
                            ? t("media.music_repeat_mode_queue")
                            : t("media.music_repeat_mode_shuffle")
                }
            >
                <SwitchCase.Switch switch={repeatMode}>
                    <SwitchCase.Case case={RepeatMode.Loop}>
                        <SvgAsset iconName="repeat-song"></SvgAsset>
                    </SwitchCase.Case>
                    <SwitchCase.Case case={RepeatMode.Queue}>
                        <SvgAsset iconName="repeat-song-1"></SvgAsset>
                    </SwitchCase.Case>
                    <SwitchCase.Case case={RepeatMode.Shuffle}>
                        <SvgAsset iconName="shuffle"></SvgAsset>
                    </SwitchCase.Case>
                </SwitchCase.Switch>
            </div>
            <div
                className="extra-btn"
                title={t("media.playlist")}
                role="button"
                onClick={() => {
                    if (getCurrentPanel()?.type === "PlayList") {
                        hidePanel();
                    } else {
                        showPanel("PlayList", {
                            coverHeader: musicDetailShownStore.getValue(),
                        });
                    }
                }}
            >
                <SvgAsset iconName="playlist"></SvgAsset>
            </div>
        </div>
    );
}

const WHEEL_VOLUME_STEP = 0.01;
const WHEEL_SPEED_STEP = 0.05;
const SPEED_MIN = 0.25;
const SPEED_MAX = 2;
const WHEEL_DELTA_UNIT = 100;
const WHEEL_THROTTLE_MS = 32;
const INLINE_SLIDER_HEIGHT = 96;
const INLINE_SLIDER_HANDLE_SIZE = 14;
const FLOATING_BUBBLE_OFFSET = 4;
const FLOATING_BUBBLE_VIEWPORT_MARGIN = 8;

function clampSliderValue(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getStepPrecision(step: number) {
    const stepText = `${step}`;
    return stepText.includes(".") ? stepText.split(".")[1].length : 0;
}

function alignSliderValue(value: number, min: number, max: number, step: number) {
    const precision = getStepPrecision(step);
    const steppedValue = min + Math.round((value - min) / step) * step;
    return Number(clampSliderValue(steppedValue, min, max).toFixed(precision));
}

interface IInlineVerticalSliderProps {
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
}

function InlineVerticalSlider(props: IInlineVerticalSliderProps) {
    const {
        min,
        max,
        step,
        value,
        onChange,
    } = props;

    const normalizedValue = clampSliderValue(value, min, max);
    const progress = ((normalizedValue - min) / (max - min || 1)) * 100;

    const updateValueByClientY = (
        clientY: number,
        element: HTMLDivElement,
    ) => {
        const rect = element.getBoundingClientRect();
        const ratio = 1 - ((clientY - rect.top) / rect.height);
        const nextValue = min + clampSliderValue(ratio, 0, 1) * (max - min);
        onChange(alignSliderValue(nextValue, min, max, step));
    };

    return (
        <div
            role="slider"
            tabIndex={0}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={normalizedValue}
            onClick={(event) => {
                event.stopPropagation();
            }}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateValueByClientY(event.clientY, event.currentTarget);
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    updateValueByClientY(event.clientY, event.currentTarget);
                }
            }}
            onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
            }}
            onKeyDown={(event) => {
                let nextValue = normalizedValue;
                switch (event.key) {
                    case "ArrowUp":
                    case "ArrowRight":
                        nextValue = normalizedValue + step;
                        break;
                    case "ArrowDown":
                    case "ArrowLeft":
                        nextValue = normalizedValue - step;
                        break;
                    case "Home":
                        nextValue = min;
                        break;
                    case "End":
                        nextValue = max;
                        break;
                    default:
                        return;
                }
                event.preventDefault();
                event.stopPropagation();
                onChange(alignSliderValue(nextValue, min, max, step));
            }}
            style={{
                position: "relative",
                width: "100%",
                maxWidth: 20,
                height: INLINE_SLIDER_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "none",
                cursor: "pointer",
                userSelect: "none",
                boxSizing: "border-box",
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    margin: "0 auto",
                    borderRadius: 999,
                    background: "color-mix(in srgb, var(--musicBarText) 18%, transparent)",
                }}
            ></div>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: 4,
                    height: `${progress}%`,
                    margin: "0 auto",
                    borderRadius: 999,
                    background: "var(--musicBarAccent)",
                }}
            ></div>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${100 - progress}%`,
                    width: INLINE_SLIDER_HANDLE_SIZE,
                    height: INLINE_SLIDER_HANDLE_SIZE,
                    margin: "0 auto",
                    transform: "translateY(-50%)",
                    borderRadius: "50%",
                    background: "var(--musicBarAccent)",
                    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.22)",
                }}
            ></div>
        </div>
    );
}

interface IFloatingBubbleProps {
    anchorRef: RefObject<HTMLDivElement>;
    visible: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    children: ReactNode;
}

function FloatingBubble(props: IFloatingBubbleProps) {
    const {
        anchorRef,
        visible,
        onMouseEnter,
        onMouseLeave,
        children,
    } = props;
    const bubbleRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties | null>(null);

    useEffect(() => {
        if (!visible) {
            setStyle(null);
            return;
        }

        const updatePosition = () => {
            const anchor = anchorRef.current;
            const bubble = bubbleRef.current;

            if (!anchor || !bubble) {
                return;
            }

            const anchorRect = anchor.getBoundingClientRect();
            const bubbleWidth = bubble.offsetWidth;
            const bubbleHeight = bubble.offsetHeight;
            const computedStyle = window.getComputedStyle(anchor);

            const centeredLeft = anchorRect.left + anchorRect.width / 2 - bubbleWidth / 2;
            const maxLeft = window.innerWidth - bubbleWidth - FLOATING_BUBBLE_VIEWPORT_MARGIN;
            const left = Math.min(
                Math.max(FLOATING_BUBBLE_VIEWPORT_MARGIN, centeredLeft),
                Math.max(FLOATING_BUBBLE_VIEWPORT_MARGIN, maxLeft),
            );

            let top = anchorRect.top - bubbleHeight - FLOATING_BUBBLE_OFFSET;
            if (top < FLOATING_BUBBLE_VIEWPORT_MARGIN) {
                top = Math.min(
                    window.innerHeight - bubbleHeight - FLOATING_BUBBLE_VIEWPORT_MARGIN,
                    anchorRect.bottom + FLOATING_BUBBLE_OFFSET,
                );
            }

            setStyle({
                left,
                top,
                "--musicBarText": computedStyle.getPropertyValue("--musicBarText").trim() || computedStyle.color,
                "--musicBarSurface": computedStyle.getPropertyValue("--musicBarSurface").trim(),
                "--musicBarSurfaceAlt": computedStyle.getPropertyValue("--musicBarSurfaceAlt").trim(),
                "--musicBarTextSecondary": computedStyle.getPropertyValue("--musicBarTextSecondary").trim(),
                "--musicBarAccent": computedStyle.getPropertyValue("--musicBarAccent").trim(),
            } as CSSProperties);
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchorRef, visible]);

    if (!visible) {
        return null;
    }

    return createPortal(
        <div
            ref={bubbleRef}
            className="volume-bubble-container"
            style={style ?? { visibility: "hidden" }}
            onClick={(event) => {
                event.stopPropagation();
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {children}
        </div>,
        document.body,
    );
}

function VolumeBtn() {
    const volume = useVolume();
    const isMute = useIsMute();
    const [showVolumeBubble, setShowVolumeBubble] = useState(false);
    const { t } = useTranslation();

    const wheelDeltaRef = useRef(0);
    const wheelStepRef = useRef(0);
    const volumeBtnRef = useRef<HTMLDivElement>(null);
    const closeBubbleTimerRef = useRef<number | null>(null);
    const flushWheelRef = useRef(
        throttle(
            () => {
                if (!wheelStepRef.current) return;
                const steps = wheelStepRef.current;
                wheelStepRef.current = 0;
                trackPlayer.adjustVolume(steps * WHEEL_VOLUME_STEP);
            },
            WHEEL_THROTTLE_MS,
            { leading: true, trailing: true },
        ),
    );

    useEffect(() => {
        const el = volumeBtnRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!Number.isFinite(e.deltaY)) return;
            wheelDeltaRef.current += -e.deltaY;
            const stepCount = wheelDeltaRef.current >= 0
                ? Math.floor(wheelDeltaRef.current / WHEEL_DELTA_UNIT)
                : Math.ceil(wheelDeltaRef.current / WHEEL_DELTA_UNIT);
            if (!stepCount) return;
            wheelDeltaRef.current -= stepCount * WHEEL_DELTA_UNIT;
            wheelStepRef.current += stepCount;
            flushWheelRef.current();
        };

        el.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            el.removeEventListener("wheel", handleWheel);
            flushWheelRef.current.cancel();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (closeBubbleTimerRef.current !== null) {
                window.clearTimeout(closeBubbleTimerRef.current);
            }
        };
    }, []);

    const openVolumeBubble = () => {
        if (closeBubbleTimerRef.current !== null) {
            window.clearTimeout(closeBubbleTimerRef.current);
            closeBubbleTimerRef.current = null;
        }
        setShowVolumeBubble(true);
    };

    const closeVolumeBubble = () => {
        if (closeBubbleTimerRef.current !== null) {
            window.clearTimeout(closeBubbleTimerRef.current);
        }
        closeBubbleTimerRef.current = window.setTimeout(() => {
            setShowVolumeBubble(false);
            closeBubbleTimerRef.current = null;
        }, 80);
    };

    const muted = isMute || volume === 0;

    return (
        <div
            className="extra-btn"
            role="button"
            ref={volumeBtnRef}
            onMouseEnter={openVolumeBubble}
            onMouseLeave={closeVolumeBubble}
            onClick={(e) => {
                e.stopPropagation();
                flushWheelRef.current.cancel();
                wheelDeltaRef.current = 0;
                wheelStepRef.current = 0;
                trackPlayer.toggleMute();
            }}
        >
            <Condition condition={showVolumeBubble}>
                <FloatingBubble
                    anchorRef={volumeBtnRef}
                    visible={showVolumeBubble}
                    onMouseEnter={openVolumeBubble}
                    onMouseLeave={closeVolumeBubble}
                >
                    <div className="volume-slider-container">
                        <InlineVerticalSlider
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(val) => {
                                trackPlayer.setVolume(val);
                            }}
                            value={volume}
                        ></InlineVerticalSlider>
                    </div>
                    <div className="volume-slider-tag">{(volume * 100).toFixed(0)}%</div>
                </FloatingBubble>
            </Condition>
            <SvgAsset
                title={muted ? t("music_bar.unmute") : t("music_bar.mute")}
                iconName={muted ? "speaker-x-mark" : "speaker-wave"}
            ></SvgAsset>
        </div>
    );
}

function SpeedBtn() {
    const speed = useSpeed();
    const [showSpeedBubble, setShowSpeedBubble] = useState(false);
    const tmpSpeedRef = useRef<number | null>(null);
    const speedRef = useRef(speed);
    const wheelDeltaRef = useRef(0);
    const wheelStepRef = useRef(0);
    const speedBtnRef = useRef<HTMLDivElement>(null);
    const closeBubbleTimerRef = useRef<number | null>(null);
    const { t } = useTranslation();
    const flushWheelRef = useRef(
        throttle(
            () => {
                if (!wheelStepRef.current) return;
                const steps = wheelStepRef.current;
                wheelStepRef.current = 0;
                const nextSpeed = Math.max(
                    SPEED_MIN,
                    Math.min(SPEED_MAX, speedRef.current + steps * WHEEL_SPEED_STEP),
                );
                trackPlayer.setSpeed(Number(nextSpeed.toFixed(2)));
            },
            WHEEL_THROTTLE_MS,
            { leading: true, trailing: true },
        ),
    );

    useEffect(() => {
        speedRef.current = speed;
    }, [speed]);

    useEffect(() => {
        const el = speedBtnRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!Number.isFinite(e.deltaY)) return;
            wheelDeltaRef.current += -e.deltaY;
            const stepCount = wheelDeltaRef.current >= 0
                ? Math.floor(wheelDeltaRef.current / WHEEL_DELTA_UNIT)
                : Math.ceil(wheelDeltaRef.current / WHEEL_DELTA_UNIT);
            if (!stepCount) return;
            wheelDeltaRef.current -= stepCount * WHEEL_DELTA_UNIT;
            wheelStepRef.current += stepCount;
            flushWheelRef.current();
        };

        el.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            el.removeEventListener("wheel", handleWheel);
            flushWheelRef.current.cancel();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (closeBubbleTimerRef.current !== null) {
                window.clearTimeout(closeBubbleTimerRef.current);
            }
        };
    }, []);

    const openSpeedBubble = () => {
        if (closeBubbleTimerRef.current !== null) {
            window.clearTimeout(closeBubbleTimerRef.current);
            closeBubbleTimerRef.current = null;
        }
        setShowSpeedBubble(true);
    };

    const closeSpeedBubble = () => {
        if (closeBubbleTimerRef.current !== null) {
            window.clearTimeout(closeBubbleTimerRef.current);
        }
        closeBubbleTimerRef.current = window.setTimeout(() => {
            setShowSpeedBubble(false);
            closeBubbleTimerRef.current = null;
        }, 80);
    };

    return (
        <div
            className="extra-btn"
            role="button"
            ref={speedBtnRef}
            onMouseEnter={openSpeedBubble}
            onMouseLeave={closeSpeedBubble}
            onClick={() => {
                flushWheelRef.current.cancel();
                wheelDeltaRef.current = 0;
                wheelStepRef.current = 0;
                if (tmpSpeedRef.current === null || tmpSpeedRef.current === speed) {
                    tmpSpeedRef.current = 1;
                }

                trackPlayer.setSpeed(tmpSpeedRef.current);
                tmpSpeedRef.current = speed;
            }}
        >
            <Condition condition={showSpeedBubble}>
                <FloatingBubble
                    anchorRef={speedBtnRef}
                    visible={showSpeedBubble}
                    onMouseEnter={openSpeedBubble}
                    onMouseLeave={closeSpeedBubble}
                >
                    <div className="volume-slider-container">
                        <InlineVerticalSlider
                            min={0.25}
                            max={2}
                            step={0.05}
                            onChange={(val) => {
                                trackPlayer.setSpeed(val);
                            }}
                            value={speed}
                        ></InlineVerticalSlider>
                    </div>
                    <div className="volume-slider-tag">{speed.toFixed(2)}x</div>
                </FloatingBubble>
            </Condition>
            <SvgAsset
                title={t("music_bar.playback_speed")}
                iconName={"dashboard-speed"}
            ></SvgAsset>
        </div>
    );
}

const qualityAbbr: Record<IMusic.IQualityKey, string> = {
    "mgg": "MG",
    "128k": "LQ",
    "192k": "MQ",
    "320k": "HQ",
    "flac": "SQ",
    "flac24bit": "HR",
    "hires": "HR",
    "vinyl": "VN",
    "dolby": "DB",
    "atmos": "AT",
    "atmos_plus": "A+",
    "master": "MS",
};

function QualityBtn() {
    const currentMusic = useCurrentMusic();
    const quality = useQuality();
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);

    return (
        <div
            className="extra-btn quality-btn"
            role="button"
            title={getQualityDisplayText(quality, t)}
            onClick={async () => {
                if (!currentMusic || isLoading) {
                    return;
                }

                setIsLoading(true);
                try {
                    const { choices } = await resolveMusicQualityChoices(currentMusic, t);

                    if (!choices.length) {
                        toast.warn(t("music_bar.no_music_quality_available"));
                        return;
                    }

                    const defaultValue = choices.some((choice) => choice.value === quality)
                        ? quality
                        : choices[0].value;

                    showModal("SelectOne", {
                        title: t("music_bar.choose_music_quality"),
                        defaultValue,
                        choices,
                        autoOkOnSelect: true,
                        async onOk(value) {
                            const success = await trackPlayer.setQuality(value as IMusic.IQualityKey);
                            if (!success) {
                                toast.warn(t("music_bar.current_quality_not_available_for_current_music"));
                            }
                        },
                    });
                } finally {
                    setIsLoading(false);
                }
            }}
        >
            <span className="quality-abbr-text">{qualityAbbr[quality] || "HQ"}</span>
        </div>
    );
}
function LyricBtn() {
    const enableDesktopLyric = useAppConfig("lyric.enableDesktopLyric");
    const { t } = useTranslation();

    return (
        <div
            className={classNames({
                "extra-btn": true,
                highlight: enableDesktopLyric,
            })}
            role="button"
            onClick={async () => {
                appWindowUtil.setLyricWindow(!enableDesktopLyric);
            }}
        >
            <SvgAsset
                iconName={isCN() ? "lyric" : "lyric-en"}
                title={t("music_bar.desktop_lyric")}
            ></SvgAsset>
        </div>
    );
}
