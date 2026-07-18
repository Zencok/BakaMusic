import trackPlayer from "../core/track-player";
import "./styles/fallback.scss";
import type { FallbackProps } from "react-error-boundary";
import { toError } from "@/common/error-util";
import { useTranslation } from "react-i18next";

export default function Fallback({ error, resetErrorBoundary }: FallbackProps) {
    const normalizedError = toError(error);
    const { t } = useTranslation();

    return (
        <div className="fallback-container" role="alert">
            <div className="fallback-content">
                <div className="fallback-title">
                    {t("fallback.title")}
                </div>

                <div className="fallback-actions">
                    <button
                        type="button"
                        className="reset-button"
                        onClick={() => resetErrorBoundary()}
                    >
                        {t("fallback.reset")}
                    </button>
                </div>

                <div className="fallback-description">
                    {t("fallback.description")}
                </div>

                <div className="fallback-section">
                    <div className="section-title">{t("fallback.music_info")}</div>
                    <div className="section-content">
                        <pre className="music-info">
                            {JSON.stringify(trackPlayer.currentMusic, null, 2)}
                        </pre>
                    </div>
                </div>

                <div className="fallback-section">
                    <div className="section-title">{t("fallback.error_info")}</div>
                    <div className="section-content">
                        <pre className="error-message">
                            {normalizedError.message}
                        </pre>
                        {normalizedError.stack && (
                            <pre className="error-message" style={{ marginTop: 8 }}>
                                {normalizedError.stack}
                            </pre>
                        )}
                    </div>
                </div>


            </div>
        </div>
    );
}
