import { toast } from "react-toastify";
import SvgAsset from "@/renderer/components/SvgAsset";
import { useTranslation } from "react-i18next";
import ThemePack from "@/shared/themepack/renderer";
import ThemeItem from "../ThemeItem";

import "./index.scss";
import { dialogUtil } from "@shared/utils/renderer";
import { matchesThemeSearch } from "../../theme-search";

interface ILocalThemesProps {
    searchText: string;
}

export default function LocalThemes(props: ILocalThemesProps) {
    const { searchText } = props;
    const currentThemePack = ThemePack.useCurrentThemePack();
    const localThemePacks = ThemePack.useLocalThemePacks();

    const { t } = useTranslation();
    const normalizedSearch = searchText.trim();
    const validLocalThemePacks = localThemePacks
        .filter((it): it is ICommon.IThemePack => !!it)
        .filter((it) => matchesThemeSearch(it, normalizedSearch));
    const defaultThemePack = ThemePack.createBuiltinDefaultThemePack(t("common.default"));
    const showDefaultTheme = matchesThemeSearch(defaultThemePack, normalizedSearch);
    const hasSearchResults = validLocalThemePacks.length > 0 || showDefaultTheme;

    return (
        <div className="local-themes-container">
            <div className="local-themes-inner-container">
                <div className="theme-item-container" hidden={Boolean(normalizedSearch)}>
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
                                        if (!themePackConfig) {
                                            continue;
                                        }
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

                {validLocalThemePacks.map((it) => (
                    <ThemeItem
                        config={it}
                        hash={it.hash}
                        key={it.path}
                        type="local"
                        selected={it.hash === currentThemePack?.hash}
                    ></ThemeItem>
                ))}
                {showDefaultTheme ? (
                    <ThemeItem
                        config={defaultThemePack}
                        hash={ThemePack.BUILTIN_DEFAULT_THEME_HASH}
                        type="local"
                        selected={ThemePack.isBuiltinDefaultTheme(currentThemePack)}
                    ></ThemeItem>
                ) : null}
                {normalizedSearch && !hasSearchResults ? (
                    <div className="theme-search-empty">
                        <SvgAsset iconName="magnifying-glass"></SvgAsset>
                        <span>{t("theme.no_search_result")}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
