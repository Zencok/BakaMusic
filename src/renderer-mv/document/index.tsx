import ReactDOM from "react-dom/client";
import { useCallback, useMemo } from "react";
import { Bounce, ToastContainer } from "react-toastify";
import AppConfig from "@shared/app-config/renderer";
import { setupI18n } from "@shared/i18n/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import mvOverlay from "@shared/mv-overlay/renderer-mv";
import MvPlayer from "@renderer/components/Modal/templates/MvPlayer";
import { applyUiStyle } from "@renderer/utils/ui-style";
import { toastDuration } from "@/common/constant";
import "react-toastify/dist/ReactToastify.css";
import "./index.scss";

interface IMvOverlayRootProps {
    session: Awaited<ReturnType<typeof mvOverlay.getSession>>;
}

function MvOverlayRoot({ session }: IMvOverlayRootProps) {
    const audioSession = useMemo(() => ({
        initialVolume: session.audio.volume,
        initialMuted: session.audio.muted,
        suspendForVideo: mvOverlay.suspendAudio,
        restoreAfterVideo: mvOverlay.restoreAudio,
    }), [session.audio.muted, session.audio.volume]);
    const close = useCallback(() => mvOverlay.close(), []);

    return (
        <>
            <MvPlayer
                musicItem={session.musicItem}
                audioSession={audioSession}
                onClose={close}
            ></MvPlayer>
            <ToastContainer
                draggable={false}
                closeOnClick={false}
                limit={3}
                pauseOnFocusLoss={false}
                hideProgressBar
                autoClose={toastDuration.short}
                newestOnTop
                transition={Bounce}
            ></ToastContainer>
        </>
    );
}

async function bootstrap() {
    const session = await mvOverlay.getSession();
    await Promise.all([
        AppConfig.setup(),
        setupI18n(),
    ]);
    await PluginManager.setup();
    applyUiStyle(AppConfig.getConfig("normal.uiStyle"));
    return session;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("MV overlay root element not found");
}
const root = ReactDOM.createRoot(rootElement);

void bootstrap().then((session) => {
    root.render(<MvOverlayRoot session={session}></MvOverlayRoot>);
}).catch((error: unknown) => {
    root.render(
        <div className="mv-overlay-error" role="alert">
            <strong>{error instanceof Error ? error.message : String(error)}</strong>
            <button type="button" onClick={() => mvOverlay.close()}>Close</button>
        </div>,
    );
});
