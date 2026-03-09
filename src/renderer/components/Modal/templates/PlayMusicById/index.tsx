import { hideModal, showModal } from "../..";
import Base from "../Base";
import { useTranslation } from "react-i18next";
import "./index.scss";
import NoPlugin from "@renderer/components/NoPlugin";
import trackPlayer from "@renderer/core/track-player";
import { toast } from "react-toastify";

interface IProps {
    plugins: IPlugin.IPluginDelegate[];
}

export default function PlayMusicById(props: IProps) {
    const { plugins } = props;
    const { t } = useTranslation();

    return (
        <Base withBlur={false}>
            <div className="modal--play-music-by-id shadow backdrop-color">
                <Base.Header>{t("plugin.method_play_by_id")}</Base.Header>
                <div className="content-container">
                    {
                        plugins?.length > 0 ? <>{plugins.map((it) => (
                            <div
                                role="button"
                                key={it.hash}
                                className="plugin-item"
                                onClick={() => {
                                    hideModal();
                                    showModal("SimpleInputWithState", {
                                        title: t("plugin.method_play_by_id") + " - " + it.platform,
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
                                {it.platform}
                            </div>
                        ))}</> : <NoPlugin supportMethod={t("plugin.method_play_by_id")}></NoPlugin>
                    }
                </div>
            </div>
        </Base>
    );
}
