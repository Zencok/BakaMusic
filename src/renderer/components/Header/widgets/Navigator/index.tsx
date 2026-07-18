import SvgAsset from "@/renderer/components/SvgAsset";
import "./index.scss";
import { useNavigate } from "react-router-dom";
import MusicDetail, { isMusicDetailShown } from "@/renderer/components/MusicDetail";
import { useTranslation } from "react-i18next";

export default function HeaderNavigator() {
    const navigate = useNavigate();
    const canBack = history.state.idx > 0;
    const canGo = history.state.idx < history.length - 1;

    const { t } = useTranslation();


    return (
        <div className="header-navigator">
            <button
                type="button"
                className="navigator-btn"
                data-disabled={!canBack}
                disabled={!canBack}
                title={canBack ? t("app_header.nav_back") : undefined}
                aria-label={t("app_header.nav_back")}
                onClick={() => {
                    if (isMusicDetailShown()) {
                        MusicDetail.hide();
                    } else {
                        navigate(-1);
                    }
                }}
            >
                <SvgAsset iconName="chevron-left"></SvgAsset>
            </button>
            <button
                type="button"
                className="navigator-btn"
                data-disabled={!canGo}
                disabled={!canGo}
                title={canGo ? t("app_header.nav_forward") : undefined}
                aria-label={t("app_header.nav_forward")}
                onClick={() => {
                    if (isMusicDetailShown()) {
                        MusicDetail.hide();
                    } else {
                        navigate(1);
                    }
                }}
            >
                <SvgAsset iconName="chevron-right"></SvgAsset>
            </button>
        </div>
    );
}
