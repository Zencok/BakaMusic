/** Bounded SDR compatibility surface; no native pointers cross IPC. */
export const MAX_VIDEO_FRAME_WIDTH = 1280;
export const MAX_VIDEO_FRAME_HEIGHT = 720;

export interface INativeVideoFrame {
    sourceId: string;
    frameId: number;
    width: number;
    height: number;
    pixels: Uint8Array;
}

export function isNativeVideoFrame(value: unknown): value is INativeVideoFrame {
    if (!value || typeof value !== "object") return false;
    const frame = value as INativeVideoFrame;
    return typeof frame.sourceId === "string" && frame.sourceId.length <= 256
        && Number.isSafeInteger(frame.frameId) && frame.frameId > 0
        && Number.isInteger(frame.width) && frame.width > 0 && frame.width <= MAX_VIDEO_FRAME_WIDTH
        && Number.isInteger(frame.height) && frame.height > 0 && frame.height <= MAX_VIDEO_FRAME_HEIGHT
        && frame.pixels instanceof Uint8Array
        && frame.pixels.byteLength === frame.width * frame.height * 4;
}

export function getVideoFrameSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { width: MAX_VIDEO_FRAME_WIDTH, height: MAX_VIDEO_FRAME_HEIGHT };
    }
    const scale = Math.min(1, MAX_VIDEO_FRAME_WIDTH / width, MAX_VIDEO_FRAME_HEIGHT / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
