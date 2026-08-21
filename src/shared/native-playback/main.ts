import {
    app,
    BaseWindow,
    BrowserWindow,
    ipcMain,
    screen,
    utilityProcess,
    UtilityProcess,
} from "electron";
import fs from "fs";
import koffi from "koffi";
import path from "path";
import { supportLocalMediaType } from "@/common/constant";
import { normalizeVideoUpstreamUrl } from "@/common/video-url";
import type { IWindowManager } from "@/types/window-manager";
import {
    assertBoolean,
    assertFiniteNumber,
    assertIpcPayload,
    assertIpcSender,
    assertPathAccess,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import { parseLocalMediaUrl } from "@shared/local-media/common";
import logger from "@shared/logger/main";
import ServiceManager from "@shared/service-manager/main";
import AppConfig from "@shared/app-config/main";
import messageBus from "@shared/message-bus/main";
import {
    getMpvRuntimeDirectory,
    hasNativePlaybackRuntime,
} from "./runtime-path";
import {
    INativeAudioOutputDevice,
    INativePlaybackCapabilities,
    INativePlaybackSnapshot,
    INativeVideoOpenRequest,
    INativeVideoSource,
    INativeVideoSourceSelect,
    INativeVideoSourcesUpdate,
    INativeVideoSurfaceBounds,
    INativeVideoSurfaceUpdate,
    NativePlaybackRuntimeCommand,
    NativeVideoCommand,
} from "./common";
import systemMediaControls, { type SystemMediaAction } from "./system-media-controls";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PENDING_REQUESTS = 32;
const MAX_RPC_BYTES = 512 * 1024;
const MAX_RUNTIME_WORKING_SET_KB = 2 * 1024 * 1024;
const MAX_MEDIA_HEADERS = 64;
const forbiddenMediaHeaders = new Set([
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

function createPlaybackEnvironment(): NodeJS.ProcessEnv {
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
    const localNoProxy = [noProxy, "127.0.0.1", "localhost"]
        .filter(Boolean)
        .join(",");
    const wasapiExclusive = process.platform === "win32"
        && !!AppConfig.getConfig("playMusic.wasapiExclusive");
    return {
        ...process.env,
        NO_PROXY: localNoProxy,
        no_proxy: localNoProxy,
        // Consumed by the libmpv host before initialize (Windows WASAPI exclusive).
        BAKAMUSIC_WASAPI_EXCLUSIVE: wasapiExclusive ? "1" : "0",
    };
}

interface PendingRequest {
    child: UtilityProcess;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface ValidatedNativeVideoSource extends Omit<INativeVideoSource, "url" | "backupUrls"> {
    url: string;
    sourceType: "path" | "location";
    backupUrls: string[];
}

interface ValidatedNativeVideoOpenRequest extends Omit<INativeVideoOpenRequest, "sources"> {
    sources: ValidatedNativeVideoSource[];
}

function payloadBytes(value: unknown) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : Buffer.byteLength(serialized, "utf8");
    } catch {
        return null;
    }
}

function validateSourceId(value: unknown) {
    assertString(value, "native playback source id", 128);
    if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
        throw new Error("Native playback source id is invalid");
    }
    return value;
}

function resolveNativeSource(value: unknown) {
    assertString(value, "native playback URL", 32_768);
    const managedMediaUrl = ServiceManager.resolveManagedMediaProxyUrl(value);
    if (managedMediaUrl) {
        return {
            sourceType: "location" as const,
            value: managedMediaUrl,
        };
    }
    if (value.startsWith("http:") || value.startsWith("https:")) {
        return {
            sourceType: "location" as const,
            value: assertUrl(
                value,
                ["https:", "http:"],
                32_768,
                { allowCredentials: true },
            ).toString(),
        };
    }
    const requestedPath = parseLocalMediaUrl(value);
    const grantedPath = assertPathAccess(requestedPath, {
        extensions: supportLocalMediaType,
    });
    const realPath = fs.realpathSync.native(grantedPath);
    assertPathAccess(realPath, { extensions: supportLocalMediaType });
    if (!fs.statSync(realPath).isFile()) {
        throw new Error("Native playback source is not a file");
    }
    return {
        sourceType: "path" as const,
        value: realPath,
    };
}

function validateHeaders(value: unknown) {
    if (value === undefined) {
        return undefined;
    }
    assertPlainObject(value, "native playback headers");
    const entries = Object.entries(value);
    if (entries.length > MAX_MEDIA_HEADERS) {
        throw new Error("Native playback has too many headers");
    }
    return Object.fromEntries(entries.map(([rawName, rawValue]) => {
        const name = rawName.toLocaleLowerCase("en-US");
        if (
            !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(rawName)
            || forbiddenMediaHeaders.has(name)
            || name.startsWith("proxy-")
            || name.startsWith("sec-")
            || typeof rawValue !== "string"
            || rawValue.length > 8192
            || /[\r\n]/.test(rawValue)
        ) {
            throw new Error("Native playback header is not accepted");
        }
        return [rawName, rawValue];
    })) as Record<string, string>;
}

function validateCommand(value: unknown): NativePlaybackRuntimeCommand {
    assertPlainObject(value, "native playback command");
    assertIpcPayload(value, 64 * 1024);
    assertString(value.operation, "native playback operation", 32);
    const sourceId = validateSourceId(value.sourceId);
    switch (value.operation) {
        case "load": {
            const source = resolveNativeSource(value.url);
            return {
                operation: "load",
                sourceId,
                url: source.value,
                sourceType: source.sourceType,
                ...(value.headers !== undefined
                    ? { headers: validateHeaders(value.headers) }
                    : {}),
            };
        }
        case "play":
        case "pause":
        case "stop":
            return { operation: value.operation, sourceId };
        case "seek":
            assertFiniteNumber(value.seconds, "native playback seek time", 0, 7 * 24 * 3600);
            return { operation: "seek", sourceId, seconds: value.seconds };
        case "volume":
            assertFiniteNumber(value.volume, "native playback volume", 0, 1);
            return { operation: "volume", sourceId, volume: value.volume };
        case "speed":
            assertFiniteNumber(value.speed, "native playback speed", 0.25, 4);
            return { operation: "speed", sourceId, speed: value.speed };
        case "pitch":
            assertFiniteNumber(value.semitones, "native playback pitch", -12, 12);
            return { operation: "pitch", sourceId, semitones: value.semitones };
        case "loop":
            assertBoolean(value.enabled, "native playback loop state");
            return { operation: "loop", sourceId, enabled: value.enabled };
        case "output-device":
            assertString(value.deviceId, "native playback output device", 512, true);
            return { operation: "output-device", sourceId, deviceId: value.deviceId };
        case "audio-exclusive":
            assertBoolean(value.enabled, "native playback audio exclusive state");
            return { operation: "audio-exclusive", sourceId, enabled: value.enabled };
        default:
            throw new Error("Native playback operation is not supported");
    }
}

function validateVideoSource(value: unknown): ValidatedNativeVideoSource {
    assertPlainObject(value, "native video source");
    assertString(value.key, "native video source key", 64);
    assertString(value.label, "native video source label", 256);
    assertString(value.url, "native video source URL", 32_768);
    const source = resolveNativeSource(normalizeVideoUpstreamUrl(value.url));
    const backupUrls = value.backupUrls === undefined
        ? []
        : (() => {
            if (!Array.isArray(value.backupUrls) || value.backupUrls.length > 4) {
                throw new Error("Native video backup sources are invalid");
            }
            return value.backupUrls.map((url) => {
                assertString(url, "native video backup source URL", 32_768);
                return resolveNativeSource(normalizeVideoUpstreamUrl(url)).value;
            });
        })();
    const optionalNumber = (name: "width" | "height") => {
        if (value[name] === undefined) return undefined;
        assertFiniteNumber(value[name], `native video ${name}`, 1, 32_768);
        return value[name];
    };
    const dynamicRange = value.dynamicRange;
    if (
        dynamicRange !== undefined
        && dynamicRange !== "sdr"
        && dynamicRange !== "hdr10"
        && dynamicRange !== "dolby-vision"
    ) {
        throw new Error("Native video dynamic range is invalid");
    }
    return {
        key: value.key,
        label: value.label,
        url: source.value,
        sourceType: source.sourceType,
        backupUrls,
        headers: validateHeaders(value.headers),
        width: optionalNumber("width"),
        height: optionalNumber("height"),
        dynamicRange,
    };
}

function validateVideoSources(value: unknown) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
        throw new Error("Native video sources are invalid");
    }
    const seen = new Set<string>();
    return value.map((entry) => {
        const source = validateVideoSource(entry);
        if (seen.has(source.key)) {
            throw new Error("Native video source keys must be unique");
        }
        seen.add(source.key);
        return source;
    });
}

