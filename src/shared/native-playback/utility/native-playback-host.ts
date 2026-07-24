import path from "path";
import koffi from "koffi";
import type {
    INativeAudioOutputDevice,
    INativePlaybackCapabilities,
    INativePlaybackSnapshot,
    NativePlaybackRuntimeCommand,
    NativePlaybackState,
} from "../common";

interface RuntimeRequest {
    type: "request";
    requestId: string;
    operation: "capabilities" | "command" | "list-audio-devices";
    payload?: NativePlaybackRuntimeCommand;
}

interface MpvEvent {
    eventId: number;
    error: number;
    replyUserdata: number | bigint;
    data: unknown;
}

interface MpvEventEndFile {
    reason: number;
    error: number;
}

interface MpvEventLogMessage {
    prefix: string | null;
    level: string | null;
    text: string | null;
    logLevel: number;
}

interface DecoderDescription {
    codec?: unknown;
    driver?: unknown;
}

const MPV_FORMAT_FLAG = 3;
const MPV_FORMAT_DOUBLE = 5;
const MPV_EVENT_NONE = 0;
const MPV_EVENT_SHUTDOWN = 1;
const MPV_EVENT_LOG_MESSAGE = 2;
const MPV_EVENT_END_FILE = 7;
const MPV_EVENT_FILE_LOADED = 8;
const MPV_EVENT_QUEUE_OVERFLOW = 24;
const MPV_END_FILE_REASON_EOF = 0;
const MPV_END_FILE_REASON_ERROR = 4;
const MPV_ERROR_PROPERTY_UNAVAILABLE = -10;

const parentPort = process.parentPort;
const runtimeDirectory = process.env.BAKAMUSIC_MPV_DIR;
if (!runtimeDirectory) {
    throw new Error("libmpv runtime directory is missing");
}

const libraryName = process.platform === "win32"
    ? "libmpv-2.dll"
    : process.platform === "darwin"
        ? path.join("lib", "libmpv.2.dylib")
        : path.join("lib", "libmpv.so.2");
const library = koffi.load(path.join(runtimeDirectory, libraryName));
const mpvFree = library.func("mpv_free", "void", ["void *"]);
const mpvAllocatedString = koffi.disposable(
    "MpvAllocatedString",
    "str",
    mpvFree,
);
const mpvEventType = koffi.struct("mpv_event", {
    eventId: "int",
    error: "int",
    replyUserdata: "uint64_t",
    data: "void *",
});
const mpvEventEndFileType = koffi.struct("mpv_event_end_file", {
    reason: "int",
    error: "int",
    playlistEntryId: "int64_t",
    playlistInsertId: "int64_t",
    playlistInsertNumEntries: "int",
});
const mpvEventLogMessageType = koffi.struct("mpv_event_log_message", {
    prefix: "const char *",
    level: "const char *",
    text: "const char *",
    logLevel: "int",
});

const api = {
    clientApiVersion: library.func("unsigned long mpv_client_api_version(void)"),
    create: library.func("void *mpv_create(void)"),
    initialize: library.func("int mpv_initialize(void *)"),
    terminateDestroy: library.func("void mpv_terminate_destroy(void *)"),
    errorString: library.func("const char *mpv_error_string(int)"),
    setOptionString: library.func(
        "int mpv_set_option_string(void *, const char *, const char *)",
    ),
    setPropertyString: library.func(
        "int mpv_set_property_string(void *, const char *, const char *)",
    ),
    getPropertyString: library.func(
        "mpv_get_property_string",
        mpvAllocatedString,
        ["void *", "const char *"],
    ),
    getPropertyFlag: library.func(
        "mpv_get_property",
        "int",
        [
            "void *",
            "const char *",
            "int",
            koffi.out(koffi.pointer("int")),
        ],
    ),
    getPropertyDouble: library.func(
        "mpv_get_property",
        "int",
        [
            "void *",
            "const char *",
            "int",
            koffi.out(koffi.pointer("double")),
        ],
    ),
    command: library.func("int mpv_command(void *, const char **)"),
    requestLogMessages: library.func(
        "int mpv_request_log_messages(void *, const char *)",
    ),
    waitEvent: library.func("void *mpv_wait_event(void *, double)"),
};

const player = api.create();
if (!player) {
    throw new Error("libmpv initialization failed");
}

function mpvError(code: number, context: string) {
    return new Error(`${context}: ${api.errorString(code) || `mpv error ${code}`}`);
}

function checkMpv(code: number, context: string) {
    if (code < 0) {
        throw mpvError(code, context);
    }
}

function setOption(name: string, value: string) {
    checkMpv(api.setOptionString(player, name, value), `libmpv option ${name}`);
}

