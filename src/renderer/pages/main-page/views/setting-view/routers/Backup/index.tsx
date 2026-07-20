import "./index.scss";
import { toast } from "react-toastify";
import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import InputSettingItem from "../../components/InputSettingItem";
import SettingGroup from "../../components/SettingGroup";
import { useTranslation } from "react-i18next";
import AppConfig from "@shared/app-config/renderer";
import { dialogUtil, fsUtil } from "@shared/utils/renderer";
import SvgAsset, { type SvgAssetIconNames } from "@renderer/components/SvgAsset";
import { getErrorMessage } from "@/common/error-util";
import BackupBridge from "@shared/backup/renderer";

interface IBackupActionButtonProps {
    iconName: SvgAssetIconNames;
    label: string;
    onClick: () => void | Promise<void>;
}

function BackupActionButton(props: IBackupActionButtonProps) {
    const {
        iconName,
        label,
        onClick,
    } = props;

    return (
        <button
            className="backup-action-button"
            type="button"
            onClick={onClick}
        >
            <SvgAsset iconName={iconName}></SvgAsset>
            <span>{label}</span>
        </button>
    );
}

async function resumeSheetBackup(data: unknown, overwrite: boolean) {
    if (typeof data !== "string") {
        throw new Error("Invalid backup payload");
    }
    const { default: BackupResume } = await import("@/renderer/core/backup-resume");
    await BackupResume.resume(data, overwrite);
}

export default function Backup() {
    const { t } = useTranslation();

    async function exportSheetBackup() {
        const { default: MusicSheet } = await import("@/renderer/core/music-sheet");
        const { createBackupPayload } = await import(
            "@/renderer/core/backup-resume",
        );
        const sheetDetails = await MusicSheet.frontend.exportAllSheetDetails();
        return createBackupPayload(sheetDetails);
    }

    async function onFileBackupClick() {
        try {
            const { createBackupFileName } = await import(
                "@/renderer/core/backup-resume/format",
            );
            const result = await dialogUtil.showSaveDialog({
                defaultPath: createBackupFileName(),
                properties: ["showOverwriteConfirmation", "createDirectory"],
                filters: [
                    {
                        name: t("settings.backup.bakamusic_backup_file"),
                        extensions: ["json", "txt"],
                    },
                ],
                title: t("settings.backup.backup_to"),
            });

            if (!result.canceled && result.filePath) {
                await fsUtil.writeFile(
                    result.filePath,
                    await exportSheetBackup(),
                    "utf-8",
                );
                toast.success(t("settings.backup.backup_success"));
            }
        } catch (e) {
            toast.error(
                t("settings.backup.backup_fail", {
                    reason: getErrorMessage(e),
                }),
            );
        }
    }

    async function onFileResumeClick() {
        const result = await dialogUtil.showOpenDialog({
            properties: ["openFile"],
            filters: [
                {
                    name: t("settings.backup.bakamusic_backup_file"),
                    extensions: ["json", "txt"],
                },
            ],
            title: t("common.open"),
        });

        if (!result.canceled && result.filePaths) {
            try {
                const rawSheets = (await fsUtil.readFile(
                    result.filePaths[0],
                    "utf-8",
                )) as string;

                await resumeSheetBackup(
                    rawSheets,
                    AppConfig.getConfig("backup.resumeBehavior") === "overwrite",
                );

                toast.success(t("settings.backup.resume_success"));
            } catch (e) {
                toast.error(
                    t("settings.backup.resume_fail", {
                        reason: getErrorMessage(e),
                    }),
                );
            }
        }
    }

    async function onWebdavBackupClick() {
        const url = AppConfig.getConfig("backup.webdav.url");
        const username = AppConfig.getConfig("backup.webdav.username");
        const password = AppConfig.getConfig("backup.webdav.password");

        try {
            if (url && username && password) {
                await BackupBridge.backupToWebdav(
                    { url, username, password },
                    await exportSheetBackup(),
                );
                toast.success(t("settings.backup.backup_success"));
            } else {
                toast.error(t("settings.backup.webdav_data_not_complete"));
            }
        } catch (e) {
            toast.error(
                t("settings.backup.backup_fail", {
                    reason: getErrorMessage(e),
                }),
            );
        }
    }

    async function onWebdavResumeClick() {
        const url = AppConfig.getConfig("backup.webdav.url");
        const username = AppConfig.getConfig("backup.webdav.username");
        const password = AppConfig.getConfig("backup.webdav.password");

        try {
            if (url && username && password) {
                const resumeData = await BackupBridge.restoreFromWebdav({
                    url,
                    username,
                    password,
                });
                if (resumeData === null) {
                    throw new Error(
                        t("settings.backup.webdav_backup_file_not_exist"),
                    );
                }
                await resumeSheetBackup(
                    resumeData,
                    AppConfig.getConfig("backup.resumeBehavior") === "overwrite",
                );
                toast.success(t("settings.backup.resume_success"));
            } else {
                toast.error(t("settings.backup.webdav_data_not_complete"));
            }
        } catch (e) {
            toast.error(
                t("settings.backup.resume_fail", {
                    reason: getErrorMessage(e),
                }),
            );
        }
    }

    return (
        <div className="setting-view--backup-container">
            <SettingGroup
                title={t("settings.group.backup_policy")}
                description={t("settings.group.backup_policy_desc")}
            >
                <RadioGroupSettingItem
                    keyPath="backup.resumeBehavior"
                    label={t("settings.backup.resume_behavior")}
                    options={[
                        "append",
                        "overwrite",
                    ]}
                    renderItem={(item) => t("settings.backup.resume_mode_" + item)}
                ></RadioGroupSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.backup.backup_by_file")}
                description={t("settings.group.backup_file_desc")}
            >
                <div className="setting-row backup-block-row">
                    <div className="backup-block-content backup-file-actions">
                        <BackupActionButton
                            iconName="array-download-tray"
                            label={t("settings.backup.backup_music_sheet")}
                            onClick={onFileBackupClick}
                        ></BackupActionButton>
                        <BackupActionButton
                            iconName="arrow-path"
                            label={t("settings.backup.resume_music_sheet")}
                            onClick={onFileResumeClick}
                        ></BackupActionButton>
                    </div>
                </div>
            </SettingGroup>

            <SettingGroup
                title={t("settings.backup.backup_by_webdav")}
                description={t("settings.group.backup_webdav_desc")}
            >
                <div className="setting-row backup-block-row webdav-panel">
                    <div className="backup-block-content webdav-block-content">
                        <div className="webdav-backup-container">
                            <InputSettingItem
                                width="100%"
                                label={t("settings.backup.webdav_server_url")}
                                trim
                                keyPath="backup.webdav.url"
                            ></InputSettingItem>
                            <InputSettingItem
                                width="100%"
                                label={t("settings.backup.username")}
                                trim
                                keyPath="backup.webdav.username"
                            ></InputSettingItem>
                            <InputSettingItem
                                width="100%"
                                label={t("settings.backup.password")}
                                type="password"
                                trim
                                keyPath="backup.webdav.password"
                            ></InputSettingItem>
                        </div>
                        <div className="webdav-actions">
                            <BackupActionButton
                                iconName="array-download-tray"
                                label={t("settings.backup.backup_music_sheet")}
                                onClick={onWebdavBackupClick}
                            ></BackupActionButton>
                            <BackupActionButton
                                iconName="arrow-path"
                                label={t("settings.backup.resume_music_sheet")}
                                onClick={onWebdavResumeClick}
                            ></BackupActionButton>
                        </div>
                    </div>
                </div>
            </SettingGroup>
        </div>
    );
}
