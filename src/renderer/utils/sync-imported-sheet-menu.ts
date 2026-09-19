import type { TFunction } from "i18next";
import type { IContextMenuItem } from "@/renderer/components/ContextMenu";
import MusicSheet from "@/renderer/core/music-sheet";
import { toast } from "react-toastify";

export function syncImportedSheetMenu(
    sheet: IMedia.IMediaBase,
    t: TFunction,
    starred = false,
): IContextMenuItem {
    return {
        title: t("plugin.sync_sheet"),
        icon: "arrow-path",
        show: Boolean(sheet.importSources?.length),
        async onClick() {
            const notification = toast.loading(t("plugin.sync_sheet_loading"));
            try {
                const result = await MusicSheet.frontend.syncImportedSheet(sheet, starred);
                toast.update(notification, {
                    render: t("plugin.sync_sheet_success", result),
                    type: "success", isLoading: false, autoClose: 5000,
                });
            } catch (error) {
                const key = error instanceof Error && [
                    "sync_sheet_busy", "sync_sheet_missing_source", "sync_sheet_missing_plugin",
                ].includes(error.message) ? error.message : "sync_sheet_failed";
                toast.update(notification, {
                    render: t(`plugin.${key}`),
                    type: "error", isLoading: false, autoClose: 5000,
                });
            }
        },
    };
}
