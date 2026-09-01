import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import SettingGroup from "../../components/SettingGroup";
import useAppConfig from "@/hooks/useAppConfig";
import { useTranslation } from "react-i18next";
import SourcePrioritySetting from "../../components/SourcePrioritySetting";

export default function Plugin() {
    const { t } = useTranslation();
    const enableFallback = useAppConfig("plugin.enableSourceFallback") ?? true;

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
            <SettingGroup
                title={t("settings.group.plugin_source_priority")}
                description={t("settings.group.plugin_source_priority_desc")}
            >
                <CheckBoxSettingItem
                    keyPath="plugin.enableSourceFallback"
                    label={t("settings.plugin.enable_source_priority")}
                    description={t("settings.plugin.source_priority_hint")}
                ></CheckBoxSettingItem>
                <div className="setting-collapse" data-open={String(enableFallback)}>
                    <div className="setting-collapse--inner">
                        <div className="setting-row">
                            <div className="label-container">
                                {t("settings.plugin.source_priority_setting")}
                            </div>
                            <SourcePrioritySetting></SourcePrioritySetting>
                        </div>
                    </div>
                </div>
            </SettingGroup>
        </div>
    );
}
