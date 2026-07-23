import "./index.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AmlLyricLineTiming, IBakaAmlLyricLine } from "@/common/amll-lyric";
import {
    DomLyricPlayer,
    type LyricLineMouseEvent,
} from "@amll-core/lyric-player/dom/index";
import { MaskObsceneWordsMode } from "@amll-core/lyric-player/index";
import type { LyricLine } from "@amll-core/interfaces";
import {
    getLyricFrameDelta,
    settlePausedLyricLayout,
    shouldRunLyricAnimation,
} from "./animation-state";

interface IAppleMusicLyricPlayerProps {
    active?: boolean;
    lyricLines?: LyricLine[];
    currentTimeMs?: number;
    playing?: boolean;
    speed?: number;
    className?: string;
    style?: React.CSSProperties;
    fontSize?: number | string;
    textColor?: string;
    hoverBackgroundColor?: string;
    placeholder?: React.ReactNode;
    alignAnchor?: "top" | "bottom" | "center";
    alignPosition?: number;
    centerInterludeDots?: boolean;
    enableBlur?: boolean;
    enableScale?: boolean;
    enableSpring?: boolean;
    hidePassedLines?: boolean;
    wordFadeWidth?: number;
    inactiveBrightness?: number;
    markLinePlayState?: boolean;
    onLineClick?: (line: LyricLine, lineIndex: number) => void;
}

type LyricLinePlayState = "played" | "current" | "future";

interface IAmlLyricLineObject {
    getLine: () => LyricLine;
    getElement: () => HTMLElement;
}

interface IAmlLyricLineGroup {
    mainLine: IAmlLyricLineObject;
    bgLine?: IAmlLyricLineObject;
}

interface IAmlLyricPlayerWithLineGroups {
    currentLyricGroups?: IAmlLyricLineGroup[];
}

function getLyricLineTiming(line: LyricLine): AmlLyricLineTiming {
    return (line as IBakaAmlLyricLine).__bakaTiming ?? "line";
}

function syncLyricLinePlayState(
    player: DomLyricPlayer | null,
    currentTimeMs: number,
    enabled: boolean,
): number {
    if (!enabled || !player) {
        return Number.POSITIVE_INFINITY;
    }

    const lineObjects = (player as unknown as IAmlLyricPlayerWithLineGroups)
        .currentLyricGroups
        ?.flatMap((group) => (
            group.bgLine ? [group.mainLine, group.bgLine] : [group.mainLine]
        ));
    if (!lineObjects?.length) {
        return Number.POSITIVE_INFINITY;
    }

    let nextTransitionTime = Number.POSITIVE_INFINITY;
    lineObjects.forEach((lineObject) => {
        const line = lineObject.getLine();
        let playState: LyricLinePlayState = "future";

        if (line.endTime <= currentTimeMs) {
            playState = "played";
        } else if (line.startTime <= currentTimeMs && line.endTime > currentTimeMs) {
            playState = "current";
        }

        if (playState === "future") {
            nextTransitionTime = Math.min(nextTransitionTime, line.startTime);
        } else if (playState === "current") {
            nextTransitionTime = Math.min(nextTransitionTime, line.endTime);
        }

        const element = lineObject.getElement();
        const timing = getLyricLineTiming(line);

        if (element.dataset.lyricPlayState !== playState) {
            element.dataset.lyricPlayState = playState;
        }
        if (element.dataset.lyricTiming !== timing) {
            element.dataset.lyricTiming = timing;
        }
    });

    return nextTransitionTime;
}