const bootstrapOptions: Array<[string, string]> = [
    ["config", "no"],
    ["load-scripts", "no"],
    ["terminal", "no"],
    ["input-default-bindings", "no"],
    ["input-vo-keyboard", "no"],
    ["osc", "no"],
    ["idle", "yes"],
    ["keep-open", "yes"],
    ["pause", "yes"],
    ["video", "no"],
    ["audio-display", "no"],
    // Lyrics and artwork are managed by BakaMusic. Avoid probing sibling
    // subtitle files, whose guessed legacy encoding can produce lavf warnings.
    ["autoload-files", "no"],
    ["audio-pitch-correction", "yes"],
];

// Windows: pin WASAPI and optionally open the device in exclusive mode so the
// session is not mixed by the Windows audio engine (lower latency, direct path).
const wasapiExclusiveRequested =
    process.platform === "win32"
    && process.env.BAKAMUSIC_WASAPI_EXCLUSIVE === "1";
if (process.platform === "win32") {
    bootstrapOptions.push(["ao", "wasapi"]);
    if (wasapiExclusiveRequested) {
        bootstrapOptions.push(["audio-exclusive", "yes"]);
    }
}

for (const [name, value] of bootstrapOptions) {
    setOption(name, value);
}
checkMpv(api.initialize(player), "libmpv core initialization");
checkMpv(api.requestLogMessages(player, "warn"), "libmpv log subscription");

let currentAudioDevice = "auto";

function getStringProperty(name: string) {
    const value = api.getPropertyString(player, name);
    return typeof value === "string" ? value : null;
}

function getFlagProperty(name: string, fallback = false) {
    const output = [0];
    const result = api.getPropertyFlag(player, name, MPV_FORMAT_FLAG, output);
    return result >= 0 ? output[0] !== 0 : fallback;
}

function getDoubleProperty(name: string, fallback = 0) {
    const output = [0];
    const result = api.getPropertyDouble(player, name, MPV_FORMAT_DOUBLE, output);
    return result >= 0 && Number.isFinite(output[0]) ? output[0] : fallback;
}

function getDecoderList() {
    const rawValue = getStringProperty("decoder-list");
    if (!rawValue) {
        return [];
    }
    try {
        const value = JSON.parse(rawValue) as unknown;
        return Array.isArray(value) ? value as DecoderDescription[] : [];
    } catch {
        return [];
    }
}

function listAudioDevices(): INativeAudioOutputDevice[] {
    const rawValue = getStringProperty("audio-device-list");
    if (!rawValue) {
        return [{ id: "auto", description: "Default" }];
    }
    try {
        const value = JSON.parse(rawValue) as unknown;
        if (!Array.isArray(value)) {
            return [{ id: "auto", description: "Default" }];
        }
        const devices: INativeAudioOutputDevice[] = [];
        for (const entry of value) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            const row = entry as { name?: unknown; description?: unknown };
            if (typeof row.name !== "string" || !row.name) {
                continue;
            }
            devices.push({
                id: row.name,
                description:
                    typeof row.description === "string" && row.description
                        ? row.description
                        : row.name,
            });
        }
        if (!devices.some((device) => device.id === "auto")) {
            devices.unshift({ id: "auto", description: "Default" });
        }
        return devices.length ? devices : [{ id: "auto", description: "Default" }];
    } catch {
        return [{ id: "auto", description: "Default" }];
    }
}

const decoderList = getDecoderList();
const hasAc4Decoder = decoderList.some(
    (decoder) => decoder.codec === "ac4" || decoder.driver === "ac4",
);
if (!hasAc4Decoder) {
    api.terminateDestroy(player);
    library.unload();
    throw new Error("libmpv runtime does not expose the LibreMPEG AC-4 decoder");
}

const rawClientApiVersion = Number(api.clientApiVersion());
const capabilities: INativePlaybackCapabilities = {
    available: true,
    engine: "libmpv",
    version: getStringProperty("mpv-version") ?? undefined,
    clientApiVersion: `${(rawClientApiVersion >>> 16) & 0xffff}.${rawClientApiVersion & 0xffff}`,
    mediaBackend: "librempeg",
    decoders: Array.from(new Set(decoderList.flatMap((decoder) => [
        decoder.codec,
        decoder.driver,
    ]).filter((name): name is string =>
        typeof name === "string"
        && /^(?:ac4|dsd_(?:lsbf|msbf)(?:_planar)?|dst)$/.test(name),
    ))),
};

let sourceId = "";
let loopEnabled = false;
let playbackSpeed = 1;
let volume = 1;
let lastTime = 0;
let lastDuration = 0;
let lastSnapshotKey = "";
let lastError = "";
let endedPending = false;
let pendingSeek: number | null = null;
let disposed = false;

