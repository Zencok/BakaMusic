import { screen } from "electron";
import { activeWindowSync } from "get-windows";
import {
    IForegroundWindowBounds,
    isFullscreenWindowBounds,
} from "./fullscreen-window-bounds";

function getDipWindowBounds(
    foregroundWindow: IForegroundWindowBounds,
): IForegroundWindowBounds {
    return {
        bounds: screen.screenToDipRect(null, foregroundWindow.bounds),
        contentBounds: screen.screenToDipRect(null, foregroundWindow.contentBounds),
    };
}

export function isFullscreenForegroundWindow(): boolean {
    if (process.platform !== "win32") {
        return false;
    }

    const foregroundWindow = activeWindowSync();
    if (!foregroundWindow || foregroundWindow.platform !== "windows") {
        return false;
    }

    const windowBounds = {
        bounds: foregroundWindow.bounds,
        contentBounds: foregroundWindow.contentBounds,
    };
    const displayBounds = screen.getAllDisplays().map((display) => display.bounds);

    return isFullscreenWindowBounds(windowBounds, displayBounds)
        || isFullscreenWindowBounds(getDipWindowBounds(windowBounds), displayBounds);
}
