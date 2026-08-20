import { BrowserWindow } from "electron";
import koffi from "koffi";

const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x0008_0000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const WINDOW_STYLE_REFRESH_FLAGS =
    SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
const LAYERED_STYLE_RESTORE_DELAY_MS = 280;

type NativeWindowHandle = number | bigint;

interface Win32WindowApi {
    getWindowLongPtr: (window: NativeWindowHandle, index: number) => NativeWindowHandle;
    setWindowLongPtr: (
        window: NativeWindowHandle,
        index: number,
        value: NativeWindowHandle,
    ) => NativeWindowHandle;
    setWindowPos: (
        window: NativeWindowHandle,
        insertAfter: NativeWindowHandle,
        x: number,
        y: number,
        width: number,
        height: number,
        flags: number,
    ) => number;
}

let win32WindowApi: Win32WindowApi | null = null;
const layeredStyleTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();

function getWin32WindowApi(): Win32WindowApi {
    if (win32WindowApi) {
        return win32WindowApi;
    }
    const user32 = koffi.load("user32.dll");
    win32WindowApi = {
        getWindowLongPtr: user32.func(
            "intptr_t __stdcall GetWindowLongPtrW(uintptr_t, int)",
        ),
        setWindowLongPtr: user32.func(
            "intptr_t __stdcall SetWindowLongPtrW(uintptr_t, int, intptr_t)",
        ),
        setWindowPos: user32.func(
            "int __stdcall SetWindowPos(uintptr_t, uintptr_t, int, int, int, int, uint32_t)",
        ),
    };
    return win32WindowApi;
}

function getNativeWindowHandle(window: BrowserWindow): NativeWindowHandle {
    const handle = window.getNativeWindowHandle();
    if (handle.length >= 8) {
        return handle.readBigUInt64LE(0);
    }
    if (handle.length >= 4) {
        return handle.readUInt32LE(0);
    }
    throw new Error("Main window handle is invalid");
}

function toBigInt(value: NativeWindowHandle) {
    return typeof value === "bigint" ? value : BigInt(value);
}

function setLayeredStyle(window: BrowserWindow, enabled: boolean) {
    if (process.platform !== "win32" || window.isDestroyed()) {
        return false;
    }
    try {
        const api = getWin32WindowApi();
        const nativeWindow = getNativeWindowHandle(window);
        const current = toBigInt(api.getWindowLongPtr(nativeWindow, GWL_EXSTYLE));
        const next = enabled
            ? current | BigInt(WS_EX_LAYERED)
            : current & ~BigInt(WS_EX_LAYERED);
        if (current === next) {
            return false;
        }
        api.setWindowLongPtr(nativeWindow, GWL_EXSTYLE, next);
        api.setWindowPos(
            nativeWindow,
            0,
            0,
            0,
            0,
            0,
            WINDOW_STYLE_REFRESH_FLAGS,
        );
        return true;
    } catch {
        // Electron's normal operation remains the safe fallback if this host
        // does not expose a compatible Win32 window handle/API.
        return false;
    }
}

function clearLayeredStyleTimer(window: BrowserWindow) {
    const timer = layeredStyleTimers.get(window);
    if (timer !== undefined) {
        clearTimeout(timer);
        layeredStyleTimers.delete(window);
    }
}

function restoreLayeredStyleLater(window: BrowserWindow) {
    clearLayeredStyleTimer(window);
    layeredStyleTimers.set(window, setTimeout(() => {
        layeredStyleTimers.delete(window);
        setLayeredStyle(window, true);
    }, LAYERED_STYLE_RESTORE_DELAY_MS));
}

function prepareNativeWindowTransition(window: BrowserWindow) {
    clearLayeredStyleTimer(window);
    return setLayeredStyle(window, false);
}

/**
 * Windows does not animate Electron transparent layered windows. Temporarily
 * removing WS_EX_LAYERED lets DWM perform its native transition; the layered
 * style is restored afterwards for the native libmpv overlay path.
 */
export function minimizeMainWindowWithNativeAnimation(
    window: BrowserWindow,
    skipTaskbar = false,
) {
    const changed = prepareNativeWindowTransition(window);
    window.minimize();
    if (skipTaskbar) {
        window.setSkipTaskbar(true);
    }
    if (changed) {
        restoreLayeredStyleLater(window);
    }
}

export function restoreMainWindowWithNativeAnimation(window: BrowserWindow) {
    const changed = prepareNativeWindowTransition(window);
    window.restore();
    window.setSkipTaskbar(false);
    if (changed) {
        restoreLayeredStyleLater(window);
    }
}

export function toggleMainWindowMaximizeWithNativeAnimation(window: BrowserWindow) {
    const changed = prepareNativeWindowTransition(window);
    if (window.isMaximized()) {
        window.unmaximize();
    } else {
        window.maximize();
    }
    if (changed) {
        restoreLayeredStyleLater(window);
    }
}
