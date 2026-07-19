import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import MultiRadioGroupSettingItem from "../../components/MultiRadioGroupSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import UiStyleSettingItem from "../../components/UiStyleSettingItem";
import SettingGroup from "../../components/SettingGroup";

import { changeLang, getLangList } from "@/shared/i18n/renderer";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { getGlobalContext } from "@/shared/global-context/renderer";

/** Appearance & general interaction preferences (formerly Normal). */
export default function Appearance() {
    const { t } = useTranslation();
    const allLangs = getLangList();

    return (
        <div className="setting-view--appearance-container">
            <SettingGroup
                title={t("settings.group.interface")}
                description={t("settings.group.interface_desc")}
            >
                <UiStyleSettingItem></UiStyleSettingItem>
                <ListBoxSettingItem
                    label={t("settings.normal.languages")}
                    keyPath="normal.language"
                    width={"240px"}
                    onChange={async (evt, lang) => {
                        evt.preventDefault();
                        if (!lang) {
                            return;
                        }
                        const success = await changeLang(lang);
                        if (!success) {
                            toast.warning(t("settings.normal.toast_switch_language_fail"));
                        }
                    }}
                    options={allLangs}
                ></ListBoxSettingItem>
                <CheckBoxSettingItem
                    label={t("settings.normal.detail_auto_hide_music_bar")}
                    keyPath="normal.detailAutoHideMusicBar"
                ></CheckBoxSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.window")}
                description={t("settings.group.window_desc")}
            >
                <RadioGroupSettingItem
                    label={t("settings.normal.close_behavior")}
                    keyPath="normal.closeBehavior"
                    options={[
                        "exit_app",
                        "minimize",
                    ]}
                    renderItem={(item) => t("settings.normal." + item)}
                ></RadioGroupSettingItem>
                {getGlobalContext().platform === "win32" ? (
                    <RadioGroupSettingItem
                        label={t("settings.normal.taskbar_thumb")}
                        keyPath="normal.taskbarThumb"
                        options={[
                            "artwork",
                            "window",
                        ]}
                        renderItem={(item) => {
                            if (item === "artwork") {
                                return t("settings.normal.current_artwork");
                            }
                            return t("settings.normal.main_window");
                        }}
                    ></RadioGroupSettingItem>
                ) : null}
                <CheckBoxSettingItem
                    label={t("settings.normal.check_update")}
                    keyPath="normal.checkUpdate"
                ></CheckBoxSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.lists")}
                description={t("settings.group.lists_desc")}
            >
                <CheckBoxSettingItem
                    label={t("settings.normal.auto_load_more")}
                    keyPath="normal.autoLoadMore"
                ></CheckBoxSettingItem>
                <RadioGroupSettingItem
                    label={t("settings.normal.max_history_length")}
                    keyPath="normal.maxHistoryLength"
                    options={[15, 30, 50, 100, 200]}
                ></RadioGroupSettingItem>
                <MultiRadioGroupSettingItem
                    label={t("settings.normal.music_list_hide_columns")}
                    keyPath="normal.musicListColumnsShown"
                    options={[
                        "duration",
                        "platform",
                    ]}
                    renderItem={(item) => t("media.media_" + item)}
                ></MultiRadioGroupSettingItem>
            </SettingGroup>
        </div>
    );
}
