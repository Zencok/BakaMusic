import path from "path";
import koffi from "koffi";
import type { INativeTranscodeOptions } from "@/common/transcode-native";

const MPV_EVENT_SHUTDOWN = 1;
const MPV_EVENT_END_FILE = 7;
const MPV_EVENT_FILE_LOADED = 8;
const MPV_END_FILE_REASON_EOF = 0;
const EVENT_POLL_SECONDS = 0.2;

interface MpvEvent {
    eventId: number;
    error: number;
    data: unknown;
}

interface MpvEventEndFile {
    reason: number;
    error: number;
}

function createMpvApi(runtimeDirectory: string) {
    const libraryName = process.platform === "win32"
        ? "libmpv-2.dll"
        : process.platform === "darwin"
            ? path.join("lib", "libmpv.2.dylib")
            : path.join("lib", "libmpv.so.2");
    const library = koffi.load(path.join(runtimeDirectory, libraryName));
    const mpvFree = library.func("mpv_free", "void", ["void *"]);
    const mpvAllocatedString = koffi.disposable(
        "LegacyTranscodeMpvString",
        "str",
        mpvFree,
    );
    koffi.struct("legacy_transcode_mpv_event", {
        eventId: "int",
        error: "int",
        replyUserdata: "uint64_t",
        data: "void *",
    });
    koffi.struct("legacy_transcode_mpv_event_end_file", {
        reason: "int",
        error: "int",
        playlistEntryId: "int64_t",
        playlistInsertId: "int64_t",
        playlistInsertNumEntries: "int",
    });
    return {
        create: library.func("void *mpv_create(void)"),
        initialize: library.func("int mpv_initialize(void *)"),
        terminateDestroy: library.func("void mpv_terminate_destroy(void *)"),
        errorString: library.func("const char *mpv_error_string(int)"),
        setOptionString: library.func(
            "int mpv_set_option_string(void *, const char *, const char *)",
        ),
        getPropertyString: library.func(
            "mpv_get_property_string",
            mpvAllocatedString,
            ["void *", "const char *"],
        ),
        command: library.func("int mpv_command(void *, const char **)"),
        waitEvent: library.func("void *mpv_wait_event(void *, double)"),
    };
}

type MpvApi = ReturnType<typeof createMpvApi>;

let cachedApi: MpvApi | null = null;
let cachedRuntimeDirectory = "";

function loadMpvApi(runtimeDirectory: string) {
    if (cachedApi && cachedRuntimeDirectory === runtimeDirectory) {
        return cachedApi;
    }
    cachedApi = createMpvApi(runtimeDirectory);
    cachedRuntimeDirectory = runtimeDirectory;
    return cachedApi;
}

const BASE_OPTIONS: Array<[string, string]> = [
    ["config", "no"],
    ["load-scripts", "no"],
    ["terminal", "no"],
    ["input-default-bindings", "no"],
    ["input-vo-keyboard", "no"],
    ["osc", "no"],
    ["video", "no"],
    ["audio-display", "no"],
    ["autoload-files", "no"],
];

function waitEventAsync(api: MpvApi, handle: unknown) {
    return new Promise<unknown>((resolve, reject) => {
        api.waitEvent.async(
            handle,
            EVENT_POLL_SECONDS,
            (error: Error | null, pointer: unknown) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(pointer);
            },
        );
    });
}

async function runMpvSession(
    runtimeDirectory: string,
    inputPath: string,
    extraOptions: Array<[string, string]>,
    timeoutMs: number,
    stopAfterLoad: boolean,
) {
    const api = loadMpvApi(runtimeDirectory);
    const handle = api.create();
    if (!handle) {
        throw new Error("libmpv instance could not be created");
    }

    try {
        for (const [name, value] of [...BASE_OPTIONS, ...extraOptions]) {
            const code = api.setOptionString(handle, name, value);
            if (code < 0) {
                throw new Error(
                    `libmpv option ${name}=${value} rejected: ${api.errorString(code)}`,
                );
            }
        }
        const initializeCode = api.initialize(handle);
        if (initializeCode < 0) {
            throw new Error(
                `libmpv initialization failed: ${api.errorString(initializeCode)}`,
            );
        }
        const loadCode = api.command(handle, ["loadfile", inputPath, "replace", null]);
        if (loadCode < 0) {
            throw new Error(`libmpv could not open the file: ${api.errorString(loadCode)}`);
        }

        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (Date.now() > deadline) {
                throw new Error("libmpv timed out");
            }
            const pointer = await waitEventAsync(api, handle);
            if (!pointer) {
                continue;
            }
            const event = koffi.decode(
                pointer,
                "legacy_transcode_mpv_event",
            ) as MpvEvent;
            if (event.eventId === MPV_EVENT_FILE_LOADED && stopAfterLoad) {
                const codec = api.getPropertyString(handle, "audio-codec-name");
                if (typeof codec !== "string" || !codec) {
                    throw new Error("libmpv did not report an audio codec");
                }
                return codec;
            }
            if (event.eventId === MPV_EVENT_END_FILE) {
                const endFile = koffi.decode(
                    event.data,
                    "legacy_transcode_mpv_event_end_file",
                ) as MpvEventEndFile;
                if (endFile.reason !== MPV_END_FILE_REASON_EOF || endFile.error !== 0) {
                    throw new Error(
                        `libmpv ended early (reason ${endFile.reason}, ${
                            api.errorString(endFile.error) || `error ${endFile.error}`
                        })`,
                    );
                }
                return null;
            }
            if (event.eventId === MPV_EVENT_SHUTDOWN) {
                throw new Error("libmpv shut down unexpectedly");
            }
        }
    } finally {
        api.terminateDestroy(handle);
    }
}

export function probeAudioCodecLegacy(options: {
    runtimeDirectory: string;
    inputPath: string;
    timeoutMs: number;
}) {
    return runMpvSession(
        options.runtimeDirectory,
        options.inputPath,
        [["pause", "yes"], ["ao", "null"], ["vo", "null"]],
        options.timeoutMs,
        true,
    );
}

export async function transcodeLegacy(options: INativeTranscodeOptions) {
    const encodeOptions: Array<[string, string]> = [
        ["o", options.outputPath],
        ["of", options.format],
        ["oac", options.encoder],
        ["ocopy-metadata", "yes"],
    ];
    if (options.encoderOptions) {
        encodeOptions.push(["oacopts", options.encoderOptions]);
    }
    await runMpvSession(
        options.runtimeDirectory,
        options.inputPath,
        encodeOptions,
        options.timeoutMs,
        false,
    );
}
