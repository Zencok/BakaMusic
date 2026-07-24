import { toError } from "@/common/error-util";
import SvgAsset from "@/renderer/components/SvgAsset";
import { shellUtil } from "@shared/utils/renderer";
import type { FallbackProps } from "react-error-boundary";
import { useTranslation } from "react-i18next";
import trackPlayer from "../core/track-player";
import "./styles/fallback.scss";

const GITHUB_ISSUES_URL = "https://github.com/ShenYichenCN/BakaMusic_syc/issues";

function formatDiagnosticValue(value: unknown, emptyLabel: string) {
    if (value === null || value === undefined) {
        return emptyLabel;
    }

    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

export default function Fallback({ error, resetErrorBoundary }: FallbackProps) {
    const normalizedError = toError(error);
    const { t } = useTranslation();
    const currentMusic = trackPlayer.currentMusic;
    const musicSummary = currentMusic
        ? [currentMusic.title, currentMusic.artist].filter(Boolean).join(" · ")
        : t("fallback.no_music");
    const musicInfo = formatDiagnosticValue(currentMusic, t("fallback.no_music"));

    return (
        <main className="fallback-page">
            <div className="fallback-page__frame">
                <header className="fallback-page__header">
                    <div className="fallback-page__brand" aria-label="BakaMusic">
                        <SvgAsset iconName="logo" title="BakaMusic" />
                    </div>
                    <div className="fallback-page__mode">
                        <span aria-hidden="true" />
                        {t("fallback.recovery_mode")}
                    </div>
                </header>

                <section className="fallback-hero" aria-labelledby="fallback-title">
                    <div className="fallback-hero__signal" aria-hidden="true">
                        <SvgAsset iconName="code-bracket-square" size={34} />
                        <span>01</span>
                    </div>

                    <div className="fallback-hero__content" role="alert">
                        <p className="fallback-hero__eyebrow">
                            {t("fallback.eyebrow")}
                        </p>
                        <h1 id="fallback-title">{t("fallback.title")}</h1>
                        <p className="fallback-hero__lead">{t("fallback.lead")}</p>

                        <div className="fallback-hero__actions">
                            <button
                                type="button"
                                className="fallback-action fallback-action--primary"
                                onClick={resetErrorBoundary}
                            >
                                <SvgAsset iconName="arrow-path" size={18} />
                                <span>{t("fallback.reset")}</span>
                            </button>
                            <button
                                type="button"
                                className="fallback-action fallback-action--secondary"
                                onClick={() => shellUtil.openExternal(GITHUB_ISSUES_URL)}
                            >
                                <span>{t("fallback.github")}</span>
                                <span className="fallback-action__external" aria-hidden="true">
                                    ↗
                                </span>
                            </button>
                        </div>

                        <p className="fallback-hero__note">
                            {t("fallback.description")}
                        </p>
                    </div>
                </section>

                <section className="fallback-diagnostics" aria-labelledby="fallback-diagnostics-title">
                    <header className="fallback-diagnostics__header">
                        <div>
                            <p>{t("fallback.diagnostics_label")}</p>
                            <h2 id="fallback-diagnostics-title">
                                {t("fallback.diagnostics")}
                            </h2>
                        </div>
                        <p className="fallback-diagnostics__hint">
                            {t("fallback.diagnostics_hint")}
                        </p>
                    </header>

                    <div className="fallback-diagnostics__list">
                        <details className="fallback-diagnostic" open>
                            <summary>
                                <span className="fallback-diagnostic__index">01</span>
                                <span className="fallback-diagnostic__summary">
                                    <strong>{t("fallback.error_info")}</strong>
                                    <small>{normalizedError.message}</small>
                                </span>
                                <span className="fallback-diagnostic__toggle" aria-hidden="true" />
                            </summary>
                            <div className="fallback-diagnostic__body">
                                <p className="fallback-diagnostic__label">
                                    {t("fallback.error_summary")}
                                </p>
                                <pre>{normalizedError.message}</pre>
                                {normalizedError.stack && (
                                    <>
                                        <p className="fallback-diagnostic__label">
                                            {t("fallback.error_stack")}
                                        </p>
                                        <pre>{normalizedError.stack}</pre>
                                    </>
                                )}
                            </div>
                        </details>

                        <details className="fallback-diagnostic">
                            <summary>
                                <span className="fallback-diagnostic__index">02</span>
                                <span className="fallback-diagnostic__summary">
                                    <strong>{t("fallback.music_info")}</strong>
                                    <small>{musicSummary}</small>
                                </span>
                                <span className="fallback-diagnostic__toggle" aria-hidden="true" />
                            </summary>
                            <div className="fallback-diagnostic__body">
                                <pre>{musicInfo}</pre>
                            </div>
                        </details>
                    </div>
                </section>
            </div>
        </main>
    );
}
