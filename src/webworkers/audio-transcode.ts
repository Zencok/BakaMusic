import fsPromises from "fs/promises";
import { availableParallelism } from "os";
import path from "path";
import koffi from "koffi";
import {
    IDownloadTranscodeOptions,
    IDownloadTranscodeResult,
    ITranscodeTarget,
    isTranscodableContainer,
    resolveTranscodeTarget,
} from "@/common/audio-transcode";

/**
 * Download transcoding on top of the bundled libmpv (LibreMPEG) runtime.
 *
 * The same shared library that plays audio also carries a full encoder set —
 * `libmp3lame` and `flac` are both compiled in — so no extra binary has to be
 * shipped. mpv is driven in *encode mode*: setting the `o` option before
 * `mpv_initialize` turns the instance into a one-shot transcoder that reads a
 * file, writes the output and reports EOF through `MPV_EVENT_END_FILE`.
 *
 * `oac=copy` (stream copy / remux) is deliberately unused: this build fails it
 * with `MPV_ERROR_AO_INIT_FAILED`, so lossless sources are re-encoded instead.
 * FLAC re-encoding is bit-exact, so nothing is lost.
 *
 * Every mpv call goes through koffi's async path. A synchronous
 * `mpv_wait_event` loop would freeze this utility's event loop and stall every
 * in-flight download's progress reporting while a file is being converted.
 */

const MPV_EVENT_SHUTDOWN = 1;
const MPV_EVENT_LOG_MESSAGE = 2;
const MPV_EVENT_END_FILE = 7;
const MPV_EVENT_FILE_LOADED = 8;
const MPV_END_FILE_REASON_EOF = 0;

/** A single track must never hold the postprocess queue hostage. */
const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;
const EVENT_POLL_SECONDS = 0.2;

export class TranscodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TranscodeError";
    }
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

/**
 * libmpv is ~97 MiB of mapped image. Build the binding the first time a
 * download actually needs converting instead of on every runtime spawn.
 */
