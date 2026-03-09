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
                {t("settings.about.original_author")}{" "}
                <A href="https://github.com/maotoumao">Github@maotoumao</A>
            </div>

            <div className="setting-row about-version">
                {t("settings.about.current_author")}{" "}
                <A href="https://github.com/Zencok">Github@Zencok</A>
            </div>

            <div className="setting-row about-version">
                当前项目：
                <A href="https://github.com/Zencok/BakaMusic">
                    BakaMusic
                </A>
                <span>（独立维护版本）</span>
            </div>

            <div className="setting-row about-version">
                原始桌面项目：
                <A href="https://github.com/maotoumao/MusicFreeDesktop">
                    MusicFreeDesktop
                </A>
            </div>

            <div className="setting-row about-version">
                原始安卓项目：
                <A href="https://github.com/maotoumao/MusicFree">MusicFree</A>
            </div>
        </div>
    );
}
