import { useState, useEffect, useRef } from "react";
import { setUserPreference } from "@/renderer/utils/user-perference";
import Base from "../Base";
import "./index.scss";
import { hideModal } from "../..";
import { useTranslation } from "react-i18next";
import { appUtil, shellUtil } from "@shared/utils/renderer";
import { renderUpdateChangelog } from "@/renderer/utils/update-changelog";

interface IUpdateProps {
    currentVersion: string;
    update: ICommon.IUpdateInfo["update"];
}

type DownloadPhase = "idle" | "downloading" | "downloaded" | "error";

export default function Update(props: IUpdateProps) {
    const { currentVersion, update = {} as ICommon.IUpdateInfo["update"] } = props;
    const { t } = useTranslation();

    const [phase, setPhase] = useState<DownloadPhase>("idle");
    const [downloaded, setDownloaded] = useState(0);
    const [total, setTotal] = useState(0);
    const [errorMsg, setErrorMsg] = useState("");
    const downloadAttemptRef = useRef(0);
    const isDownloadingRef = useRef(false);
    const unsubRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            unsubRef.current?.();
            if (isDownloadingRef.current) {
                appUtil.cancelUpdateDownload();
            }
        };
    }, []);

    const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

    function formatBytes(bytes: number) {
        if (bytes <= 0) return "0 B";
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function handleDownload() {
        if (!update?.download?.length) {
            shellUtil.openExternal("https://github.com/ShenYichenCN/BakaMusic_syc/releases/latest");
            return;
        }

        setPhase("downloading");
        setDownloaded(0);
        setTotal(0);
        setErrorMsg("");
        isDownloadingRef.current = true;
        const attempt = ++downloadAttemptRef.current;

        const unsubscribe = appUtil.onUpdateDownloadProgress(({ downloaded: dl, total: tot }) => {
            setDownloaded(dl);
            setTotal(tot);
        });
        unsubRef.current = unsubscribe;

        try {
            await appUtil.downloadUpdate();
            if (attempt !== downloadAttemptRef.current) {
                return;
            }
            setPhase("downloaded");
        } catch (error: unknown) {
            if (attempt !== downloadAttemptRef.current) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Download cancelled")) {
                setPhase("idle");
            } else {
                setErrorMsg(`下载失败：${message || "未知错误"}`);
                setPhase("error");
            }
        } finally {
            unsubscribe();
            if (attempt === downloadAttemptRef.current) {
                isDownloadingRef.current = false;
                unsubRef.current = null;
            }
        }
    }

    function handleCancel() {
        downloadAttemptRef.current += 1;
        isDownloadingRef.current = false;
        unsubRef.current?.();
        unsubRef.current = null;
        appUtil.cancelUpdateDownload();
        setPhase("idle");
    }

    async function handleInstall() {
        try {
            await appUtil.installUpdate();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setErrorMsg(`安装失败：${message || "未知错误"}`);
            setPhase("error");
        }
    }

    return (
        <Base withBlur defaultClose>
            <div className="modal--update-container shadow backdrop-color">
                <Base.Header>{t("modal.new_version_found")}</Base.Header>
                <div className="modal--body-container">
                    <div className="version highlight">
                        {t("modal.latest_version")}
                        {update?.version}
                    </div>
                    <div className="version">
                        {t("modal.current_version")}
                        {currentVersion}
                    </div>
                    <div className="divider"></div>
                    <div
                        dangerouslySetInnerHTML={{
                            __html: renderUpdateChangelog(update?.changeLog ?? []),
                        }}
                        onClick={(e) => {
                            const a = (e.target as HTMLElement).closest("a");
                            const href = a?.getAttribute("href");
                            if (href) {
                                e.preventDefault();
                                shellUtil.openExternal(href);
                            }
                        }}
                    />
                </div>

                {phase === "downloading" && (
                    <div className="update-progress-area">
                        <div className="progress-bar-track">
                            <div
                                className="progress-bar-fill"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                        <div className="progress-info">
                            <span>
                                {total > 0
                                    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
                                    : `${formatBytes(downloaded)} 下载中…`}
                            </span>
                            <span>{total > 0 ? `${percent}%` : ""}</span>
                        </div>
                    </div>
                )}

                {phase === "error" && (
                    <div className="update-error-area">
                        <span>{errorMsg}</span>
                    </div>
                )}

                <div className="divider"></div>
                <div className="footer-options">
                    {phase === "idle" && (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={() => {
                                    if (update?.version) {
                                        setUserPreference("skipVersion", update.version);
                                    }
                                    hideModal();
                                }}
                            >
                                {t("modal.skip_this_version")}
                            </div>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={hideModal}
                            >
                                稍后提醒
                            </div>
                            <div
                                role="button"
                                data-type="primaryButton"
                                onClick={handleDownload}
                            >
                                一键更新
                            </div>
                        </>
                    )}

                    {phase === "downloading" && (
                        <div
                            role="button"
                            data-type="normalButton"
                            onClick={handleCancel}
                        >
                            取消下载
                        </div>
                    )}

                    {phase === "downloaded" && (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={hideModal}
                            >
                                稍后安装
                            </div>
                            <div
                                role="button"
                                data-type="primaryButton"
                                onClick={handleInstall}
                            >
                                立即安装
                            </div>
                        </>
                    )}

                    {phase === "error" && (
                        <>
                            <div
                                role="button"
                                data-type="normalButton"
                                onClick={() => {
                                    shellUtil.openExternal(
                                        "https://github.com/ShenYichenCN/BakaMusic_syc/releases/latest",
                                    );
                                }}
                            >
                                浏览器下载
                            </div>
                            <div
                                role="button"
                                data-type="primaryButton"
                                onClick={handleDownload}
                            >
                                重试
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Base>
    );
}