function createMpvApi() {
    const runtimeDirectory = process.env.BAKAMUSIC_MPV_DIR;
    if (!runtimeDirectory) {
        throw new TranscodeError("libmpv runtime directory is missing");
    }
    const libraryName = process.platform === "win32"
        ? "libmpv-2.dll"
        : process.platform === "darwin"
            ? path.join("lib", "libmpv.2.dylib")
            : path.join("lib", "libmpv.so.2");
    const library = koffi.load(path.join(runtimeDirectory, libraryName));
    const mpvFree = library.func("mpv_free", "void", ["void *"]);
    const mpvAllocatedString = koffi.disposable(
        "TranscodeMpvString",
        "str",
        mpvFree,
    );
    koffi.struct("transcode_mpv_event", {
        eventId: "int",
        error: "int",
        replyUserdata: "uint64_t",
        data: "void *",
    });
    koffi.struct("transcode_mpv_event_end_file", {
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
        requestLogMessages: library.func(
            "int mpv_request_log_messages(void *, const char *)",
        ),
        waitEvent: library.func("void *mpv_wait_event(void *, double)"),
    };
}

type MpvApi = ReturnType<typeof createMpvApi>;

let cachedApi: MpvApi | null = null;
let cachedLoadError: Error | null = null;

function loadMpvApi(): MpvApi {
    if (cachedApi) {
        return cachedApi;
    }
    if (cachedLoadError) {
        throw cachedLoadError;
    }
    try {
        cachedApi = createMpvApi();
        return cachedApi;
    } catch (error) {
        cachedLoadError = error instanceof Error
            ? error
            : new TranscodeError(String(error));
        throw cachedLoadError;
    }
}

/** Options every mpv session needs so nothing touches audio output or config. */
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

function waitEventAsync(api: MpvApi, handle: unknown, timeoutSeconds: number) {
    return new Promise<unknown>((resolve, reject) => {
        api.waitEvent.async(
            handle,
            timeoutSeconds,
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

interface MpvSessionResult {
    codecName: string | null;
    completed: boolean;
}

/**
 * Run one mpv instance over `inputPath` until it reports EOF or shuts down.
 * `extraOptions` decides whether this is a probe or an encode session.
 */
async function runMpvSession(
    inputPath: string,
    extraOptions: Array<[string, string]>,
    timeoutMs: number,
    stopAfterLoad: boolean,
): Promise<MpvSessionResult> {
    const api = loadMpvApi();
    const handle = api.create();
    if (!handle) {
        throw new TranscodeError("libmpv instance could not be created");
    }

    try {
        for (const [name, value] of [...BASE_OPTIONS, ...extraOptions]) {
            const code = api.setOptionString(handle, name, value);
            if (code < 0) {
                throw new TranscodeError(
                    `libmpv option ${name}=${value} rejected: ${api.errorString(code)}`,
                );
            }
        }
        const initCode = api.initialize(handle);
        if (initCode < 0) {
            throw new TranscodeError(
                `libmpv initialization failed: ${api.errorString(initCode)}`,
            );
        }
        api.requestLogMessages(handle, "error");

        const loadCode = api.command(handle, ["loadfile", inputPath, "replace", null]);
        if (loadCode < 0) {
            throw new TranscodeError(
                `libmpv could not open the file: ${api.errorString(loadCode)}`,
            );
        }

        let codecName: string | null = null;
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (Date.now() > deadline) {
                throw new TranscodeError("libmpv timed out");
            }
            const pointer = await waitEventAsync(api, handle, EVENT_POLL_SECONDS);
            if (!pointer) {
                continue;
            }
            const event = koffi.decode(pointer, "transcode_mpv_event") as MpvEvent;
            if (event.eventId === MPV_EVENT_LOG_MESSAGE) {
                continue;
            }
            if (event.eventId === MPV_EVENT_FILE_LOADED) {
                const value = api.getPropertyString(handle, "audio-codec-name");
                codecName = typeof value === "string" && value ? value : null;
                if (stopAfterLoad) {
                    return { codecName, completed: true };
                }
                continue;
            }
            if (event.eventId === MPV_EVENT_END_FILE) {
                const endFile = koffi.decode(
                    event.data,
                    "transcode_mpv_event_end_file",
                ) as MpvEventEndFile;
                if (endFile.reason !== MPV_END_FILE_REASON_EOF || endFile.error !== 0) {
                    throw new TranscodeError(
                        `libmpv ended early (reason ${endFile.reason}, ${
                            api.errorString(endFile.error) || `error ${endFile.error}`
                        })`,
                    );
                }
                return { codecName, completed: true };
            }
            if (event.eventId === MPV_EVENT_SHUTDOWN) {
                return { codecName, completed: true };
            }
        }
    } finally {
        api.terminateDestroy(handle);
    }
}

/** Read the codec actually stored inside the container. */
export async function probeAudioCodec(filePath: string) {
    const result = await runMpvSession(
        filePath,
        [["pause", "yes"], ["ao", "null"], ["vo", "null"]],
        PROBE_TIMEOUT_MS,
        true,
    );
    return result.codecName;
}

async function ensureUniquePath(filePath: string) {
    try {
        await fsPromises.access(filePath);
    } catch {
        return filePath;
    }
    const directory = path.dirname(filePath);
    const extension = path.extname(filePath);
    const base = path.basename(filePath, extension);
    for (let index = 1; index < 10_000; index++) {
        const candidate = path.join(directory, `${base} (${index})${extension}`);
        try {
            await fsPromises.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw new TranscodeError("Unable to allocate a unique transcode path");
}

async function removeQuietly(filePath: string) {
    try {
        await fsPromises.rm(filePath, { force: true });
    } catch {
        // Leftover temp files are not worth failing the download over.
    }
}

/**
 * Encode `inputPath` into `target`, writing through a temp file so an
 * interrupted run never leaves a truncated track next to the original.
 */
async function encodeToTarget(inputPath: string, target: ITranscodeTarget) {
    const directory = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const finalPath = await ensureUniquePath(
        path.join(directory, `${baseName}${target.extension}`),
    );
    const tempPath = `${finalPath}.transcoding`;
    await removeQuietly(tempPath);

    const encodeOptions: Array<[string, string]> = [
        ["o", tempPath],
        ["of", target.format],
        ["oac", target.encoder],
        // Carry over whatever tags the source container had. Tag writing later
        // in postprocess still overwrites title/artist/cover when enabled.
        ["ocopy-metadata", "yes"],
    ];
    if (target.encoderOptions) {
        encodeOptions.push(["oacopts", target.encoderOptions]);
    }

    try {
        await runMpvSession(inputPath, encodeOptions, TRANSCODE_TIMEOUT_MS, false);
        const stat = await fsPromises.stat(tempPath);
        if (stat.size <= 0) {
            throw new TranscodeError("Transcoded file is empty");
        }
        await fsPromises.rename(tempPath, finalPath);
        return finalPath;
    } catch (error) {
        await removeQuietly(tempPath);
        throw error;
    }
}

/**
 * LAME and FLAC encode one track mostly on one core. Use a second worker on
 * machines with enough CPU capacity, while keeping the queue bounded so a
 * large batch cannot start an encoder per configured download slot.
 */
const transcodeConcurrency = Math.max(
    1,
    Math.min(2, Math.floor(availableParallelism() / 2)),
);
const pendingTranscodes: Array<() => void> = [];
let activeTranscodes = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = () => {
            activeTranscodes++;
            void (async () => {
                try {
                    resolve(await task());
                } catch (error) {
                    reject(error);
                } finally {
                    activeTranscodes--;
                    pendingTranscodes.shift()?.();
                }
            })();
        };

        if (activeTranscodes < transcodeConcurrency) {
            run();
        } else {
            pendingTranscodes.push(run);
        }
    });
}

/**
 * Convert a freshly downloaded file when policy says so.
 *
 * Never throws: a failed conversion leaves the original download in place and
 * is reported through `error`, because the media file itself is already valid.
 */
export async function transcodeDownloadedFile(
    filePath: string,
    options: IDownloadTranscodeOptions,
): Promise<IDownloadTranscodeResult> {
    if (options.mode !== "auto" || !isTranscodableContainer(filePath)) {
        return { filePath, transcoded: false };
    }

    return enqueue(async () => {
        let codecName: string | null = null;
        try {
            codecName = await probeAudioCodec(filePath);
        } catch (error) {
            return {
                filePath,
                transcoded: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }

        const target = resolveTranscodeTarget({
            filePath,
            codecName,
            mode: options.mode,
            mp3Bitrate: options.mp3Bitrate,
        });
        if (!target) {
            return { filePath, transcoded: false, codecName };
        }

        try {
            const outputPath = await encodeToTarget(filePath, target);
            if (options.deleteSource) {
                await removeQuietly(filePath);
            }
            return {
                filePath: outputPath,
                transcoded: true,
                codecName,
                format: target.format,
            };
        } catch (error) {
            return {
                filePath,
                transcoded: false,
                codecName,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });
}
