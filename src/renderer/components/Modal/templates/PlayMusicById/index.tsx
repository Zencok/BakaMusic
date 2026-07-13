import { hideModal, showModal } from "../..";
import Base from "../Base";
import { useTranslation } from "react-i18next";
import "../plugin-picker.scss";
import "./index.scss";
import NoPlugin from "@renderer/components/NoPlugin";
import trackPlayer from "@renderer/core/track-player";
import { toast } from "react-toastify";
import SvgAsset from "@/renderer/components/SvgAsset";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

function platformInitial(platform: string) {
    const text = platform?.trim() || "?";
    return text.slice(0, 1).toUpperCase();
}

export default function PlayMusicById(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();

    return (
        <Base withBlur={false} defaultClose>
            <div className="modal--play-music-by-id modal--plugin-picker shadow">
                <Base.Header>{t("plugin.method_play_by_id")}</Base.Header>
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
                                        title: `${t("plugin.method_play_by_id")} · ${it.platform}`,
                                        placeholder: t("plugin.play_by_id_placeholder"),
                                        maxLength: 200,
                                        withLoading: true,
                                        loadingText: t("plugin.play_by_id_loading"),
                                        onOk(text: string) {
                                            const id = text.trim();
                                            if (!id) return;
                                            return trackPlayer.playMusicById(it.platform, id);
                                        },
                                        onPromiseResolved() {
                                            hideModal();
                                        },
                                        onPromiseRejected() {
                                            toast.error(t("plugin.play_by_id_failed"));
                                            hideModal();
                                        },
                                    });
                                }}
                            >
                                <span className="plugin-item-badge" aria-hidden="true">
                                    {platformInitial(it.platform)}
                                </span>
                                <div className="plugin-item-main">
                                    <div className="plugin-item-title">{it.platform}</div>
                                    <div className="plugin-item-hint">{t("plugin.method_play_by_id")}</div>
                                </div>
                                <span className="plugin-item-chevron" aria-hidden="true">
                                    <SvgAsset iconName="chevron-right" size={18}></SvgAsset>
                                </span>
                            </div>
                        ))
                    ) : (
                        <NoPlugin supportMethod={t("plugin.method_play_by_id")}></NoPlugin>
                    )}
                </div>
            </div>
        </Base>
    );
}