function validateVideoSurfaceBounds(value: unknown): INativeVideoSurfaceBounds {
    assertPlainObject(value, "native video surface bounds");
    assertFiniteNumber(value.x, "native video surface x", -32_768, 32_768);
    assertFiniteNumber(value.y, "native video surface y", -32_768, 32_768);
    assertFiniteNumber(value.width, "native video surface width", 1, 32_768);
    assertFiniteNumber(value.height, "native video surface height", 1, 32_768);
    assertFiniteNumber(value.borderRadius, "native video surface border radius", 0, 16_384);
    return {
        x: Math.round(value.x),
        y: Math.round(value.y),
        width: Math.round(value.width),
        height: Math.round(value.height),
        borderRadius: Math.round(value.borderRadius),
    };
}

function validateVideoSurfaceUpdate(value: unknown): INativeVideoSurfaceUpdate {
    assertPlainObject(value, "native video surface update");
    assertIpcPayload(value, 8 * 1024);
    assertBoolean(value.visible, "native video surface visibility");
    return {
        sourceId: validateSourceId(value.sourceId),
        bounds: validateVideoSurfaceBounds(value.bounds),
        visible: value.visible,
    };
}

function validateVideoCommand(value: unknown): NativeVideoCommand {
    assertPlainObject(value, "native video command");
    assertIpcPayload(value, 8 * 1024);
    assertString(value.operation, "native video operation", 32);
    const sourceId = validateSourceId(value.sourceId);
    switch (value.operation) {
        case "play":
        case "pause":
            return { operation: value.operation, sourceId };
        case "seek":
            assertFiniteNumber(value.seconds, "native video seek time", 0, 7 * 24 * 3600);
            return { operation: "seek", sourceId, seconds: value.seconds };
        case "volume":
            assertFiniteNumber(value.volume, "native video volume", 0, 1);
            return { operation: "volume", sourceId, volume: value.volume };
        case "speed":
            assertFiniteNumber(value.speed, "native video speed", 0.25, 4);
            return { operation: "speed", sourceId, speed: value.speed };
        default:
            throw new Error("Native video operation is not supported");
    }
}

function validateVideoSourceSelect(value: unknown): INativeVideoSourceSelect {
    assertPlainObject(value, "native video source selection");
    assertIpcPayload(value, 8 * 1024);
    assertString(value.sourceKey, "native video source key", 64);
    return {
        sourceId: validateSourceId(value.sourceId),
        sourceKey: value.sourceKey,
    };
}

function validateVideoOpenRequest(value: unknown): ValidatedNativeVideoOpenRequest {
    assertPlainObject(value, "native video open request");
    assertIpcPayload(value, 256 * 1024);
    const sourceId = validateSourceId(value.sourceId);
    assertString(value.title, "native video title", 512);
    assertString(value.artist, "native video artist", 512, true);
    assertString(value.album, "native video album", 512, true);
    assertString(value.artwork, "native video artwork", 32_768, true);
    assertString(value.appMediaId, "native video media id", 512);
    assertString(value.initialSourceKey, "native video initial source key", 64);
    assertFiniteNumber(value.volume, "native video volume", 0, 1);
    const sources = validateVideoSources(value.sources);
    if (!sources.some((source) => source.key === value.initialSourceKey)) {
        throw new Error("Native video initial source is missing");
    }
    return {
        sourceId,
        title: value.title,
        artist: value.artist,
        album: value.album,
        artwork: value.artwork,
        appMediaId: value.appMediaId,
        sources,
        initialSourceKey: value.initialSourceKey,
        volume: value.volume,
        surface: (() => {
            assertPlainObject(value.surface, "native video surface");
            assertBoolean(value.surface.visible, "native video surface visibility");
            return {
                bounds: validateVideoSurfaceBounds(value.surface.bounds),
                visible: value.surface.visible,
            };
        })(),
    };
}

