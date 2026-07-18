import ReactDOM from "react-dom/client";
import { useEffect, useState, type ComponentType, type CSSProperties } from "react";

const STARTUP_CONTAINER_STYLE: CSSProperties = {
    alignItems: "center",
    background: "#18181b",
    color: "#f4f4f5",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, sans-serif",
    gap: 12,
    height: "100vh",
    justifyContent: "center",
    textAlign: "center",
    width: "100vw",
};

const RETRY_BUTTON_STYLE: CSSProperties = {
    background: "#0a95ff",
    border: 0,
    borderRadius: 8,
    color: "#fff",
    cursor: "pointer",
    padding: "8px 18px",
};

const DEFAULT_STARTUP_COPY = {
    failed: "BakaMusic failed to start",
    loading: "Starting…",
    reload: "Reload",
};

function StartupShell() {
    const [RuntimeRoot, setRuntimeRoot] = useState<ComponentType | null>(null);
    const [startupError, setStartupError] = useState<Error | null>(null);
    const [startupCopy, setStartupCopy] = useState(DEFAULT_STARTUP_COPY);

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
        };
    }, []);

    if (RuntimeRoot) {
        return <RuntimeRoot></RuntimeRoot>;
    }

    if (startupError) {
        return (
            <div style={STARTUP_CONTAINER_STYLE} role="alert">
                <strong>{startupCopy.failed}</strong>
                <span>{startupError.message}</span>
                <button
                    type="button"
                    style={RETRY_BUTTON_STYLE}
                    onClick={() => window.location.reload()}
                >
                    {startupCopy.reload}
                </button>
            </div>
        );
    }

    return (
        <div style={STARTUP_CONTAINER_STYLE} aria-busy="true" aria-live="polite">
            <strong>BakaMusic</strong>
            <span>{startupCopy.loading}</span>
        </div>
    );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(<StartupShell></StartupShell>);
