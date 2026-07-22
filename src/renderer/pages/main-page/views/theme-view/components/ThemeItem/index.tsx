import { useTranslation } from "react-i18next";
import "./index.scss";
import { If, IfTruthy } from "@/renderer/components/Condition";
import { useState } from "react";
import Themepack from "@/shared/themepack/renderer";
import { toast } from "react-toastify";
import Loading from "@/renderer/components/Loading";
import { toError } from "@/common/error-util";

interface IProps {
    config: ICommon.IThemePack;
    hash?: string;
    type: "remote" | "local";
    selected?: boolean;
    /**[Remote Only] 主题的最新版是否已经在本地安�?*/
    latestInstalled?: boolean;
    /**[Remote Only] 主题是否已经在本地安�?*/
    installed?: boolean;
}

export default function ThemeItem(props: IProps) {
    const { config, type, selected, latestInstalled, installed, hash } = props;

    const [isHover, setIsHover] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const { t } = useTranslation();
    const themeName = config.name || t("common.default");
    const themePreview = config.preview?.trim();

    const selectTheme = async () => {
        try {
            if (type === "local") {
                if (!Themepack.isThemeSpecV2(config)) {
                    throw new Error(t("theme.unsupported_theme_spec"));
                }
                await Themepack.selectTheme(config);
            } else {
                if (latestInstalled && hash) {
                    await Themepack.selectThemeByHash(hash);
                } else if (config.srcUrl && config.id) {
                    setIsLoading(true);
                    const themePack = await Themepack.installRemoteThemePack(
                        config.srcUrl,
                        config.id,
                    );
                    if (!Themepack.isThemeSpecV2(themePack)) {
                        throw new Error(t("theme.unsupported_theme_spec"));
                    }
                    await Themepack.selectTheme(themePack);
                } else {
                    throw new Error("Invalid remote theme config");
                }
            }
        } catch (e) {
            toast.error(
                t("theme.invalid_theme", {
                    reason: toError(e).message,
                }),
            );
        }
        setIsLoading(false);
    };

    return (
        <div
            className="theme-item-container"
            onMouseEnter={() => {
                setIsHover(true);
            }}
            onMouseLeave={() => {
                setIsHover(false);
            }}
        >
            <div className="theme-thumb-container">
                {themePreview?.startsWith("#") ? (
                    <div
                        className="theme-thumb"
                        style={{
                            backgroundColor: themePreview,
                        }}
                    ></div>
                ) : themePreview ? (
                    <img src={themePreview} className="theme-thumb" alt={config.name}></img>
                ) : (
                    <div className="theme-thumb"></div>
                )}
                <IfTruthy condition={selected}>
                    <div className="theme-selected"></div>
                </IfTruthy>
                <div className="theme-options-mask" data-show={isHover || isLoading}>
                    {isLoading ? (
                        <div className="theme-downloading">
                            <Loading text={t("common.downloading")}></Loading>
                        </div>
                    ) : (
                        <If condition={type === "remote"}>
                            <If.Truthy>
                                <div
                                    className="theme-option-button"
                                    role="button"
                                    onClick={selectTheme}
                                >
                                    {latestInstalled
                                        ? t("theme.use_theme")
                                        : installed
                                            ? t("theme.update_theme")
                                            : t("theme.download_and_use")}
                                </div>
                            </If.Truthy>
                            <If.Falsy>
                                <div
                                    className="theme-option-button"
                                    role="button"
                                    onClick={selectTheme}
                                >
                                    {t("theme.use_theme")}
                                </div>
                                {hash && !Themepack.isBuiltinDefaultTheme(config) && (
                                    <div
                                        className="theme-option-button"
                                        role="button"
                                        onClick={() => {
                                            Themepack.uninstallThemePack(config);
                                        }}
                                    >
                                        {t("common.uninstall")}
                                    </div>
                                )}
                            </If.Falsy>
                        </If>
                    )}
                </div>
            </div>

            <div className="theme-meta">
                <div
                    className="theme-name"
                    title={config.description || themeName}
                    onClick={selectTheme}
                >
                    {themeName}
                </div>
                <div
                    className={config.author ? "theme-author" : "theme-author theme-author-placeholder"}
                    aria-hidden={!config.author}
                >
                    {config.author
                        ? `${t("media.media_type_artist")}: ${config.author}`
                        : "\u00A0"}
                </div>
            </div>
        </div>
    );
}
