export interface IMvOverlayAudioState {
    volume: number;
    muted: boolean;
}

export interface IMvOverlaySession {
    musicItem: IMusic.IMusicItem;
    audio: IMvOverlayAudioState;
}

export type MvOverlayAudioOperation = "suspend" | "restore";

export interface IMvOverlayAudioCommand {
    requestId: string;
    operation: MvOverlayAudioOperation;
}

export interface IMvOverlayAudioResponse {
    requestId: string;
    success: boolean;
    error?: string;
}
