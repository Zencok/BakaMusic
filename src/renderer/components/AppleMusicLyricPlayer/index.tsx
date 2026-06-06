import "./index.scss";
import { useEffect, useMemo, useRef } from "react";
import { DomLyricPlayer } from "@amll-core/lyric-player/dom/index";
import { MaskObsceneWordsMode } from "@amll-core/lyric-player/index";
import type { LyricLine } from "@amll-core/interfaces";

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

interface IAmlLyricPlayerWithLineObjects {
    currentLyricLineObjects?: IAmlLyricLineObject[];
}

interface IAmlLyricPlayerWithInactiveBrightness {
    setInactiveBrightness?: (value?: number) => void;
}

function setPlayerInactiveBrightness(player: DomLyricPlayer, value: number) {
    (player as unknown as IAmlLyricPlayerWithInactiveBrightness)
        .setInactiveBrightness?.(value);
}

function syncLyricLinePlayState(
    player: DomLyricPlayer | null,
    currentTimeMs: number,
    enabled: boolean,
) {
    if (!enabled || !player) {
        return;
    }

    const lineObjects = (player as unknown as IAmlLyricPlayerWithLineObjects)
        .currentLyricLineObjects;
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

        lineObject.getElement().dataset.lyricPlayState = playState;
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
    const playingRef = useRef(playing);
    const speedRef = useRef(speed);

    const hasLyricLines = lyricLines.length > 0;

    const cssVars = useMemo(() => ({
        ...(style || {}),
        ...(fontSize ? { "--amll-lp-font-size": typeof fontSize === "number" ? `${fontSize}px` : fontSize } : {}),
        "--amll-lp-color": textColor,
        "--amll-lp-hover-bg-color": hoverBackgroundColor,
    } as React.CSSProperties), [fontSize, hoverBackgroundColor, style, textColor]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) {
            return;
        }

        const player = new DomLyricPlayer();
        playerRef.current = player;
        player.setMaskObsceneWords(MaskObsceneWordsMode.Disabled);
        player.setAlignAnchor(alignAnchor);
        player.setAlignPosition(alignPosition);
        player.setCenterInterludeDots(centerInterludeDots);
        player.setEnableBlur(enableBlur);
        player.setEnableScale(enableScale);
        player.setEnableSpring(enableSpring);
        player.setHidePassedLines(hidePassedLines);
        player.setWordFadeWidth(wordFadeWidth);
        setPlayerInactiveBrightness(player, inactiveBrightness);
        stage.appendChild(player.getElement());

        if (playing) {
            player.resume();
        } else {
            player.pause();
        }

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
        setPlayerInactiveBrightness(player, inactiveBrightness);
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
            syncLyricLinePlayState(player, currentTimeMs, markLinePlayState);
            return;
        }
        lastLyricSignatureRef.current = lyricSignature;

        player.setLyricLines(lyricLines, currentTimeMs);
        syncLyricLinePlayState(player, currentTimeMs, markLinePlayState);
        lastSyncedTimeRef.current = currentTimeMs;
        lastPropTimeRef.current = currentTimeMs;
        anchorTimeRef.current = currentTimeMs;
        anchorFrameTimeRef.current = performance.now();
    }, [lyricSignature, markLinePlayState]);

    useEffect(() => {
        const player = playerRef.current;
        playingRef.current = playing;
        if (!player) {
            return;
        }

        if (playing) {
            player.resume();
        } else {
            player.pause();
            player.setCurrentTime(anchorTimeRef.current, true);
            syncLyricLinePlayState(player, anchorTimeRef.current, markLinePlayState);
        }
    }, [markLinePlayState, playing]);

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
        const animate = (timestamp: number) => {
            const player = playerRef.current;
            if (player) {
                const lastFrameTime = lastFrameTimeRef.current || timestamp;
                const delta = Math.max(0, timestamp - lastFrameTime);
                lastFrameTimeRef.current = timestamp;

                const frameTime = playingRef.current
                    ? anchorTimeRef.current + (timestamp - anchorFrameTimeRef.current) * speedRef.current
                    : anchorTimeRef.current;

                if (hasLyricLines && playingRef.current) {
                    player.setCurrentTime(frameTime);
                    syncLyricLinePlayState(player, frameTime, markLinePlayState);
                    lastSyncedTimeRef.current = frameTime;
                }
                player.update(delta);
            }

            rafRef.current = requestAnimationFrame(animate);
        };

        rafRef.current = requestAnimationFrame(animate);
        return () => {
            cancelAnimationFrame(rafRef.current);
            lastFrameTimeRef.current = 0;
        };
    }, [hasLyricLines, markLinePlayState]);

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
