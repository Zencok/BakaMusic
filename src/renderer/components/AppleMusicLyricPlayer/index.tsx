import "./index.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AmlLyricLineTiming, IBakaAmlLyricLine } from "@/common/amll-lyric";
import { DomLyricPlayer } from "@amll-core/lyric-player/dom/index";
import { MaskObsceneWordsMode } from "@amll-core/lyric-player/index";
import type { LyricLine } from "@amll-core/interfaces";
import { shouldRunLyricAnimation } from "./animation-state";

interface IAppleMusicLyricPlayerProps {
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
) {
    if (!enabled || !player) {
        return;
    }

    const lineObjects = (player as unknown as IAmlLyricPlayerWithLineGroups)
        .currentLyricGroups
        ?.flatMap((group) => (
            group.bgLine ? [group.mainLine, group.bgLine] : [group.mainLine]
        ));
    if (!lineObjects?.length) {
        return;
    }

    lineObjects.forEach((lineObject) => {
        const line = lineObject.getLine();
        let playState: LyricLinePlayState = "future";

        if (line.endTime <= currentTimeMs) {
            playState = "played";
        } else if (line.startTime <= currentTimeMs && line.endTime > currentTimeMs) {
            playState = "current";
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
}

export default function AppleMusicLyricPlayer({
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
}: IAppleMusicLyricPlayerProps) {
    const stageRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<DomLyricPlayer | null>(null);
    const rafRef = useRef(0);
    const lastFrameTimeRef = useRef(0);
    const anchorTimeRef = useRef(currentTimeMs);
    const anchorFrameTimeRef = useRef(0);
    const lastSyncedTimeRef = useRef(currentTimeMs);
    const lastPropTimeRef = useRef(currentTimeMs);
    const currentTimePropRef = useRef(currentTimeMs);
    const lyricLinesRef = useRef(lyricLines);
    const playingRef = useRef(playing);
    const speedRef = useRef(speed);
    const [documentVisible, setDocumentVisible] = useState(
        document.visibilityState !== "hidden",
    );

    currentTimePropRef.current = currentTimeMs;
    lyricLinesRef.current = lyricLines;

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
        playerRef.current = player;
        player.setMaskObsceneWords(MaskObsceneWordsMode.Disabled);
        stage.appendChild(player.getElement());

        return () => {
            cancelAnimationFrame(rafRef.current);
            player.dispose();
            playerRef.current = null;
        };
    }, []);

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
                return `${line.startTime}${wordsKey}${line.translatedLyric ?? ""}${line.romanLyric ?? ""}`;
            })
            .join(""),
        [lyricLines],
    );
    const lastLyricSignatureRef = useRef<string | null>(null);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) {
            return;
        }

        if (lastLyricSignatureRef.current === lyricSignature) {
            syncLyricLinePlayState(
                player,
                currentTimePropRef.current,
                markLinePlayState,
            );
            return;
        }
        lastLyricSignatureRef.current = lyricSignature;

        const nextCurrentTime = currentTimePropRef.current;
        player.setLyricLines(lyricLinesRef.current, nextCurrentTime);
        syncLyricLinePlayState(player, nextCurrentTime, markLinePlayState);
        lastSyncedTimeRef.current = nextCurrentTime;
        lastPropTimeRef.current = nextCurrentTime;
        anchorTimeRef.current = nextCurrentTime;
        anchorFrameTimeRef.current = performance.now();
    }, [lyricSignature, markLinePlayState]);

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

        if (playing && documentVisible) {
            // A long pause leaves the previous RAF anchor far in the past. Re-sync
            // before resuming so the first frame cannot extrapolate by the pause duration.
            playingRef.current = false;
            player.setCurrentTime(transitionTime, true);
            syncLyricLinePlayState(player, transitionTime, markLinePlayState);
            player.resume();
            playingRef.current = true;
        } else {
            playingRef.current = false;
            player.pause();
            player.setCurrentTime(transitionTime, true);
            syncLyricLinePlayState(player, transitionTime, markLinePlayState);
        }
    }, [documentVisible, markLinePlayState, playing]);

    useEffect(() => {
        anchorTimeRef.current = currentTimeMs;
        anchorFrameTimeRef.current = performance.now();

        const player = playerRef.current;
        if (!player) {
            return;
        }

        const prevPropTime = lastPropTimeRef.current;
        const isSeek = Math.abs(currentTimeMs - prevPropTime) > 1200;
        player.setCurrentTime(currentTimeMs, isSeek);
        syncLyricLinePlayState(player, currentTimeMs, markLinePlayState);
        lastSyncedTimeRef.current = currentTimeMs;
        lastPropTimeRef.current = currentTimeMs;
    }, [currentTimeMs, markLinePlayState]);

    useEffect(() => {
        speedRef.current = speed || 1;
        anchorTimeRef.current = lastSyncedTimeRef.current;
        anchorFrameTimeRef.current = performance.now();
    }, [speed]);

    useEffect(() => {
        if (!shouldRunLyricAnimation(hasLyricLines, playing, documentVisible)) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
            lastFrameTimeRef.current = 0;
            return;
        }

        const animate = (timestamp: number) => {
            const player = playerRef.current;
            if (player) {
                const lastFrameTime = lastFrameTimeRef.current || timestamp;
                const delta = Math.max(0, timestamp - lastFrameTime);
                lastFrameTimeRef.current = timestamp;

                const frameTime = playingRef.current
                    ? anchorTimeRef.current + (timestamp - anchorFrameTimeRef.current) * speedRef.current
                    : anchorTimeRef.current;

                player.setCurrentTime(frameTime);
                syncLyricLinePlayState(player, frameTime, markLinePlayState);
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
    }, [documentVisible, hasLyricLines, markLinePlayState, playing]);

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
