import { ipcMain } from "electron";
import type { IWindowManager } from "@/types/window-manager";
import {
    assertFiniteNumber,
    assertIpcPayload,
    assertIpcSender,
    assertPlainObject,
    assertString,
    isIpcSenderAllowed,
} from "@shared/ipc-security/main";
import type {
    IMvOverlayAudioCommand,
    IMvOverlayAudioResponse,
    IMvOverlaySession,
    MvOverlayAudioOperation,
} from "./common";

const AUDIO_REQUEST_TIMEOUT_MS = 10_000;

interface PendingAudioRequest {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

function validateSession(value: unknown): IMvOverlaySession {
    assertIpcPayload(value, 2 * 1024 * 1024);
    assertPlainObject(value, "MV overlay session");
    assertPlainObject(value.musicItem, "MV music item");
    const rawMusicId = value.musicItem.id;
    if (
        typeof rawMusicId !== "string"
        && (typeof rawMusicId !== "number" || !Number.isFinite(rawMusicId))
    ) {
        throw new Error("MV music id is invalid");
    }
    const musicId = String(rawMusicId);
    assertString(musicId, "MV music id", 512);
    assertString(value.musicItem.platform, "MV music platform", 256);
    assertString(value.musicItem.title, "MV music title", 512);
    assertString(value.musicItem.artist, "MV music artist", 512, true);
    assertPlainObject(value.audio, "MV audio state");
    assertFiniteNumber(value.audio.volume, "MV audio volume", 0, 1);
    if (typeof value.audio.muted !== "boolean") {
        throw new Error("MV audio mute state is invalid");
    }
    return JSON.parse(JSON.stringify({
        ...value,
        musicItem: {
            ...value.musicItem,
            id: musicId,
        },
    })) as IMvOverlaySession;
}

class MvOverlayManager {
    private windowManager!: IWindowManager;
    private session: IMvOverlaySession | null = null;
    private requestCounter = 0;
    private pendingAudioRequests = new Map<string, PendingAudioRequest>();
    private audioSuspended = false;
    private audioOperationQueue: Promise<void> = Promise.resolve();
    private sessionWindowId: number | null = null;

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        windowManager.on("WindowCreated", ({ windowName, browserWindow }) => {
            if (windowName !== "mv") {
                return;
            }
            this.sessionWindowId = browserWindow.id;
            browserWindow.on("closed", () => {
                if (this.sessionWindowId !== browserWindow.id) {
                    return;
                }
                this.sessionWindowId = null;
                this.session = null;
                void this.queueAudioOperation("restore");
            });
        });

        ipcMain.handle("@shared/mv-overlay/open", (event, value) => {
            assertIpcSender(event, ["main"]);
            const session = validateSession(value);
            const existing = this.windowManager.mvWindow;
            if (existing && !existing.isDestroyed()) {
                this.windowManager.showMvWindow();
                return true;
            }
            this.session = session;
            this.windowManager.showMvWindow();
            return Boolean(this.windowManager.mvWindow);
        });

        ipcMain.handle("@shared/mv-overlay/get-session", (event) => {
            assertIpcSender(event, ["mv"]);
            if (!this.session) {
                throw new Error("MV overlay session is unavailable");
            }
            return this.session;
        });

        ipcMain.handle("@shared/mv-overlay/audio", async (event, operation) => {
            assertIpcSender(event, ["mv"]);
            if (operation !== "suspend" && operation !== "restore") {
                throw new Error("MV audio operation is invalid");
            }
            await this.queueAudioOperation(operation);
        });

        ipcMain.on("@shared/mv-overlay/close", (event) => {
            if (!isIpcSenderAllowed(event, ["mv"])) {
                return;
            }
            this.windowManager.closeMvWindow();
        });

        ipcMain.on("@shared/mv-overlay/audio-response", (event, value) => {
            if (!isIpcSenderAllowed(event, ["main"])) {
                return;
            }
            try {
                assertIpcPayload(value, 8 * 1024);
                assertPlainObject(value, "MV audio response");
                assertString(value.requestId, "MV audio request id", 128);
                if (typeof value.success !== "boolean") {
                    throw new Error("MV audio response state is invalid");
                }
            } catch {
                return;
            }
            const response = value as unknown as IMvOverlayAudioResponse;
            const pending = this.pendingAudioRequests.get(response.requestId);
            if (!pending) {
                return;
            }
            this.pendingAudioRequests.delete(response.requestId);
            clearTimeout(pending.timer);
            if (response.success) {
                pending.resolve();
            } else {
                pending.reject(new Error(response.error || "MV audio operation failed"));
            }
        });
    }

    private queueAudioOperation(operation: MvOverlayAudioOperation) {
        const task = this.audioOperationQueue.then(async () => {
            if (operation === "suspend" && this.audioSuspended) {
                return;
            }
            if (operation === "restore" && !this.audioSuspended) {
                return;
            }
            await this.requestMainAudioOperation(operation);
            this.audioSuspended = operation === "suspend";
        });
        this.audioOperationQueue = task.catch(() => undefined);
        return task;
    }

    private requestMainAudioOperation(operation: MvOverlayAudioOperation) {
        const mainWindow = this.windowManager.mainWindow;
        if (!mainWindow || mainWindow.isDestroyed()) {
            if (operation === "restore") {
                this.audioSuspended = false;
                return Promise.resolve();
            }
            return Promise.reject(new Error("Main renderer is unavailable"));
        }
        const requestId = `mv-audio-${process.pid}-${++this.requestCounter}`;
        const command: IMvOverlayAudioCommand = { requestId, operation };
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAudioRequests.delete(requestId);
                reject(new Error("MV audio operation timed out"));
            }, AUDIO_REQUEST_TIMEOUT_MS);
            this.pendingAudioRequests.set(requestId, { resolve, reject, timer });
            mainWindow.webContents.send("@shared/mv-overlay/audio-command", command);
        });
    }
}

export default new MvOverlayManager();