function validateVideoSourcesUpdate(value: unknown): INativeVideoSourcesUpdate & {
    sources: ValidatedNativeVideoSource[];
} {
    assertPlainObject(value, "native video source update");
    assertIpcPayload(value, 256 * 1024);
    return {
        sourceId: validateSourceId(value.sourceId),
        sources: validateVideoSources(value.sources),
    };
}

function getNativeWindowId(window: BaseWindow) {
    const handle = window.getNativeWindowHandle();
    if (handle.length >= 8) {
        return handle.readBigUInt64LE(0).toString();
    }
    if (handle.length >= 4) {
        return String(handle.readUInt32LE(0));
    }
    throw new Error("Native video window handle is invalid");
}

interface VideoHostWindow {
    destroy: () => void;
    getNativeWindowId: () => string;
    hide: () => void;
    isDestroyed: () => boolean;
    onClosed: (callback: () => void) => void;
    setBounds: (bounds: INativeVideoSurfaceBounds) => void;
    showInactive: () => void;
}

class ElectronVideoHostWindow implements VideoHostWindow {
    constructor(private readonly window: BaseWindow) {}

    destroy() {
        this.window.destroy();
    }

    getNativeWindowId() {
        return getNativeWindowId(this.window);
    }

    hide() {
        this.window.hide();
    }

    isDestroyed() {
        return this.window.isDestroyed();
    }

    onClosed(callback: () => void) {
        this.window.on("closed", callback);
    }

    setBounds(bounds: INativeVideoSurfaceBounds) {
        const parent = this.window.getParentWindow();
        if (!parent || parent.isDestroyed()) return;
        const contentBounds = parent.getContentBounds();
        this.window.setBounds({
            x: contentBounds.x + bounds.x,
            y: contentBounds.y + bounds.y,
            width: bounds.width,
            height: bounds.height,
        }, false);
    }

    showInactive() {
        this.window.showInactive();
    }
}

interface Win32WindowApi {
    createRoundRectRegion: (
        left: number,
        top: number,
        right: number,
        bottom: number,
        ellipseWidth: number,
        ellipseHeight: number,
    ) => number | bigint;
    createWindow: (...args: any[]) => number | bigint;
    deleteObject: (object: number | bigint) => number;
    destroyWindow: (window: number | bigint) => number;
    getModuleHandle: (name: string | null) => number | bigint;
    setWindowPos: (
        window: number | bigint,
        insertAfter: number | bigint,
        x: number,
        y: number,
        width: number,
        height: number,
        flags: number,
    ) => number;
    setWindowRegion: (
        window: number | bigint,
        region: number | bigint,
        redraw: number,
    ) => number;
    showWindow: (window: number | bigint, command: number) => number;
}

let win32WindowApi: Win32WindowApi | null = null;

function getWin32WindowApi(): Win32WindowApi {
    if (win32WindowApi) return win32WindowApi;
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const gdi32 = koffi.load("gdi32.dll");
    win32WindowApi = {
        createRoundRectRegion: gdi32.func(
            "uintptr_t __stdcall CreateRoundRectRgn(int, int, int, int, int, int)",
        ),
        createWindow: user32.func(
            "uintptr_t __stdcall CreateWindowExW(uint32_t, str16, str16, uint32_t, int, int, int, int, uintptr_t, uintptr_t, uintptr_t, void *)",
        ),
        deleteObject: gdi32.func("int __stdcall DeleteObject(uintptr_t)"),
        destroyWindow: user32.func("int __stdcall DestroyWindow(uintptr_t)"),
        getModuleHandle: kernel32.func("uintptr_t __stdcall GetModuleHandleW(str16)"),
        setWindowPos: user32.func(
            "int __stdcall SetWindowPos(uintptr_t, uintptr_t, int, int, int, int, uint32_t)",
        ),
        setWindowRegion: user32.func(
            "int __stdcall SetWindowRgn(uintptr_t, uintptr_t, int)",
        ),
        showWindow: user32.func("int __stdcall ShowWindow(uintptr_t, int)"),
    };
    return win32WindowApi;
}

/**
 * mpv's Win32 `wid` output is obscured by Electron's compositor when the
 * target is an Electron BaseWindow. A separate popup HWND directly below the
 * transparent BrowserWindow lets libmpv present D3D11 frames while Chromium
 * paints the interactive player chrome above it.
 */
class Win32VideoHostWindow implements VideoHostWindow {
    private readonly api = getWin32WindowApi();
    private readonly parentWindow: bigint;
    private readonly window: number | bigint;
    private destroyed = false;
    private closedCallback: (() => void) | null = null;
    private bounds: INativeVideoSurfaceBounds;

    constructor(
        private readonly parent: BrowserWindow,
        bounds: INativeVideoSurfaceBounds,
        initiallyVisible = false,
    ) {
        this.bounds = bounds;
        const parentHandle = parent.getNativeWindowHandle();
        this.parentWindow = parentHandle.length >= 8
            ? parentHandle.readBigUInt64LE(0)
            : BigInt(parentHandle.readUInt32LE(0));
        const windowStyle = 0x80000000 // WS_POPUP: independent D3D surface behind Chromium.
            + (initiallyVisible ? 0x10000000 : 0) // WS_VISIBLE: only after the cutout is ready.
            + 0x08000000 // WS_DISABLED: all input stays in the renderer overlay.
            + 0x00000004; // SS_BLACKRECT
        const extendedStyle = 0x08000000 // WS_EX_NOACTIVATE
            | 0x00000080 // WS_EX_TOOLWINDOW: keep the surface out of Alt+Tab/taskbar.
            | 0x00000020; // WS_EX_TRANSPARENT
        this.window = this.api.createWindow(
            extendedStyle,
            "STATIC",
            "",
            windowStyle,
            0,
            0,
            1,
            1,
            0,
            0,
            this.api.getModuleHandle(null),
            null,
        );
        if (!this.window) {
            throw new Error("Native Win32 video surface creation failed");
        }
        this.setBounds(bounds, initiallyVisible);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.api.destroyWindow(this.window);
        this.closedCallback?.();
    }

    getNativeWindowId() {
        return String(this.window);
    }

    hide() {
        if (!this.destroyed) this.api.showWindow(this.window, 0); // SW_HIDE
    }

    isDestroyed() {
        return this.destroyed;
    }

    onClosed(callback: () => void) {
        this.closedCallback = callback;
    }

