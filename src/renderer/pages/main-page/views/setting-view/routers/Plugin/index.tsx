import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import SettingGroup from "../../components/SettingGroup";
import { useTranslation } from "react-i18next";

export default function Plugin() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--plugin-container">
            <SettingGroup
                title={t("settings.group.plugin_updates")}
                description={t("settings.group.plugin_updates_desc")}
            >
                <CheckBoxSettingItem
                    keyPath="plugin.autoUpdatePlugin"
                    label={t("settings.plugin.auto_update_plugin")}
                ></CheckBoxSettingItem>
                <CheckBoxSettingItem
                    label={t("settings.plugin.not_check_plugin_version")}
                    keyPath="plugin.notCheckPluginVersion"
                ></CheckBoxSettingItem>
            </SettingGroup>
        </div>
    );
}
