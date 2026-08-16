import koffi from "koffi";

type QueryUserNotificationState =
    | "QUNS_NOT_PRESENT"
    | "QUNS_BUSY"
    | "QUNS_RUNNING_D3D_FULL_SCREEN"
    | "QUNS_PRESENTATION_MODE"
    | "QUNS_ACCEPTS_NOTIFICATIONS"
    | "QUNS_QUIET_TIME"
    | "QUNS_APP"
    | "UNKNOWN_ERROR";

const notificationStates: Readonly<Record<number, QueryUserNotificationState>> = {
    1: "QUNS_NOT_PRESENT",
    2: "QUNS_BUSY",
    3: "QUNS_RUNNING_D3D_FULL_SCREEN",
    4: "QUNS_PRESENTATION_MODE",
    5: "QUNS_ACCEPTS_NOTIFICATIONS",
    6: "QUNS_QUIET_TIME",
    7: "QUNS_APP",
};

const fullscreenNotificationStates: ReadonlySet<QueryUserNotificationState> = new Set([
    "QUNS_BUSY",
    "QUNS_RUNNING_D3D_FULL_SCREEN",
    "QUNS_PRESENTATION_MODE",
]);

let queryUserNotificationState: ((state: number[]) => number) | null = null;

function getNotificationState(): QueryUserNotificationState {
    try {
        if (!queryUserNotificationState) {
            const shell32 = koffi.load("shell32.dll");
            queryUserNotificationState = shell32.func(
                "SHQueryUserNotificationState",
                "int",
                [koffi.out(koffi.pointer("int"))],
            ) as (state: number[]) => number;
        }
        const state = [0];
        const result = queryUserNotificationState(state);
        return result >= 0 ? notificationStates[state[0]] ?? "UNKNOWN_ERROR" : "UNKNOWN_ERROR";
    } catch {
        return "UNKNOWN_ERROR";
    }
}

export function isFullscreenNotificationState(state: string): boolean {
    return fullscreenNotificationStates.has(state as QueryUserNotificationState);
}

export function isFullscreenApplicationRunning(): boolean {
    const runtimeProcess = (globalThis as typeof globalThis & {
        process?: { platform?: string };
    }).process;
    if (runtimeProcess?.platform !== "win32") {
        return false;
    }
    return isFullscreenNotificationState(getNotificationState());
}
