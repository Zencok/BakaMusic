import A from "@/renderer/components/A";
import checkUpdate from "@/renderer/utils/check-update";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import "./index.scss";

export default function About() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--about-container">
            <div className="setting-row about-version">
                <Trans
                    i18nKey={"settings.about.current_version"}
                    values={{
                        version: getGlobalContext().appVersion,
                    }}
                ></Trans>
                <A
                    onClick={async () => {
                        const needUpdate = await checkUpdate(true);
                        if (!needUpdate) {
                            toast.success(t("settings.about.already_latest"));
                        }
                    }}
                >
                    {t("settings.about.check_update")}
                </A>
            </div>

            <div className="setting-row about-version">
                {t("settings.about.current_project")}
                <A href="https://github.com/Zencok/BakaMusic">
                    BakaMusic@Zencok
                </A>
            </div>

            <div className="setting-row about-version">
                {t("settings.about.reference_project")}
                <A href="https://github.com/maotoumao/MusicFreeDesktop">
                    MusicFreeDesktop@maotoumao
                </A>
            </div>

            <div className="setting-row about-version">
                {t("settings.about.qq_group")}
                <A href="https://qm.qq.com/q/VNyG9RoygE">
                    {t("settings.about.qq_group_name")}
                </A>
            </div>

            <div className="setting-row about-version">
                {t("settings.about.telegram_group")}
                <A href="https://t.me/mvscute">
                    {t("settings.about.telegram_group_name")}
                </A>
            </div>
        </div>
    );
}
