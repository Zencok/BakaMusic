import { hideModal } from "../..";
import { useTranslation } from "react-i18next";
import trackPlayer from "@renderer/core/track-player";
import { toast } from "react-toastify";
import {
    getUserPreference,
    setUserPreference,
} from "@/renderer/utils/user-perference";
import PluginInputPanel from "../PluginInputPanel";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

function rememberPlayByIdPlugin(plugin: IPlugin.IPluginDelegate) {
    if (!plugin?.hash) {
        return;
    }
    setUserPreference("playByIdPluginHash", plugin.hash);
}

export default function PlayMusicById(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();
    const rememberedPluginHash = getUserPreference("playByIdPluginHash");

    return (
        <PluginInputPanel
            availablePluginText={t("plugin.input_panel_available_plugins", {
                count: plugins.length,
            })}
            cancelText={t("common.cancel")}
            description={t("plugin.play_by_id_description")}
            emptySupportMethod={t("plugin.method_play_by_id")}
            errorText={t("plugin.play_by_id_failed")}
            hintMethod="getMusicInfo"
            hintTitle={t("plugin.input_panel_hints")}
            hints={(plugin) => [
                t("plugin.play_by_id_hint"),
                ...(plugin.platform.toLocaleLowerCase().startsWith("qq")
                    ? [t("plugin.play_by_id_qq_hint")]
                    : []),
            ]}
            iconName="identification"
            initialPluginHash={rememberedPluginHash}
            inputLabel={t("plugin.play_by_id_input_label")}
            loadingText={t("plugin.play_by_id_loading")}
            maxLength={200}
            placeholder={() => t("plugin.play_by_id_placeholder")}
            plugins={plugins}
            selectLabel={t("plugin_management_page.choose_plugin")}
            selectedPluginLabel={t("plugin.input_panel_selected_plugin")}
            submitText={t("plugin.play_by_id_submit")}
            title={t("plugin.method_play_by_id")}
            variant="play-music-by-id"
            onSelectedPluginChange={rememberPlayByIdPlugin}
            onSubmit={async (plugin, id) => {
                await trackPlayer.playMusicByPluginId(plugin, id);
                hideModal();
                toast.success(t("plugin.play_by_id_success"));
            }}
        ></PluginInputPanel>
    );
}
