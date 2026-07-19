import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import ColorInputSettingItem from "../../components/ColorInputSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import SliderSettingItem from "../../components/SliderSettingItem";
import FontPickerSettingItem from "../../components/FontPickerSettingItem";
import SettingGroup from "../../components/SettingGroup";
import { IfTruthy } from "@/renderer/components/Condition";
import { useTranslation } from "react-i18next";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { appWindowUtil } from "@shared/utils/renderer";
import AppConfig from "@shared/app-config/renderer";
import defaultAppConfig from "@shared/app-config/default-app-config";
import { toast } from "react-toastify";

const numberArray = Array(65)
    .fill(0)
    .map((_, index) => 16 + index);

export default function Lyric() {
    const { t } = useTranslation();

    const handleResetLyricConfig = () => {
        AppConfig.setConfig({
            "lyric.lockLyric": defaultAppConfig["lyric.lockLyric"],
            "lyric.showRomanization": defaultAppConfig["lyric.showRomanization"],
            "lyric.fontData": defaultAppConfig["lyric.fontData"],
            "lyric.fontSize": defaultAppConfig["lyric.fontSize"],
            "lyric.fontColor": defaultAppConfig["lyric.fontColor"],
            "lyric.applyFontColorOnlyToPlayedLines": defaultAppConfig["lyric.applyFontColorOnlyToPlayedLines"],
            "lyric.inactiveBrightness": defaultAppConfig["lyric.inactiveBrightness"],
            "private.lyricWindowSize": defaultAppConfig["private.lyricWindowSize"],
        });
        toast.success(t("settings.lyric.reset_success"));
    };

    return (
        <div className="setting-view--lyric-container">
            <SettingGroup
                title={t("settings.group.lyric_window")}
                description={t("settings.group.lyric_window_desc")}
            >
                <IfTruthy condition={getGlobalContext().platform === "darwin"}>
                    <CheckBoxSettingItem
                        label={t("settings.lyric.enable_status_bar_lyric")}
                        keyPath="lyric.enableStatusBarLyric"
                    ></CheckBoxSettingItem>
                </IfTruthy>
                <CheckBoxSettingItem
                    label={t("settings.lyric.enable_desktop_lyric")}
                    keyPath="lyric.enableDesktopLyric"
                    onChange={(_evt, checked) => {
                        appWindowUtil.setLyricWindow(checked);
                    }}
                ></CheckBoxSettingItem>
                <CheckBoxSettingItem
                    label={t("settings.lyric.lock_desktop_lyric")}
                    keyPath="lyric.lockLyric"
                ></CheckBoxSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.lyric_style")}
                description={t("settings.group.lyric_style_desc")}
            >
                <CheckBoxSettingItem
                    label={t("settings.lyric.show_romanization")}
                    keyPath="lyric.showRomanization"
                ></CheckBoxSettingItem>
                <FontPickerSettingItem
                    label={t("settings.lyric.font")}
                    keyPath="lyric.fontData"
                ></FontPickerSettingItem>
                <ListBoxSettingItem
                    keyPath="lyric.fontSize"
                    options={numberArray}
                    label={t("settings.lyric.font_size")}
                ></ListBoxSettingItem>
                <ColorInputSettingItem
                    label={t("settings.lyric.font_color")}
                    keyPath="lyric.fontColor"
                ></ColorInputSettingItem>
                <CheckBoxSettingItem
                    label={t("settings.lyric.apply_font_color_only_to_played_lines")}
                    keyPath="lyric.applyFontColorOnlyToPlayedLines"
                ></CheckBoxSettingItem>
                <SliderSettingItem
                    keyPath="lyric.inactiveBrightness"
                    min={0.2}
                    max={0.7}
                    step="any"
                    renderValue={(value) => `${Math.round(value * 100)}%`}
                    label={t("settings.lyric.inactive_brightness")}
                ></SliderSettingItem>
            </SettingGroup>

            <SettingGroup title={t("settings.group.lyric_reset")}>
                <div className="setting-row setting-action-row">
                    <div className="setting-action-hint">
                        {t("settings.group.lyric_reset_desc")}
                    </div>
                    <div
                        role="button"
                        data-type="normalButton"
                        onClick={handleResetLyricConfig}
                    >
                        {t("settings.lyric.reset_to_default")}
                    </div>
                </div>
            </SettingGroup>
        </div>
    );
}
