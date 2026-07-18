import { showModal } from "../components/Modal";
import { getUserPreference } from "./user-perference";
import { shouldShowAvailableUpdate } from "./update-version";
import { appUtil } from "@shared/utils/renderer";

export default async function checkUpdate(forceCheck?: boolean) {
    /** checkupdate */
    const updateInfo = await appUtil.checkUpdate();
    if (updateInfo.update) {
        const skipVersion = getUserPreference("skipVersion");
        if (!shouldShowAvailableUpdate(
            updateInfo.update.version,
            skipVersion,
            Boolean(forceCheck),
        )) {
            return false;
        }
        showModal("Update", {
            currentVersion: updateInfo.version,
            update: updateInfo.update,
        });
        return true;
    }
    return false;
}
