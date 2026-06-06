import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import "./index.scss";
import ColorInputSettingItem from "../../components/ColorInputSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import FontPickerSettingItem from "../../components/FontPickerSettingItem";
import { IfTruthy } from "@/renderer/components/Condition";
import { useTranslation } from "react-i18next";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { appWindowUtil } from "@shared/utils/renderer";

const numberArray = Array(65)
    .fill(0)
    .map((_, index) => 16 + index);

export default function Lyric() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--lyric-container">
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
        </div>
    );
}
