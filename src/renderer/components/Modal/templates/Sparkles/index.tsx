import A from "@/renderer/components/A";
import Base from "../Base";
import "./index.scss";
import { Trans, useTranslation } from "react-i18next";

export default function Sparkles() {
    const { t } = useTranslation();
    return (
        <Base withBlur defaultClose>
            <div className="modal--sparkles-container shadow backdrop-color">
                <Base.Header>✨✨✨{t("modal.sparkles_title")}</Base.Header>
                <div className="modal--body-container">
                    <p>
                        <Trans i18nKey="modal.sparkles_thanks" components={{ product: <strong></strong> }}></Trans>
                    </p>

                    <p>
                        <Trans i18nKey="modal.sparkles_intro" components={{ maintainer: <strong></strong> }}></Trans>
                    </p>

                    <p>
                        {t("modal.sparkles_future")}
                    </p>

                    <p>
                        {t("modal.sparkles_feedback")}
                    </p>

                    <p>
                        {t("modal.sparkles_repo")}：
                        <A href="https://github.com/Zencok/BakaMusic">
                            BakaMusic
                        </A>
                    </p>

                    <p className="footer">by: Zencok</p>

                    <div className="secret">
                        {t("modal.sparkles_secret")}
                    </div>
                </div>
            </div>
        </Base>
    );
}
