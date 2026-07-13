import { hideModal, showModal } from "../..";
import Base from "../Base";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import "../plugin-picker.scss";
import "./index.scss";
import NoPlugin from "@renderer/components/NoPlugin";
import PluginManager from "@shared/plugin-manager/renderer";
import SvgAsset from "@/renderer/components/SvgAsset";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

function platformInitial(platform: string) {
    const text = platform?.trim() || "?";
    return text.slice(0, 1).toUpperCase();
}

export default function ImportMusicSheet(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();

    return (
        <Base withBlur={false} defaultClose>
            <div className="modal--import-music-sheet modal--plugin-picker shadow">
                <Base.Header>{t("plugin.method_import_music_sheet")}</Base.Header>
                <div className="plugin-picker-subtitle">
                    {t("plugin_management_page.choose_plugin")}
                </div>
                <div className="content-container">
                    {plugins?.length > 0 ? (
                        plugins.map((it) => (
                            <div
                                role="button"
                                key={it.hash}
                                className="plugin-item"
                                onClick={() => {
                                    hideModal();
                                    showModal("SimpleInputWithState", {
                                        title: `${t("plugin.method_import_music_sheet")} · ${it.platform}`,
                                        withLoading: true,
                                        loadingText: t("plugin_management_page.importing_media"),
                                        placeholder: String(t(
                                            "plugin_management_page.placeholder_import_music_sheet",
                                            {
                                                plugin: it.platform,
                                            },
                                        )),
                                        maxLength: 1000,
                                        onOk(text) {
                                            return PluginManager.callPluginDelegateMethod(
                                                it,
                                                "importMusicSheet",
                                                text.trim(),
                                            );
                                        },
                                        onPromiseResolved(result) {
                                            hideModal();
                                            showModal("AddMusicToSheet", {
                                                musicItems: result as IMusic.IMusicItem[],
                                            });
                                        },
                                        onPromiseRejected() {
                                            toast.error(t("plugin_management_page.import_failed"));
                                        },
                                        hints: it.hints?.importMusicSheet ?? undefined,
                                    });
                                }}
                            >
                                <span className="plugin-item-badge" aria-hidden="true">
                                    {platformInitial(it.platform)}
                                </span>
                                <div className="plugin-item-main">
                                    <div className="plugin-item-title">{it.platform}</div>
                                    <div className="plugin-item-hint">
                                        {t("plugin.method_import_music_sheet")}
                                    </div>
                                </div>
                                <span className="plugin-item-chevron" aria-hidden="true">
                                    <SvgAsset iconName="chevron-right" size={18}></SvgAsset>
                                </span>
                            </div>
                        ))
                    ) : (
                        <NoPlugin supportMethod={t("plugin.method_import_music_sheet")}></NoPlugin>
                    )}
                </div>
            </div>
        </Base>
    );
}