function runCommand(...args: string[]) {
    checkMpv(api.command(player, [...args, null]), `libmpv command ${args[0]}`);
}

function setProperty(name: string, value: string) {
    checkMpv(api.setPropertyString(player, name, value), `libmpv property ${name}`);
}

function escapeMpvListValue(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

function applyRequestHeaders(headers?: Record<string, string>) {
    const fields = Object.entries(headers ?? {}).map(
        ([name, value]) => escapeMpvListValue(`${name}: ${value}`),
    );
    setProperty("http-header-fields", fields.join(","));
}

function applyPitch(semitones: number) {
    const normalized = Math.max(-12, Math.min(12, Math.round(semitones)));
    const filter = normalized === 0
        ? ""
        : `lavfi=[rubberband=pitch=${(2 ** (normalized / 12)).toFixed(8)}]`;
    setProperty("af", filter);
}

function applySeek(seconds: number) {
    const result = api.setPropertyString(player, "time-pos", String(seconds));
    if (result === MPV_ERROR_PROPERTY_UNAVAILABLE) {
        pendingSeek = seconds;
        return;
    }
    checkMpv(result, "libmpv seek");
    pendingSeek = null;
    lastTime = seconds;
}

function processEvents() {
    while (!disposed) {
        const eventPointer = api.waitEvent(player, 0);
        if (!eventPointer) {
            return;
        }
        const event = koffi.decode(eventPointer, mpvEventType) as MpvEvent;
        if (event.eventId === MPV_EVENT_NONE) {
            return;
        }
        if (event.eventId === MPV_EVENT_SHUTDOWN) {
            lastError = "libmpv core shut down unexpectedly";
            return;
        }
        if (event.eventId === MPV_EVENT_FILE_LOADED && pendingSeek !== null) {
            const seekTarget = pendingSeek;
            pendingSeek = null;
            applySeek(seekTarget);
            continue;
        }
        if (event.eventId === MPV_EVENT_END_FILE && event.data) {
            const endFile = koffi.decode(
                event.data,
                mpvEventEndFileType,
            ) as MpvEventEndFile;
            if (endFile.reason === MPV_END_FILE_REASON_EOF && !loopEnabled) {
                endedPending = true;
            } else if (endFile.reason === MPV_END_FILE_REASON_ERROR) {
                lastError = mpvError(endFile.error, "libmpv playback").message;
            }
            continue;
        }
        if (event.eventId === MPV_EVENT_LOG_MESSAGE && event.data) {
            const message = koffi.decode(
                event.data,
                mpvEventLogMessageType,
            ) as MpvEventLogMessage;
            if (message.logLevel <= 20 && message.text) {
                process.stderr.write(
                    `[${message.prefix ?? "mpv"}] ${message.text.trim()}\n`,
                );
            }
            continue;
        }
        if (event.eventId === MPV_EVENT_QUEUE_OVERFLOW) {
            lastError = "libmpv event queue overflow";
        }
    }
}

function readSnapshot(): INativePlaybackSnapshot {
    const currentTime = getDoubleProperty("time-pos", lastTime);
    const duration = getDoubleProperty("duration", lastDuration);
    if (currentTime >= 0) {
        lastTime = currentTime;
    }
    if (duration > 0) {
        lastDuration = duration;
    }
    const paused = getFlagProperty("pause", true);
    const pausedForCache = getFlagProperty("paused-for-cache");
    const idle = getFlagProperty("idle-active", true);
    const eofReached = getFlagProperty("eof-reached");
    const ended = !loopEnabled && (endedPending || eofReached);
    let state: NativePlaybackState;
    if (lastError) {
        state = "error";
    } else if (!sourceId) {
        state = "none";
    } else if (ended || paused) {
        state = "paused";
    } else if (pausedForCache || idle) {
        state = "buffering";
    } else {
        state = "playing";
    }
    return {
        sourceId,
        state,
        currentTime: ended ? lastDuration : lastTime,
        duration: lastDuration,
        volume,
        speed: playbackSpeed,
        ...(ended ? { ended: true } : {}),
        ...(lastError ? { error: lastError } : {}),
    };
}

function postSnapshot(force = false) {
    if (!sourceId) {
        return;
    }
    processEvents();
    const snapshot = readSnapshot();
    const snapshotKey = JSON.stringify(snapshot);
    if (force || snapshotKey !== lastSnapshotKey) {
        lastSnapshotKey = snapshotKey;
        parentPort.postMessage({ type: "snapshot", snapshot });
    }
    endedPending = false;
}

function assertCurrentSource(command: NativePlaybackRuntimeCommand) {
    // Device / exclusive mode are player-global; allow empty or matching sourceId.
    if (
        command.operation === "output-device"
        || command.operation === "audio-exclusive"
    ) {
        if (command.sourceId && sourceId && command.sourceId !== sourceId) {
            throw new Error("Native playback command belongs to a stale source");
        }
        return;
    }
    if (command.operation !== "load" && command.sourceId !== sourceId) {
        throw new Error("Native playback command belongs to a stale source");
    }
}

function applyAudioExclusive(enabled: boolean) {
    if (process.platform !== "win32") {
        return;
    }
    const next = !!enabled;
    // Property is supported after initialize; re-set device so WASAPI reopens.
    setProperty("audio-exclusive", next ? "yes" : "no");
    setProperty("audio-device", currentAudioDevice || "auto");
}

function handleCommand(command: NativePlaybackRuntimeCommand) {
    assertCurrentSource(command);
    switch (command.operation) {
        case "load":
            if (sourceId) {
                runCommand("stop");
                processEvents();
            }
            sourceId = command.sourceId;
            lastTime = 0;
            lastDuration = 0;
            lastSnapshotKey = "";
            lastError = "";
            endedPending = false;
            pendingSeek = null;
            playbackSpeed = 1;
            setProperty("pause", "yes");
            applyRequestHeaders(
                command.sourceType === "location" ? command.headers : undefined,
            );
            runCommand("loadfile", command.url, "replace");
            break;
        case "play":
            if (getFlagProperty("eof-reached")) {
                applySeek(0);
            }
            endedPending = false;
            lastError = "";
            setProperty("pause", "no");
            break;
        case "pause":
            setProperty("pause", "yes");
            break;
        case "stop":
            runCommand("stop");
            sourceId = "";
            lastTime = 0;
            lastDuration = 0;
            lastSnapshotKey = "";
            lastError = "";
            endedPending = false;
            pendingSeek = null;
            return;
        case "seek":
            applySeek(command.seconds);
            break;
        case "volume": {
            const ratio = Math.max(0, Math.min(1, command.volume));
            // mpv 内核默认使用 3次方 物理衰减，会导致低百分比 (0~20%) 物理能量被严重压缩。
            // 用开方函数补偿送到 mpv 的数值，使 UI 的 0%~100% 对应人耳听到的均匀音量。
            const mpvVolume = ratio <= 0 ? 0 : Math.sqrt(ratio) * 100;
            setProperty("volume", String(mpvVolume));
            volume = command.volume;
            break;
        }
        case "speed":
            setProperty("speed", String(command.speed));
            playbackSpeed = command.speed;
            break;
        case "pitch":
            applyPitch(command.semitones);
            break;
        case "loop":
            setProperty("loop-file", command.enabled ? "inf" : "no");
            loopEnabled = command.enabled;
            endedPending = false;
            break;
        case "output-device":
            currentAudioDevice = command.deviceId || "auto";
            setProperty("audio-device", currentAudioDevice);
            break;
        case "audio-exclusive":
            applyAudioExclusive(command.enabled);
            break;
    }
    postSnapshot(true);
}

function respond(requestId: string, result?: unknown, error?: unknown) {
    const normalized = error instanceof Error ? error : error ? new Error(String(error)) : null;
    parentPort.postMessage({
        type: "response",
        requestId,
        result,
        error: normalized ? {
            name: normalized.name,
            message: normalized.message,
            stack: normalized.stack,
        } : undefined,
    });
}

function dispose() {
    if (disposed) {
        return;
    }
    disposed = true;
    clearInterval(pollTimer);
    api.terminateDestroy(player);
    library.unload();
}

const pollTimer = setInterval(() => {
    try {
        postSnapshot();
    } catch (error) {
        if (sourceId) {
            const snapshot: INativePlaybackSnapshot = {
                sourceId,
                state: "error",
                currentTime: lastTime,
                duration: lastDuration,
                volume,
                speed: playbackSpeed,
                error: error instanceof Error ? error.message : String(error),
            };
            parentPort.postMessage({ type: "snapshot", snapshot });
        }
    }
}, 200);

parentPort.on("message", (event) => {
    const request = event.data as RuntimeRequest;
    if (request?.type !== "request" || typeof request.requestId !== "string") {
        return;
    }
    try {
        if (request.operation === "capabilities") {
            respond(request.requestId, capabilities);
            return;
        }
        if (request.operation === "list-audio-devices") {
            respond(request.requestId, listAudioDevices());
            return;
        }
        if (request.operation !== "command" || !request.payload) {
            throw new Error("Native playback operation is not supported");
        }
        handleCommand(request.payload);
        respond(request.requestId, undefined);
    } catch (error) {
        respond(request.requestId, undefined, error);
    }
});

process.once("exit", dispose);
