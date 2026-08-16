import { useEffect, useState } from "react";
import Base from "../Base";
import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import { hideModal, showModal } from "../..";
import PluginManager from "@shared/plugin-manager/renderer";
import trackPlayer from "@renderer/core/track-player";
import MusicSheet from "@renderer/core/music-sheet";
import {
    cancelRecognizeSystemAudio,
    prepareRecognizeMatchForPlayback,
    recognizeSystemAudio,
    RECOGNIZE_MAX_SECONDS,
    type RecognizeMatch,
} from "@renderer/utils/song-recognition";
import { useTranslation } from "react-i18next";

type RecognitionStatus = "idle" | "recording" | "recognizing" | "success" | "failed";

export default function SongRecognition() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<RecognitionStatus>("idle");
    const [seconds, setSeconds] = useState(0);
    const [matches, setMatches] = useState<RecognizeMatch[]>([]);
    const [error, setError] = useState("");
    const [preparingMatchKey, setPreparingMatchKey] = useState<string | null>(null);
    const [, setFavoriteTick] = useState(0);
    const available = PluginManager.getSortedSupportedPlugin("recognize");

    useEffect(() => {
        if (status !== "recording") return;
        const timer = window.setInterval(() => {
            setSeconds((value) => {
                const next = value + 1;
                if (next >= RECOGNIZE_MAX_SECONDS) setStatus("recognizing");
                return next;
            });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [status]);

    useEffect(() => () => cancelRecognizeSystemAudio(), []);

    async function startRecognition() {
        if (status === "recording" || status === "recognizing") return;
        if (!available.length) {
            setError(t("song_recognition.no_plugin"));
            setStatus("failed");
            return;
        }
        setMatches([]);
        setError("");
        setSeconds(0);
        setStatus("recording");
        try {
            const result = await recognizeSystemAudio();
            setMatches(result);
            setStatus(result.length ? "success" : "failed");
            if (!result.length) setError(t("song_recognition.no_result"));
        } catch (reason) {
            if (reason instanceof Error && reason.message === "识别已取消") {
                setStatus("idle");
                return;
            }
            setError(reason instanceof Error ? reason.message : t("song_recognition.failed"));
            setStatus("failed");
        }
    }

    function stopRecognition() {
        cancelRecognizeSystemAudio();
        setSeconds(0);
        setStatus("idle");
    }

    async function playMatch(match: RecognizeMatch) {
        const matchKey = `${match.platform}:${match.musicItem.id}`;
        if (preparingMatchKey) return;
        setPreparingMatchKey(matchKey);
        try {
            const preparedMatch = await prepareRecognizeMatchForPlayback(match);
            setMatches((currentMatches) => currentMatches.map((item) =>
                `${item.platform}:${item.musicItem.id}` === matchKey
                    ? preparedMatch
                    : item,
            ));
            await trackPlayer.playMusic(preparedMatch.musicItem);
            hideModal();
        } finally {
            setPreparingMatchKey(null);
        }
    }

    async function toggleFavorite(match: RecognizeMatch) {
        if (MusicSheet.frontend.isFavoriteMusic(match.musicItem)) {
            await MusicSheet.frontend.removeMusicFromFavorite(match.musicItem);
        } else {
            await MusicSheet.frontend.addMusicToFavorite(match.musicItem);
        }
        setFavoriteTick((value) => value + 1);
    }

    return (
        <Base withBlur={false} defaultClose>
            <div className="modal--song-recognition-container shadow backdrop-color">
                <Base.Header>
                    <span className="song-recognition-title">
                        <SvgAsset iconName="song-recognition" size={18}></SvgAsset>
                        {t("song_recognition.title")}
                    </span>
                </Base.Header>
                {status !== "success" ? (
                    <div className="song-recognition-main">
                        <button
                            type="button"
                            className={`song-recognition-mic song-recognition-mic--${status}`}
                            disabled={status === "recognizing"}
                            aria-label={status === "recording" ? t("song_recognition.stop") : t("song_recognition.start")}
                            onClick={() => status === "recording" ? stopRecognition() : void startRecognition()}
                        >
                            <SvgAsset iconName={status === "recognizing" ? "rolling-1s" : "song-recognition"} size={34}></SvgAsset>
                        </button>
                        <p className="song-recognition-status">
                            {status === "recording"
                                ? t("song_recognition.listening", { seconds, max: RECOGNIZE_MAX_SECONDS })
                                : status === "recognizing"
                                    ? t("song_recognition.recognizing")
                                    : status === "failed"
                                        ? error
                                        : t("song_recognition.hint")}
                        </p>
                        <div className="song-recognition-wave" aria-hidden="true">
                            {Array.from({ length: 7 }, (_, index) => (
                                <span key={index} data-active={status === "recording" ? "true" : "false"}></span>
                            ))}
                        </div>
                        <p className="song-recognition-help">{t("song_recognition.help")}</p>
                        {status === "failed" && (
                            <button type="button" className="song-recognition-retry" onClick={() => void startRecognition()}>
                                <SvgAsset iconName="arrow-path" size={16}></SvgAsset>
                                {t("song_recognition.retry")}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="song-recognition-results">
                        <div className="song-recognition-result-summary">
                            {t("song_recognition.result_count", { count: matches.length })}
                        </div>
                        <ul>
                            {matches.map((match, index) => {
                                const favorite = MusicSheet.frontend.isFavoriteMusic(match.musicItem);
                                const matchKey = `${match.platform}:${match.musicItem.id}`;
                                const preparing = preparingMatchKey === matchKey;
                                return (
                                    <li key={`${match.platform}-${match.musicItem.id}-${index}`}>
                                        <div className="song-recognition-confidence">
                                            {Math.round(match.confidence * 100)}%
                                            <small>{t("song_recognition.match")}</small>
                                        </div>
                                        <div className="song-recognition-cover">
                                            {match.musicItem.artwork
                                                ? <img src={match.musicItem.artwork} alt="" referrerPolicy="no-referrer"></img>
                                                : <SvgAsset iconName="musical-note" size={26}></SvgAsset>}
                                        </div>
                                        <div className="song-recognition-info">
                                            <strong>{match.musicItem.title}</strong>
                                            <span>{match.musicItem.artist || t("song_recognition.unknown_artist")}{match.musicItem.album ? ` · ${match.musicItem.album}` : ""}</span>
                                            <small>{match.platform}</small>
                                        </div>
                                        <div className="song-recognition-actions">
                                            <button type="button" disabled={preparingMatchKey !== null} title={t("song_recognition.play")} aria-label={t("song_recognition.play")} onClick={() => void playMatch(match)}>
                                                <SvgAsset iconName={preparing ? "rolling-1s" : "play"} size={16}></SvgAsset>
                                            </button>
                                            <button type="button" className={favorite ? "is-favorite" : ""} title={favorite ? t("song_recognition.unfavorite") : t("song_recognition.favorite")} aria-label={favorite ? t("song_recognition.unfavorite") : t("song_recognition.favorite")} onClick={() => void toggleFavorite(match)}>
                                                <SvgAsset iconName="heart" size={16}></SvgAsset>
                                            </button>
                                            <button type="button" title={t("song_recognition.add_to_sheet")} aria-label={t("song_recognition.add_to_sheet")} onClick={() => showModal("AddMusicToSheet", { musicItems: match.musicItem })}>
                                                <SvgAsset iconName="plus" size={16}></SvgAsset>
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        <button type="button" className="song-recognition-retry" onClick={() => void startRecognition()}>
                            <SvgAsset iconName="arrow-path" size={16}></SvgAsset>
                            {t("song_recognition.retry")}
                        </button>
                    </div>
                )}
            </div>
        </Base>
    );
}
