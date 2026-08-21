import { BrowserWindow } from "electron";
export function minimizeMainWindowWithNativeAnimation(
    window: BrowserWindow,
    skipTaskbar = false,
) {
    window.minimize();
    if (skipTaskbar) {
        window.setSkipTaskbar(true);
    }
}

export function restoreMainWindowWithNativeAnimation(window: BrowserWindow) {
    window.restore();
    window.setSkipTaskbar(false);
}

export function toggleMainWindowMaximizeWithNativeAnimation(window: BrowserWindow) {
    if (window.isMaximized()) {
        window.unmaximize();
    } else {
        window.maximize();
    }
}