    setBounds(bounds: INativeVideoSurfaceBounds, show = false) {
        if (this.destroyed) return;
        this.bounds = bounds;
        if (this.parent.isDestroyed()) return;
        const contentBounds = this.parent.getContentBounds();
        const physicalBounds = screen.dipToScreenRect(this.parent, {
            x: contentBounds.x + bounds.x,
            y: contentBounds.y + bounds.y,
            width: bounds.width,
            height: bounds.height,
        });
        this.api.setWindowPos(
            this.window,
            this.parentWindow,
            physicalBounds.x,
            physicalBounds.y,
            physicalBounds.width,
            physicalBounds.height,
            0x0010 | (show ? 0x0040 : 0), // SWP_NOACTIVATE | optional SWP_SHOWWINDOW
        );
        const scale = physicalBounds.width / bounds.width;
        const radius = Math.max(0, Math.round(bounds.borderRadius * scale));
        if (radius === 0) {
            this.api.setWindowRegion(this.window, 0, 1);
            return;
        }
        const region = this.api.createRoundRectRegion(
            0,
            0,
            physicalBounds.width,
            physicalBounds.height,
            radius * 2,
            radius * 2,
        );
        if (!region) return;
        if (!this.api.setWindowRegion(this.window, region, 1)) {
            this.api.deleteObject(region);
        }
    }

    showInactive() {
        this.setBounds(this.bounds, true);
    }
}

