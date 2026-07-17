import { hideModal, showModal } from "../..";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import PluginManager from "@shared/plugin-manager/renderer";
import PluginInputPanel from "../PluginInputPanel";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

export default function ImportMusicSheet(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();

    return (
        <PluginInputPanel
            availablePluginText={t("plugin.input_panel_available_plugins", {
                count: plugins.length,
            })}
            cancelText={t("common.cancel")}
            description={t("plugin.import_music_sheet_description")}
            emptySupportMethod={t("plugin.method_import_music_sheet")}
            errorText={t("plugin_management_page.import_failed")}
            hintMethod="importMusicSheet"
            hintTitle={t("plugin.input_panel_hints")}
            hints={(plugin) => [t("plugin.import_music_sheet_hint", {
                plugin: plugin.platform,
            })]}
            iconName="playlist"
            inputLabel={t("plugin.import_music_sheet_input_label")}
            loadingText={t("plugin_management_page.importing_media")}
            maxLength={1000}
            placeholder={(plugin) => t(
                "plugin_management_page.placeholder_import_music_sheet",
                { plugin: plugin.platform },
            )}
            plugins={plugins}
            selectLabel={t("plugin_management_page.choose_plugin")}
            selectedPluginLabel={t("plugin.input_panel_selected_plugin")}
            submitText={t("plugin.import_music_sheet_submit")}
            title={t("plugin.method_import_music_sheet")}
            variant="import-music-sheet"
            onSubmit={async (plugin, input) => {
                const result = await PluginManager.callPluginDelegateMethod(
                    plugin,
                    "importMusicSheet",
                    input,
                );
                if (!Array.isArray(result) || !result.length) {
                    toast.warn(t("plugin.import_music_sheet_empty"));
                    return;
                }

                hideModal();
                showModal("AddMusicToSheet", {
                    musicItems: result as IMusic.IMusicItem[],
                });
            }}
        ></PluginInputPanel>
    );
}