export default function AppleMusicLyricPlayer({
    active = true,
    lyricLines = [],
    currentTimeMs = 0,
    playing = false,
    speed = 1,
    className,
    style,
    fontSize,
    textColor = "#ffffff",
    hoverBackgroundColor = "rgba(255,255,255,0.06)",
    placeholder,
    alignAnchor = "center",
    alignPosition = 0.5,
    centerInterludeDots = false,
    enableBlur = true,
    enableScale = true,
    enableSpring = true,
    hidePassedLines = false,
    wordFadeWidth = 0.68,
    inactiveBrightness = 0.2,
    markLinePlayState = false,
    onLineClick,
}: IAppleMusicLyricPlayerProps) {
    const stageRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<DomLyricPlayer | null>(null);
    const rafRef = useRef(0);
    const lastFrameTimeRef = useRef(0);
    const anchorTimeRef = useRef(currentTimeMs);
    const anchorFrameTimeRef = useRef(0);
    const lastSyncedTimeRef = useRef(currentTimeMs);
    const lastPropTimeRef = useRef(currentTimeMs);
    const nextPlayStateTransitionRef = useRef(Number.NEGATIVE_INFINITY);
    const currentTimePropRef = useRef(currentTimeMs);
    const lyricLinesRef = useRef(lyricLines);
    const onLineClickRef = useRef(onLineClick);
    const playingRef = useRef(playing);
    const speedRef = useRef(speed);
    const [documentVisible, setDocumentVisible] = useState(
        document.visibilityState !== "hidden",
    );

    currentTimePropRef.current = currentTimeMs;
    lyricLinesRef.current = lyricLines;
    onLineClickRef.current = onLineClick;

    const hasLyricLines = lyricLines.length > 0;

    const cssVars = useMemo(() => ({
        ...(style || {}),
        ...(fontSize ? { "--amll-lp-font-size": typeof fontSize === "number" ? `${fontSize}px` : fontSize } : {}),
        "--amll-lp-color": textColor,
        "--amll-lp-hover-bg-color": hoverBackgroundColor,
    } as React.CSSProperties), [fontSize, hoverBackgroundColor, style, textColor]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setDocumentVisible(document.visibilityState !== "hidden");
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) {
            return;
        }

        const player = new DomLyricPlayer();
        const handleLineClick = (event: Event) => {
            const lyricEvent = event as LyricLineMouseEvent;
            onLineClickRef.current?.(
                lyricEvent.line.getLine(),
                lyricEvent.lineIndex,
            );
        };
        playerRef.current = player;
        player.setMaskObsceneWords(MaskObsceneWordsMode.Disabled);
        player.addEventListener("line-click", handleLineClick);
        stage.appendChild(player.getElement());

        return () => {
            cancelAnimationFrame(rafRef.current);
            player.removeEventListener("line-click", handleLineClick);
            player.dispose();
            playerRef.current = null;
        };
    }, []);

    useEffect(() => {
        playerRef.current?.setLineClickEnabled(Boolean(onLineClick));
    }, [onLineClick]);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) {
            return;
        }

        player.setAlignAnchor(alignAnchor);
        player.setAlignPosition(alignPosition);
        player.setCenterInterludeDots(centerInterludeDots);
        player.setEnableBlur(enableBlur);
        player.setEnableScale(enableScale);
        player.setEnableSpring(enableSpring);
        player.setHidePassedLines(hidePassedLines);
        player.setWordFadeWidth(wordFadeWidth);
        player.setInactiveBrightness(inactiveBrightness);
    }, [alignAnchor, alignPosition, centerInterludeDots, enableBlur, enableScale, enableSpring, hidePassedLines, wordFadeWidth, inactiveBrightness]);

    const lyricSignature = useMemo(
        () => lyricLines
            .map((line) => {
                const wordsKey = line.words
                    ?.map((word) => `${word.word}${word.romanWord ?? ""}`)
                    .join("") ?? "";
                return [
                    line.startTime,
                    line.endTime,
                    Number(line.isBG),
                    Number(line.isDuet),
                    wordsKey,
                    line.translatedLyric ?? "",
                    line.romanLyric ?? "",
                ].join("");
            })
            .join(""),
        [lyricLines],
    );
    const lastLyricSignatureRef = useRef<string | null>(null);

    useEffect(() => {
        const player = playerRef.current;
        if (!player || !active) {
            return;
        }

        if (lastLyricSignatureRef.current === lyricSignature) {
            nextPlayStateTransitionRef.current = syncLyricLinePlayState(
                player,
                currentTimePropRef.current,
                markLinePlayState,
            );
            if (!playingRef.current) {
                settlePausedLyricLayout((delta) => player.update(delta));
            }
            return;
        }
        lastLyricSignatureRef.current = lyricSignature;

        const nextCurrentTime = currentTimePropRef.current;
        player.setLyricLines(lyricLinesRef.current, nextCurrentTime);
        nextPlayStateTransitionRef.current = syncLyricLinePlayState(
            player,
            nextCurrentTime,
            markLinePlayState,
        );
        lastSyncedTimeRef.current = nextCurrentTime;
        lastPropTimeRef.current = nextCurrentTime;
        anchorTimeRef.current = nextCurrentTime;
        anchorFrameTimeRef.current = performance.now();
        // Paint while paused: show()/hide() is driven only by update().
        if (!playingRef.current) {
            settlePausedLyricLayout((delta) => player.update(delta));
        }
    }, [active, lyricSignature, markLinePlayState]);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) {
            playingRef.current = playing;
            return;
        }

        const transitionTime = currentTimePropRef.current;
        anchorTimeRef.current = transitionTime;
        anchorFrameTimeRef.current = performance.now();
        lastSyncedTimeRef.current = transitionTime;

        if (active && playing && documentVisible) {
            // A long pause leaves the previous RAF anchor far in the past. Re-sync
            // before resuming so the first frame cannot extrapolate by the pause duration.
            playingRef.current = false;
            player.setCurrentTime(transitionTime, true);
            nextPlayStateTransitionRef.current = syncLyricLinePlayState(
                player,
                transitionTime,
                markLinePlayState,
            );
            player.resume();
            playingRef.current = true;
        } else {
            playingRef.current = false;
            player.pause();
            player.setCurrentTime(transitionTime, true);
            nextPlayStateTransitionRef.current = syncLyricLinePlayState(
                player,
                transitionTime,
                markLinePlayState,
            );
            if (active && documentVisible) {
                settlePausedLyricLayout((delta) => player.update(delta));
            }
        }
    }, [active, documentVisible, markLinePlayState, playing]);

    useEffect(() => {
        anchorTimeRef.current = currentTimeMs;
        anchorFrameTimeRef.current = performance.now();

        const player = playerRef.current;
        if (!player || !active) {
            lastPropTimeRef.current = currentTimeMs;
            return;
        }

        const prevPropTime = lastPropTimeRef.current;
        const isSeek = Math.abs(currentTimeMs - prevPropTime) > 1200;
        player.setCurrentTime(currentTimeMs, isSeek || !playingRef.current);
        nextPlayStateTransitionRef.current = syncLyricLinePlayState(
            player,
            currentTimeMs,
            markLinePlayState,
        );
        lastSyncedTimeRef.current = currentTimeMs;
        lastPropTimeRef.current = currentTimeMs;
        if (!playingRef.current) {
            settlePausedLyricLayout((delta) => player.update(delta));
        }
    }, [active, currentTimeMs, markLinePlayState]);

    useEffect(() => {
        speedRef.current = speed || 1;
        anchorTimeRef.current = lastSyncedTimeRef.current;
        anchorFrameTimeRef.current = performance.now();
    }, [speed]);

    useEffect(() => {
        if (!active || !shouldRunLyricAnimation(hasLyricLines, playing, documentVisible)) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
            lastFrameTimeRef.current = 0;
            return;
        }

        const animate = (timestamp: number) => {
            const player = playerRef.current;
            if (player) {
                const delta = getLyricFrameDelta(
                    timestamp,
                    lastFrameTimeRef.current,
                );
                lastFrameTimeRef.current = timestamp;

                const frameTime = playingRef.current
                    ? anchorTimeRef.current + (timestamp - anchorFrameTimeRef.current) * speedRef.current
                    : anchorTimeRef.current;

                player.setCurrentTime(frameTime);
                if (
                    markLinePlayState
                    && (
                        frameTime >= nextPlayStateTransitionRef.current
                        || frameTime < lastSyncedTimeRef.current
                    )
                ) {
                    nextPlayStateTransitionRef.current = syncLyricLinePlayState(
                        player,
                        frameTime,
                        true,
                    );
                }
                lastSyncedTimeRef.current = frameTime;
                player.update(delta);
            }

            rafRef.current = requestAnimationFrame(animate);
        };

        rafRef.current = requestAnimationFrame(animate);
        return () => {
            cancelAnimationFrame(rafRef.current);
            lastFrameTimeRef.current = 0;
        };
    }, [active, documentVisible, hasLyricLines, markLinePlayState, playing]);

    return (
        <div
            className={className
                ? `apple-music-lyric-player ${className}`
                : "apple-music-lyric-player"}
            style={cssVars}
        >
            <div ref={stageRef} className="apple-music-lyric-player--stage"></div>
            {!hasLyricLines && placeholder ? (
                <div className="apple-music-lyric-player--placeholder">{placeholder}</div>
            ) : null}
        </div>
    );
}
