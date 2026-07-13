import "./index.scss";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";
import { useTranslation } from "react-i18next";
import type { UiStyle } from "@renderer/utils/ui-style";
import { applyUiStyle } from "@renderer/utils/ui-style";

const OPTIONS: UiStyle[] = ["glass", "flat"];

export default function UiStyleSettingItem() {
    const { t } = useTranslation();
    const value = (useAppConfig("normal.uiStyle") || "glass") as UiStyle;

    const select = (style: UiStyle) => {
        AppConfig.setConfig({
            "normal.uiStyle": style,
        });
        applyUiStyle(style);
    };

    return (
        <div className="setting-view--ui-style-block setting-row">
            <span className="setting-view--ui-style-label">
                {t("settings.normal.ui_style")}
            </span>
            <div className="setting-view--ui-style-picker" role="radiogroup" aria-label={t("settings.normal.ui_style")}>
                {OPTIONS.map((style) => {
                    const selected = value === style;
                    return (
                        <button
                            key={style}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className="setting-view--ui-style-card"
                            data-selected={selected ? "true" : "false"}
                            data-style={style}
                            onClick={() => select(style)}
                        >
                            <div
                                className={`setting-view--ui-style-preview ui-style-preview--${style}`}
                            >
                                <span className="ui-style-preview-bar"></span>
                            </div>
                            <div className="setting-view--ui-style-preview-title">
                                {t(`settings.normal.ui_style_${style}`)}
                            </div>
                            <div className="setting-view--ui-style-preview-desc">
                                {t(`settings.normal.ui_style_${style}_desc`)}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