class NativePlaybackManager {
    private child: UtilityProcess | null = null;
    private spawnPromise: Promise<void> | null = null;
    private pending = new Map<string, PendingRequest>();
    private requestCounter = 0;
    private resourceTimer: NodeJS.Timeout | null = null;
    private videoChild: UtilityProcess | null = null;
    private videoWindow: VideoHostWindow | null = null;
    private videoResourceTimer: NodeJS.Timeout | null = null;
    private videoWindowPriming = false;
    private videoOverlaySourceId = "";
    private videoSourceId = "";
    private videoSources: ValidatedNativeVideoSource[] = [];
    private videoActiveSourceKey = "";
    private videoActiveUrlIndex = 0;
    private videoSpeed = 1;
    private videoSurface: Omit<INativeVideoSurfaceUpdate, "sourceId"> | null = null;
    private videoLastSnapshot: INativePlaybackSnapshot | null = null;
    private videoFallbackPending = false;
    private videoReportedError = "";
    private videoClosedPromise: Promise<void> | null = null;
    private resolveVideoClosed: (() => void) | null = null;
    private windowManager!: IWindowManager;
    private shuttingDown = false;
    /** 最近一次 load 的 sourceId：renderer 消失后主进程要靠它停掉遗留音频。 */
    private activeSourceId = "";

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;
        messageBus.onAppStateChange((_state, patch) => {
            if ("musicItem" in patch) {
                systemMediaControls.setMusicItem(patch.musicItem ?? null);
            }
            if ("repeatMode" in patch && patch.repeatMode) {
                systemMediaControls.setRepeatMode(patch.repeatMode);
            }
        });
        windowManager.on("WindowCreated", (data) => {
            if (data.windowName === "mv") {
                this.observeVideoOverlayWindowLifecycle(data.browserWindow);
                return;
            }
            if (data.windowName !== "main") {
                return;
            }
            systemMediaControls.attachWindow(
                data.browserWindow,
                (event) => this.handleSystemMediaAction(event),
            );
            systemMediaControls.setMusicItem(messageBus.getAppState().musicItem ?? null);
            const repeatMode = messageBus.getAppState().repeatMode;
            if (repeatMode) {
                systemMediaControls.setRepeatMode(repeatMode);
            }
            this.observeMainWindowLifecycle(data.browserWindow);
        });
        ipcMain.handle("@shared/native-playback/capabilities", (event) => {
            assertIpcSender(event, ["main"]);
            return this.getCapabilities();
        });
        ipcMain.handle("@shared/native-playback/list-audio-devices", (event) => {
            assertIpcSender(event, ["main"]);
            return this.listAudioDevices();
        });
        ipcMain.handle("@shared/native-playback/command", async (event, command) => {
            assertIpcSender(event, ["main"]);
            const validated = validateCommand(command);
            if (validated.operation === "load") {
                this.activeSourceId = validated.sourceId;
            }
            const result = await this.request("command", validated);
            if (validated.operation === "stop" && validated.sourceId === this.activeSourceId) {
                this.activeSourceId = "";
            }
            return result;
        });
        ipcMain.handle("@shared/native-playback/open-video", async (event, value) => {
            assertIpcSender(event, ["mv"]);
            await this.openVideo(validateVideoOpenRequest(value));
        });
        ipcMain.handle("@shared/native-playback/prepare-video-overlay", (event, sourceId) => {
            assertIpcSender(event, ["mv"]);
            this.prepareVideoOverlay(validateSourceId(sourceId));
        });
        ipcMain.handle("@shared/native-playback/update-video-sources", (event, value) => {
            assertIpcSender(event, ["mv"]);
            this.updateVideoSources(validateVideoSourcesUpdate(value));
        });
        ipcMain.handle("@shared/native-playback/select-video-source", async (event, value) => {
            assertIpcSender(event, ["mv"]);
            await this.selectVideoSource(validateVideoSourceSelect(value));
        });
        ipcMain.handle("@shared/native-playback/video-command", async (event, value) => {
            assertIpcSender(event, ["mv"]);
            await this.commandVideo(validateVideoCommand(value));
        });
        ipcMain.handle("@shared/native-playback/update-video-surface", (event, value) => {
            assertIpcSender(event, ["mv"]);
            this.updateVideoSurface(validateVideoSurfaceUpdate(value));
        });
        ipcMain.handle("@shared/native-playback/close-video", async (event, sourceId) => {
            assertIpcSender(event, ["mv"]);
            await this.closeVideo(validateSourceId(sourceId));
        });
        app.on("before-quit", () => this.dispose());
    }

    /**
     * renderer 重新导航或崩溃后，utility 里的旧 source 还在出声，而新的
     * LibmpvAudioController 没有 sourceId —— pause/seek/reset 全是空操作，
     * 协议里也没有无 sourceId 的全局 stop，UI 因此再也停不下这段音频。
     * 所以由主进程记住当前 sourceId 并主动停掉。
     */
    private observeMainWindowLifecycle(browserWindow: BrowserWindow) {
        const { webContents } = browserWindow;
        webContents.on("did-start-navigation", (details) => {
            if (details.isMainFrame && !details.isSameDocument) {
                this.stopOrphanedMedia();
            }
        });
        webContents.on("render-process-gone", () => this.stopOrphanedMedia());
        const syncVideoSurface = () => this.syncVideoWindowBounds();
        browserWindow.on("move", syncVideoSurface);
        browserWindow.on("resize", syncVideoSurface);
        browserWindow.on("restore", syncVideoSurface);
        browserWindow.on("show", syncVideoSurface);
        browserWindow.on("focus", syncVideoSurface);
        browserWindow.on("hide", () => this.videoWindow?.hide());
        browserWindow.on("minimize", () => this.videoWindow?.hide());
        browserWindow.on("closed", () => {
            this.stopOrphanedMedia();
            systemMediaControls.dispose();
        });
    }

    private observeVideoOverlayWindowLifecycle(browserWindow: BrowserWindow) {
        const syncVideoSurface = () => this.syncVideoWindowBounds();
        browserWindow.on("move", syncVideoSurface);
        browserWindow.on("resize", syncVideoSurface);
        browserWindow.on("show", syncVideoSurface);
        browserWindow.on("focus", syncVideoSurface);
        browserWindow.on("hide", () => this.videoWindow?.hide());
        browserWindow.webContents.on("render-process-gone", () => this.beginVideoClose());
        browserWindow.on("closed", () => this.beginVideoClose());
    }

    private handleSystemMediaAction(event: SystemMediaAction) {
        if (event.action === "raise") {
            this.windowManager.showMainWindow();
            return;
        }
        if (event.action === "quit") {
            app.quit();
            return;
        }
        if (event.action === "repeat") {
            messageBus.sendCommand("SetRepeatMode", event.mode);
            return;
        }
        if (this.videoSourceId) {
            if (!this.videoChild) {
                return;
            }
            let command: NativeVideoCommand | null = null;
            if (event.action === "seek") {
                command = {
                    operation: "seek" as const,
                    sourceId: this.videoSourceId,
                    seconds: event.position,
                };
            } else if (event.action === "volume") {
                command = {
                    operation: "volume" as const,
                    sourceId: this.videoSourceId,
                    volume: event.volume,
                };
            } else if (event.action === "rate") {
                command = {
                    operation: "speed" as const,
                    sourceId: this.videoSourceId,
                    speed: event.rate,
                };
            } else if (event.action === "play" || event.action === "pause") {
                command = {
                    operation: event.action,
                    sourceId: this.videoSourceId,
                };
            }
            if (event.action === "stop") {
                void this.stopVideoFromSystemControls();
                return;
            }
            if (command) {
                void this.commandVideo(command).catch((error) => {
                    logger.logError(
                        "System media controls video command failed",
                        error instanceof Error ? error : new Error(String(error)),
                    );
                });
            }
            return;
        }
        switch (event.action) {
            case "play":
                messageBus.sendCommand("ResumePlayback");
                break;
            case "pause":
                messageBus.sendCommand("PausePlayback");
                break;
            case "stop":
                messageBus.sendCommand("PausePlayback");
                messageBus.sendCommand("SeekPlayback", 0);
                break;
            case "next":
                messageBus.sendCommand("SkipToNext");
                break;
            case "previous":
                messageBus.sendCommand("SkipToPrevious");
                break;
            case "seek":
                messageBus.sendCommand("SeekPlayback", event.position);
                break;
            case "volume":
                messageBus.sendCommand("SetPlaybackVolume", event.volume);
                break;
            case "rate":
                messageBus.sendCommand("SetPlaybackRate", event.rate);
                break;
        }
    }

    private async stopVideoFromSystemControls() {
        const sourceId = this.videoSourceId;
        if (!sourceId || !this.videoChild) return;
        try {
            await this.commandVideo({ operation: "pause", sourceId });
            await this.commandVideo({ operation: "seek", sourceId, seconds: 0 });
        } catch (error) {
            logger.logError(
                "System media controls video stop failed",
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    private stopOrphanedMedia() {
        systemMediaControls.resetMedia();
        this.beginVideoClose();
        const sourceId = this.activeSourceId;
        if (!sourceId || !this.child?.pid) {
            return;
        }
        this.activeSourceId = "";
        void this.request("command", { operation: "stop", sourceId })
            .catch(() => undefined);
    }

    private async getCapabilities(): Promise<INativePlaybackCapabilities> {
        if (!hasNativePlaybackRuntime()) {
            return {
                available: false,
                engine: "libmpv",
                systemMediaControls: systemMediaControls.available,
                systemMediaControlsActive: systemMediaControls.active,
            };
        }
        const capabilities = await this.request(
            "capabilities",
            null,
        ) as INativePlaybackCapabilities;
        return {
            ...capabilities,
            systemMediaControls: systemMediaControls.available,
            systemMediaControlsActive: systemMediaControls.active,
        };
    }

    private async listAudioDevices(): Promise<INativeAudioOutputDevice[]> {
        if (!hasNativePlaybackRuntime()) {
            return [{ id: "auto", description: "Default" }];
        }
        try {
            const devices = await this.request("list-audio-devices", null) as INativeAudioOutputDevice[];
            if (Array.isArray(devices) && devices.length) {
                return devices;
            }
        } catch (error) {
            logger.logError("list native audio devices failed", error instanceof Error ? error : new Error(String(error)));
        }
        return [{ id: "auto", description: "Default" }];
    }

    private createVideoWindow(request: ValidatedNativeVideoOpenRequest) {
        const parent = this.windowManager.mvWindow;
        if (!parent || parent.isDestroyed()) {
            throw new Error("MV overlay window is not available");
        }
        const bounds = request.surface.bounds;
        let window: VideoHostWindow;
        if (process.platform === "win32") {
            window = new Win32VideoHostWindow(parent, bounds, request.surface.visible);
        } else {
            const contentBounds = parent.getContentBounds();
            const baseWindow = new BaseWindow({
                parent,
                x: contentBounds.x + bounds.x,
                y: contentBounds.y + bounds.y,
                width: bounds.width,
                height: bounds.height,
                show: false,
                useContentSize: true,
                backgroundColor: "#000000",
                title: request.title,
                frame: false,
                resizable: false,
                movable: false,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                skipTaskbar: true,
                thickFrame: false,
                hasShadow: false,
                roundedCorners: false,
            });
            baseWindow.setIgnoreMouseEvents(true, { forward: true });
            window = new ElectronVideoHostWindow(baseWindow);
        }
        window.onClosed(() => {
            if (this.videoWindow === window) {
                this.videoWindow = null;
                this.videoChild?.kill();
                if (!this.videoChild) this.finalizeVideoClose();
            }
        });
        return window;
    }

    private syncVideoWindowBounds() {
        const window = this.videoWindow;
        const surface = this.videoSurface;
        const parent = this.windowManager.mvWindow;
        if (!window || window.isDestroyed() || !surface || !parent || parent.isDestroyed()) {
            return;
        }
        if (
            (!surface.visible && !this.videoWindowPriming)
            || !parent.isVisible()
            || parent.isMinimized()
        ) {
            window.hide();
            return;
        }
        window.setBounds(surface.bounds);
        window.showInactive();
    }

    private async spawnVideoHost(window: VideoHostWindow) {
        if (!hasNativePlaybackRuntime()) {
            throw new Error("libmpv with LibreMPEG runtime is not installed");
        }
        const runtimeDirectory = getMpvRuntimeDirectory();
        const child = utilityProcess.fork(
            path.resolve(__dirname, "native_playback_host.js"),
            [],
            {
                serviceName: "BakaMusic libmpv Video",
                execArgv: ["--max-old-space-size=256"],
                env: {
                    ...createPlaybackEnvironment(),
                    BAKAMUSIC_MPV_DIR: runtimeDirectory,
                    BAKAMUSIC_MPV_WID: window.getNativeWindowId(),
                    PATH: `${runtimeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
                },
                stdio: "pipe",
            },
        );
        this.videoChild = child;
        child.on("message", (message) => this.handleVideoMessage(child, message));
        child.on("exit", (code) => {
            if (this.videoChild !== child) return;
            this.videoChild = null;
            this.stopVideoResourceMonitor();
            this.rejectPending(
                new Error(`libmpv video runtime exited with code ${code}`),
                child,
            );
            const windowToClose = this.videoWindow;
            if (windowToClose && !windowToClose.isDestroyed()) windowToClose.destroy();
            if (!this.videoWindow) this.finalizeVideoClose();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8").trim();
            if (text) logger.logInfo("libmpv video runtime", text);
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("libmpv video runtime startup timed out")),
                10_000,
            );
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`libmpv video runtime exited during startup (${code})`));
            });
        });
        this.startVideoResourceMonitor(child);
        return child;
    }

    private startVideoResourceMonitor(child: UtilityProcess) {
        this.stopVideoResourceMonitor();
        this.videoResourceTimer = setInterval(() => {
            if (!child.pid || this.videoChild !== child) return;
            const metric = app.getAppMetrics().find((item) => item.pid === child.pid);
            if (metric && metric.memory.workingSetSize > MAX_RUNTIME_WORKING_SET_KB) {
                logger.logError(
                    "libmpv video runtime memory limit exceeded",
                    new Error(`${metric.memory.workingSetSize} KiB`),
                );
                child.kill();
            }
        }, 5_000);
        this.videoResourceTimer.unref();
    }

    private stopVideoResourceMonitor() {
        if (this.videoResourceTimer) {
            clearInterval(this.videoResourceTimer);
            this.videoResourceTimer = null;
        }
    }

    private getVideoSourceCommand(
        source: ValidatedNativeVideoSource,
        urlIndex: number,
    ): NativePlaybackRuntimeCommand {
        const url = urlIndex === 0 ? source.url : source.backupUrls[urlIndex - 1];
        if (!url) throw new Error("Native video source URL is missing");
        return {
            operation: "load",
            sourceId: this.videoSourceId,
            url,
            sourceType: source.sourceType,
            headers: source.sourceType === "location" ? source.headers : undefined,
        };
    }

    private async loadVideoSource(
        source: ValidatedNativeVideoSource,
        urlIndex: number,
        resumeTime = 0,
        autoPlay = true,
    ) {
        const child = this.videoChild;
        if (!child) throw new Error("libmpv video runtime is not running");
        this.videoFallbackPending = true;
        this.videoReportedError = "";
        try {
            await this.requestRaw(child, "command", this.getVideoSourceCommand(source, urlIndex));
            await this.requestRaw(child, "command", {
                operation: "speed",
                sourceId: this.videoSourceId,
                speed: this.videoSpeed,
            } satisfies NativePlaybackRuntimeCommand);
            if (resumeTime > 0) {
                await this.requestRaw(child, "command", {
                    operation: "seek",
                    sourceId: this.videoSourceId,
                    seconds: resumeTime,
                } satisfies NativePlaybackRuntimeCommand);
            }
            if (autoPlay) {
                await this.requestRaw(child, "command", {
                    operation: "play",
                    sourceId: this.videoSourceId,
                } satisfies NativePlaybackRuntimeCommand);
            }
            this.videoActiveSourceKey = source.key;
            this.videoActiveUrlIndex = urlIndex;
        } finally {
            this.videoFallbackPending = false;
        }
    }

    private async switchVideoSource(sourceKey: string) {
        if (sourceKey === this.videoActiveSourceKey || this.videoFallbackPending) return;
        const source = this.videoSources.find((item) => item.key === sourceKey);
        if (!source) throw new Error("Native video source is unavailable");
        const resumeTime = this.videoLastSnapshot?.currentTime ?? 0;
        const autoPlay = this.videoLastSnapshot?.state === "playing"
            || this.videoLastSnapshot?.state === "buffering";
        await this.loadVideoSource(source, 0, resumeTime, autoPlay);
    }

    private async openVideo(request: ValidatedNativeVideoOpenRequest) {
        if (this.videoSourceId) {
            throw new Error("A native video window is already open");
        }
        this.prepareVideoOverlay(request.sourceId);
        this.videoSourceId = request.sourceId;
        this.videoSources = request.sources;
        this.videoActiveSourceKey = request.initialSourceKey;
        this.videoActiveUrlIndex = 0;
        this.videoSpeed = 1;
        this.videoWindowPriming = false;
        this.videoSurface = request.surface;
        this.videoLastSnapshot = null;
        this.videoReportedError = "";
        systemMediaControls.beginVideo({
            title: request.title,
            artist: request.artist,
            album: request.album,
            artwork: request.artwork,
            appMediaId: request.appMediaId,
        });
        this.videoClosedPromise = new Promise<void>((resolve) => {
            this.resolveVideoClosed = resolve;
        });
        try {
            const window = this.createVideoWindow(request);
            this.videoWindow = window;
            const child = await this.spawnVideoHost(window);
            if (process.platform === "win32") {
                // A hidden D3D target exposes its STATIC class brush for one
                // present when first shown. Prime the HWND behind Chromium's
                // still-opaque player canvas so libmpv owns a populated swap
                // chain before the renderer cuts the transparent viewport.
                this.videoWindowPriming = true;
                this.syncVideoWindowBounds();
            }
            const source = request.sources.find(
                (item) => item.key === request.initialSourceKey,
            ) ?? request.sources[0];
            await this.loadVideoSource(source, 0, 0, false);
            await this.requestRaw(child, "command", {
                operation: "volume",
                sourceId: request.sourceId,
                volume: request.volume,
            } satisfies NativePlaybackRuntimeCommand);
            await this.requestRaw(child, "command", {
                operation: "play",
                sourceId: request.sourceId,
            } satisfies NativePlaybackRuntimeCommand);
            this.syncVideoWindowBounds();
        } catch (error) {
            this.beginVideoClose();
            throw error;
        }
    }

    private updateVideoSources(update: INativeVideoSourcesUpdate & {
        sources: ValidatedNativeVideoSource[];
    }) {
        if (update.sourceId !== this.videoSourceId) {
            throw new Error("Native video source update is stale");
        }
        if (!update.sources.some((source) => source.key === this.videoActiveSourceKey)) {
            throw new Error("Native video source update omits the active source");
        }
        this.videoSources = update.sources;
    }

    private async selectVideoSource(selection: INativeVideoSourceSelect) {
        if (selection.sourceId !== this.videoSourceId) {
            throw new Error("Native video source selection is stale");
        }
        await this.switchVideoSource(selection.sourceKey);
    }

    private async commandVideo(command: NativeVideoCommand) {
        if (command.sourceId !== this.videoSourceId || !this.videoChild) {
            throw new Error("Native video command is stale");
        }
        await this.requestRaw(this.videoChild, "command", command);
        if (command.operation === "speed") {
            this.videoSpeed = command.speed;
        }
    }

    private updateVideoSurface(update: INativeVideoSurfaceUpdate) {
        if (update.sourceId !== this.videoSourceId) {
            throw new Error("Native video surface update is stale");
        }
        this.videoSurface = {
            bounds: update.bounds,
            visible: update.visible,
        };
        this.videoWindowPriming = false;
        this.syncVideoWindowBounds();
    }

    private beginVideoClose() {
        const window = this.videoWindow;
        if (window && !window.isDestroyed()) {
            // Remove the native surface from the z-order before destroying its
            // HWND. DWM may otherwise present the last decoded frame for one
            // compositor tick while the renderer modal is being removed.
            window.hide();
            window.destroy();
        } else this.videoWindow = null;
        if (this.videoChild) this.videoChild.kill();
        else this.finalizeVideoClose();
    }

    private async closeVideo(sourceId: string) {
        if (!this.videoSourceId) {
            this.releaseVideoOverlay(sourceId);
            return;
        }
        if (sourceId !== this.videoSourceId) return;
        const closed = this.videoClosedPromise;
        this.beginVideoClose();
        await closed;
    }

    private prepareVideoOverlay(sourceId: string) {
        if (
            (this.videoOverlaySourceId && this.videoOverlaySourceId !== sourceId)
            || (this.videoSourceId && this.videoSourceId !== sourceId)
        ) {
            throw new Error("Another native video overlay is already active");
        }
        this.videoOverlaySourceId = sourceId;
    }

    private releaseVideoOverlay(sourceId: string) {
        if (sourceId !== this.videoOverlaySourceId) return;
        this.videoOverlaySourceId = "";
    }

    private finalizeVideoClose() {
        const sourceId = this.videoSourceId;
        if (!sourceId) return;
        this.videoSourceId = "";
        this.videoSources = [];
        this.videoActiveSourceKey = "";
        this.videoActiveUrlIndex = 0;
        this.videoSpeed = 1;
        this.videoWindowPriming = false;
        this.videoSurface = null;
        this.videoLastSnapshot = null;
        this.videoFallbackPending = false;
        this.videoReportedError = "";
        systemMediaControls.endVideo();
        const resolve = this.resolveVideoClosed;
        this.resolveVideoClosed = null;
        this.videoClosedPromise = null;
        resolve?.();
        this.releaseVideoOverlay(sourceId);
        const mvWindow = this.windowManager.mvWindow;
        if (mvWindow && !mvWindow.isDestroyed()) {
            mvWindow.webContents.send("@shared/native-playback/video-event", {
                sourceId,
                type: "closed",
            });
        }
    }

    private async ensureStarted() {
        if (this.child?.pid) {
            return;
        }
        if (this.spawnPromise) {
            return this.spawnPromise;
        }
        this.spawnPromise = this.spawn();
        try {
            await this.spawnPromise;
        } finally {
            this.spawnPromise = null;
        }
    }

    private async spawn() {
        if (this.shuttingDown || !hasNativePlaybackRuntime()) {
            throw new Error("libmpv with LibreMPEG runtime is not installed");
        }
        const runtimeDirectory = getMpvRuntimeDirectory();
        const child = utilityProcess.fork(
            path.resolve(__dirname, "native_playback_host.js"),
            [],
            {
                serviceName: "BakaMusic libmpv Playback",
                execArgv: ["--max-old-space-size=256"],
                env: {
                    ...createPlaybackEnvironment(),
                    BAKAMUSIC_MPV_DIR: runtimeDirectory,
                    PATH: `${runtimeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
                },
                stdio: "pipe",
            },
        );
        this.child = child;
        child.on("message", (message) => this.handleMessage(child, message));
        child.on("exit", (code) => {
            if (this.child !== child) {
                return;
            }
            this.child = null;
            this.stopResourceMonitor();
            this.rejectPending(
                new Error(`libmpv playback runtime exited with code ${code}`),
                child,
            );
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8").trim();
            if (text) {
                logger.logInfo("libmpv playback runtime", text);
            }
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("libmpv playback runtime startup timed out")),
                10_000,
            );
            child.once("spawn", () => {
                clearTimeout(timer);
                resolve();
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`libmpv playback runtime exited during startup (${code})`));
            });
        });
        this.startResourceMonitor(child);
    }

    private startResourceMonitor(child: UtilityProcess) {
        this.stopResourceMonitor();
        this.resourceTimer = setInterval(() => {
            if (!child.pid || this.child !== child) {
                return;
            }
            const metric = app.getAppMetrics().find((item) => item.pid === child.pid);
            if (metric && metric.memory.workingSetSize > MAX_RUNTIME_WORKING_SET_KB) {
                logger.logError(
                    "libmpv playback runtime memory limit exceeded",
                    new Error(`${metric.memory.workingSetSize} KiB`),
                );
                child.kill();
            }
        }, 5_000);
        this.resourceTimer.unref();
    }

    private stopResourceMonitor() {
        if (this.resourceTimer) {
            clearInterval(this.resourceTimer);
            this.resourceTimer = null;
        }
    }

    private handleMessage(child: UtilityProcess, message: any) {
        if (this.child !== child || !message || typeof message !== "object") {
            return;
        }
        if (message.type === "snapshot") {
            const bytes = payloadBytes(message.snapshot);
            if (bytes !== null && bytes <= MAX_RPC_BYTES) {
                this.sendSnapshot(message.snapshot as INativePlaybackSnapshot);
            }
            return;
        }
        this.handleResponse(child, message);
    }

    private handleVideoMessage(child: UtilityProcess, message: any) {
        if (this.videoChild !== child || !message || typeof message !== "object") return;
        if (message.type === "snapshot") {
            const snapshot = message.snapshot as INativePlaybackSnapshot;
            const bytes = payloadBytes(snapshot);
            if (bytes === null || bytes > MAX_RPC_BYTES || snapshot.sourceId !== this.videoSourceId) {
                return;
            }
            const previousState = this.videoLastSnapshot?.state;
            this.videoLastSnapshot = snapshot;
            if (snapshot.state === "error" && snapshot.error && !this.videoFallbackPending) {
                const source = this.videoSources.find(
                    (item) => item.key === this.videoActiveSourceKey,
                );
                const nextUrlIndex = this.videoActiveUrlIndex + 1;
                if (source && nextUrlIndex <= source.backupUrls.length) {
                    const autoPlay = previousState !== "paused";
                    void this.loadVideoSource(
                        source,
                        nextUrlIndex,
                        snapshot.currentTime,
                        autoPlay,
                    ).catch(
                        (error) => this.reportVideoError(
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
                } else {
                    systemMediaControls.setVideoPlaybackSnapshot(snapshot);
                    this.reportVideoError(snapshot.error);
                }
                return;
            }
            systemMediaControls.setVideoPlaybackSnapshot(snapshot);
            this.sendVideoEvent({
                sourceId: this.videoSourceId,
                type: "snapshot",
                snapshot,
            });
            return;
        }
        this.handleResponse(child, message);
    }

    private handleResponse(child: UtilityProcess, message: any) {
        if (message?.type !== "response" || typeof message.requestId !== "string") return;
        const pending = this.pending.get(message.requestId);
        if (!pending || pending.child !== child) return;
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        const bytes = payloadBytes(message);
        if (bytes === null || bytes > MAX_RPC_BYTES) {
            pending.reject(new Error("libmpv playback runtime response is invalid"));
        } else if (message.error) {
            const error = new Error(String(message.error.message ?? "libmpv runtime error"));
            error.name = String(message.error.name ?? "Error");
            error.stack = typeof message.error.stack === "string" ? message.error.stack : undefined;
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
    }

    private reportVideoError(error: string) {
        if (!error || error === this.videoReportedError) return;
        this.videoReportedError = error;
        systemMediaControls.setVideoPlaybackSnapshot({
            sourceId: this.videoSourceId,
            state: "error",
            currentTime: this.videoLastSnapshot?.currentTime ?? 0,
            duration: this.videoLastSnapshot?.duration ?? 0,
            volume: this.videoLastSnapshot?.volume ?? 0,
            speed: this.videoLastSnapshot?.speed ?? this.videoSpeed,
            error,
        });
        this.sendVideoEvent({
            sourceId: this.videoSourceId,
            type: "error",
            error,
        });
    }

    private sendVideoEvent(event: import("./common").INativeVideoEvent) {
        const mvWindow = this.windowManager.mvWindow;
        if (mvWindow && !mvWindow.isDestroyed() && event.sourceId) {
            mvWindow.webContents.send("@shared/native-playback/video-event", event);
        }
    }

    private sendSnapshot(snapshot: INativePlaybackSnapshot) {
        if (snapshot.sourceId === this.activeSourceId) {
            systemMediaControls.setPlaybackSnapshot(snapshot);
        }
        const mainWindow = this.windowManager.mainWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("@shared/native-playback/snapshot", snapshot);
        }
    }

    private rejectPending(error: Error, child?: UtilityProcess) {
        for (const [requestId, pending] of this.pending) {
            if (child && pending.child !== child) continue;
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(requestId);
        }
    }

    private requestRaw(child: UtilityProcess, operation: string, payload: unknown) {
        if (this.pending.size >= MAX_PENDING_REQUESTS) {
            throw new Error("libmpv playback concurrency limit reached");
        }
        const requestId = `mpv-${++this.requestCounter}`;
        const message = { type: "request", requestId, operation, payload };
        const bytes = payloadBytes(message);
        if (bytes === null || bytes > MAX_RPC_BYTES) {
            throw new Error("libmpv playback request is invalid");
        }
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`libmpv playback request timed out: ${operation}`));
                if (this.child === child || this.videoChild === child) {
                    child.kill();
                }
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { child, resolve, reject, timer });
            child.postMessage(message);
        });
    }

    private async request(operation: string, payload: unknown) {
        await this.ensureStarted();
        if (!this.child) {
            throw new Error("libmpv playback runtime did not start");
        }
        return this.requestRaw(this.child, operation, payload);
    }

    private dispose() {
        this.shuttingDown = true;
        systemMediaControls.dispose();
        this.stopResourceMonitor();
        this.stopVideoResourceMonitor();
        this.rejectPending(new Error("libmpv playback runtime disposed"));
        this.child?.kill();
        this.child = null;
        this.beginVideoClose();
    }
}

export default new NativePlaybackManager();
