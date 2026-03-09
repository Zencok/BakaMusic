import { toast } from "react-toastify";
import SvgAsset from "@/renderer/components/SvgAsset";
import { useTranslation } from "react-i18next";
import ThemePack from "@/shared/themepack/renderer";
import ThemeItem from "../ThemeItem";

import "./index.scss";
import { dialogUtil } from "@shared/utils/renderer";

export default function LocalThemes() {
    const currentThemePack = ThemePack.useCurrentThemePack();
    const localThemePacks = ThemePack.useLocalThemePacks();

    const { t } = useTranslation();

    return (
        <div className="local-themes-container">
            <div className="local-themes-inner-container">
                <div className="theme-item-container">
                    <div
                        title={t("theme.install_theme")}
                        className="theme-thumb-container theme-install-local"
                        onClick={async () => {
                            try {
                                const result = await dialogUtil.showOpenDialog({
                                    title: t("theme.install_theme"),
                                    buttonLabel: t("common.install"),
                                    filters: [
                                        {
                                            name: t("theme.bakamusic_theme"),
                                            extensions: ["mftheme", "zip"],
                                        },
                                        {
                                            name: t("theme.all_files"),
                                            extensions: ["*"],
                                        },
                                    ],
                                    properties: ["openFile", "multiSelections"],
                                });

                                if (!result.canceled) {
                                    const themePackPaths = result.filePaths;
                                    for (const themePackPath of themePackPaths) {
                                        const themePackConfig = await ThemePack.installThemePack(
                                            themePackPath,
                                        );
                                        toast.success(
                                            t("theme.install_theme_success", {
                                                name: themePackConfig.name
                                                    ? `《${themePackConfig.name}》`
                                                    : "",
                                            }),
                                        );
                                    }
                                }
                            } catch (e) {
                                toast.warn(
                                    t("theme.install_theme_fail", {
                                        reason:
                                            e instanceof Error && e.message
                                                ? `《${e.message}》`
                                                : "",
                                    }),
                                );
                            }
                        }}
                    >
                        <SvgAsset iconName="plus"></SvgAsset>
                    </div>

                    <div className="theme-meta" aria-hidden>
                        <div className="theme-name theme-name-placeholder">&nbsp;</div>
                        <div className="theme-author theme-author-placeholder">&nbsp;</div>
                    </div>
                </div>

                {localThemePacks.map((it) => (
                    <ThemeItem
                        config={it}
                        hash={it.hash}
                        key={it.path}
                        type="local"
                        selected={it.hash === currentThemePack?.hash}
                    ></ThemeItem>
                ))}
                <ThemeItem
                    config={
                        {
                            name: t("common.default"),
                            preview: "#f17d34",
                        } as any
                    }
                    type="local"
                    selected={!currentThemePack}
                ></ThemeItem>
            </div>
        </div>
    );
}
