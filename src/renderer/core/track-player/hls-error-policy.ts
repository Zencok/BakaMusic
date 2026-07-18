export type HlsErrorAction = "ignore" | "restart-load" | "recover-media" | "fail";

export interface IHlsRecoveryState {
    networkAttempts: number;
    mediaAttempts: number;
}

const maxRecoveryAttempts = 2;

export function classifyHlsError(
    error: { fatal?: boolean; type?: string },
    recoveryState: IHlsRecoveryState,
): HlsErrorAction {
    if (!error.fatal) {
        return "ignore";
    }
    if (error.type === "networkError" && recoveryState.networkAttempts < maxRecoveryAttempts) {
        return "restart-load";
    }
    if (error.type === "mediaError" && recoveryState.mediaAttempts < maxRecoveryAttempts) {
        return "recover-media";
    }
    return "fail";
}
