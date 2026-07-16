import {
    getNotificationState,
    QUERY_USER_NOTIFICATION_STATE,
} from "windows-notification-state";

const fullscreenNotificationStates: ReadonlySet<QUERY_USER_NOTIFICATION_STATE> = new Set([
    "QUNS_BUSY",
    "QUNS_RUNNING_D3D_FULL_SCREEN",
    "QUNS_PRESENTATION_MODE",
]);

export function isFullscreenNotificationState(state: string): boolean {
    return fullscreenNotificationStates.has(state as QUERY_USER_NOTIFICATION_STATE);
}

export function isFullscreenApplicationRunning(): boolean {
    if (process.platform !== "win32") {
        return false;
    }
    return isFullscreenNotificationState(getNotificationState());
}
