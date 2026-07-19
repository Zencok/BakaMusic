import ReactDOM from "react-dom/client";
import { useEffect, useRef, useState, type ComponentType } from "react";

import "./startup-shell.scss";

const DEFAULT_STARTUP_COPY = {
    failed: "BakaMusic failed to start",
    loading: "Starting…",
    reload: "Reload",
    tagline: "A clear space for your music",
};

function StartupShell() {
    const [RuntimeRoot, setRuntimeRoot] = useState<ComponentType | null>(null);
    const [startupError, setStartupError] = useState<Error | null>(null);
    const [startupCopy, setStartupCopy] = useState(DEFAULT_STARTUP_COPY);
    const [startupVisible, setStartupVisible] = useState(true);
    const dismissTimerRef = useRef<number | null>(null);

    useEffect(() => {
        let active = true;
        void import("@shared/i18n/renderer")
            .then(async ({ i18n, setupI18n }) => {
                await setupI18n();
                if (active) {
                    setStartupCopy({
                        failed: i18n.t("startup.failed"),
                        loading: i18n.t("startup.loading"),
                        reload: i18n.t("startup.reload"),
                        tagline: i18n.t("startup.tagline"),
                    });
                }
            })
            .catch(() => undefined);
        const bootstrapPromise = import("./bootstrap")
            .then((module) => module.default());
        const runtimeRootPromise = import("./runtime-root");

        Promise.all([bootstrapPromise, runtimeRootPromise])
            .then(([, runtimeRootModule]) => {
                if (!active) {
                    return;
                }
                runtimeRootModule.markBootstrapReady();
                setRuntimeRoot(() => runtimeRootModule.default);
                dismissTimerRef.current = window.setTimeout(() => {
                    setStartupVisible(false);
                }, 220);
            })
            .catch((error: unknown) => {
                if (active) {
                    setStartupError(
                        error instanceof Error ? error : new Error(String(error)),
                    );
                }
            });

        return () => {
            active = false;
            if (dismissTimerRef.current !== null) {
                window.clearTimeout(dismissTimerRef.current);
            }
        };
    }, []);

    return (
        <>
            {RuntimeRoot ? <RuntimeRoot></RuntimeRoot> : null}
            {startupVisible ? (
                <div
                    className="startup-shell"
                    data-state={RuntimeRoot ? "leaving" : startupError ? "error" : "loading"}
                    role={startupError ? "alert" : undefined}
                    aria-busy={!startupError}
                    aria-live="polite"
                >
                    <div className="startup-shell__glow startup-shell__glow--one"></div>
                    <div className="startup-shell__glow startup-shell__glow--two"></div>
                    <div className="startup-shell__content">
                        <div className="startup-shell__brand" aria-label="BakaMusic">
                            <div className="startup-shell__mark" aria-hidden="true">
                                <svg viewBox="0 0 64 64" focusable="false">
                                    <circle cx="30" cy="34" r="21" className="startup-shell__record"></circle>
                                    <circle cx="30" cy="34" r="14" className="startup-shell__groove"></circle>
                                    <circle cx="30" cy="34" r="5" className="startup-shell__center"></circle>
                                    <path d="M45 10c4 8 3 15-3 21l-7 7" className="startup-shell__arm"></path>
                                    <circle cx="45" cy="10" r="3" className="startup-shell__pivot"></circle>
                                    <path d="m34 38 3 2-4 3Z" className="startup-shell__needle"></path>
                                </svg>
                            </div>
                            <div>
                                <span className="startup-shell__name">BakaMusic</span>
                                <span className="startup-shell__tagline">{startupCopy.tagline}</span>
                            </div>
                        </div>

                        {startupError ? (
                            <div className="startup-shell__error">
                                <strong>{startupCopy.failed}</strong>
                                <span>{startupError.message}</span>
                                <button type="button" onClick={() => window.location.reload()}>
                                    {startupCopy.reload}
                                </button>
                            </div>
                        ) : (
                            <div className="startup-shell__status">
                                <div className="startup-shell__status-line">
                                    <span>{startupCopy.loading}</span>
                                    <span className="startup-shell__dots" aria-hidden="true">
                                        <i></i><i></i><i></i>
                                    </span>
                                </div>
                                <div className="startup-shell__progress" aria-hidden="true">
                                    <span></span>
                                </div>
                            </div>
                        )}
                    </div>
                    <span className="startup-shell__footer">LOCAL MUSIC · PLUGINS · YOUR WAY</span>
                </div>
            ) : null}
        </>
    );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(<StartupShell></StartupShell>);
