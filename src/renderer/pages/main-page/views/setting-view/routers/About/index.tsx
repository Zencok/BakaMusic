import A from "@/renderer/components/A";
import checkUpdate from "@/renderer/utils/check-update";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import SvgAsset, { type SvgAssetIconNames } from "@renderer/components/SvgAsset";
import SettingGroup from "../../components/SettingGroup";
import "./index.scss";

interface IAboutLinkProps {
    iconName: SvgAssetIconNames;
    href?: string;
    onClick?: () => void | Promise<void>;
    children: React.ReactNode;
}

function AboutLink(props: IAboutLinkProps) {
    const {
        iconName,
        href,
        onClick,
        children,
    } = props;

    return (
        <A
            className="about-link-chip"
            href={href}
            onClick={() => {
                void onClick?.();
            }}
        >
            <SvgAsset iconName={iconName}></SvgAsset>
            <span>{children}</span>
        </A>
    );
}

interface IAboutInfoRowProps {
    label: React.ReactNode;
    children: React.ReactNode;
}

function AboutInfoRow(props: IAboutInfoRowProps) {
    const {
        label,
        children,
    } = props;

    return (
        <div className="setting-row about-info-row">
            <div className="about-info-label">{label}</div>
            <div className="about-info-content">{children}</div>
        </div>
    );
}

export default function About() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--about-container">
            <SettingGroup title={t("settings.group.about_version")}>
                <AboutInfoRow
                    label={
                        <Trans
                            i18nKey={"settings.about.current_version"}
                            values={{
                                version: getGlobalContext().appVersion,
                            }}
                        ></Trans>
                    }
                >
                    <AboutLink
                        iconName="arrow-path"
                        onClick={async () => {
                            const needUpdate = await checkUpdate(true);
                            if (!needUpdate) {
                                toast.success(t("settings.about.already_latest"));
                            }
                        }}
                    >
                        {t("settings.about.check_update")}
                    </AboutLink>
                </AboutInfoRow>
            </SettingGroup>

            <SettingGroup title={t("settings.group.about_links")}>
                <AboutInfoRow label={t("settings.about.current_project")}>
                    <AboutLink
                        iconName="logo"
                        href="https://github.com/Zencok/BakaMusic"
                    >
                        BakaMusic@Zencok
                    </AboutLink>
                </AboutInfoRow>

                <AboutInfoRow label={t("settings.about.reference_project")}>
                    <AboutLink
                        iconName="code-bracket-square"
                        href="https://github.com/maotoumao/MusicFreeDesktop"
                    >
                        MusicFreeDesktop@maotoumao
                    </AboutLink>
                </AboutInfoRow>
            </SettingGroup>

            <SettingGroup title={t("settings.group.about_community")}>
                <AboutInfoRow label={t("settings.about.qq_group")}>
                    <AboutLink
                        iconName="chat-bubble-left-ellipsis"
                        href="https://qm.qq.com/q/VNyG9RoygE"
                    >
                        {t("settings.about.qq_group_name")}
                    </AboutLink>
                </AboutInfoRow>

                <AboutInfoRow label={t("settings.about.telegram_group")}>
                    <AboutLink
                        iconName="chat-bubble-left-ellipsis"
                        href="https://t.me/mvscute"
                    >
                        {t("settings.about.telegram_group_name")}
                    </AboutLink>
                </AboutInfoRow>
            </SettingGroup>
        </div>
    );
}
