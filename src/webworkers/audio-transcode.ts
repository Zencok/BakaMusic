import fsPromises from "fs/promises";
import { availableParallelism, totalmem } from "os";
import path from "path";
import {
    IDownloadTranscodeOptions,
    IDownloadTranscodeResult,
    ITranscodeTarget,
    isTranscodableContainer,
    resolveNativeTranscodeConcurrency,
    resolveTranscodeTarget,
} from "@/common/audio-transcode";
import {
    NativeTranscodeUnavailableError,
    probeAudioCodecNative,
    transcodeNative,
} from "@/common/transcode-native";

/**
 * Download transcoding is executed by `transcode.node` on native worker
 * threads. The addon reads the MP4 sample description directly for common
 * AAC/ALAC/FLAC/Dolby inputs, so those tracks need only one libmpv session.
 * Unknown sample entries fall back to a native libmpv probe before encoding.
 */

const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;
let useLegacyFallback = false;

export class TranscodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TranscodeError";
    }
}

function getMpvRuntimeDirectory() {
    const runtimeDirectory = process.env.BAKAMUSIC_MPV_DIR;
    if (!runtimeDirectory) {
        throw new TranscodeError("libmpv runtime directory is missing");
    }
    return runtimeDirectory;
}

/** Read the codec without decoding media payload bytes when ISO-BMFF permits. */
export async function probeAudioCodec(filePath: string) {
    const options = {
        runtimeDirectory: getMpvRuntimeDirectory(),
        inputPath: filePath,
        timeoutMs: PROBE_TIMEOUT_MS,
    };
    if (useLegacyFallback) {
        const { probeAudioCodecLegacy } = await import("./audio-transcode-legacy");
        return probeAudioCodecLegacy(options);
    }
    try {
        return await probeAudioCodecNative(options);
    } catch (error) {
        if (!(error instanceof NativeTranscodeUnavailableError)) {
            throw error;
        }
        useLegacyFallback = true;
        const { probeAudioCodecLegacy } = await import("./audio-transcode-legacy");
        return probeAudioCodecLegacy(options);
    }
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

/** Write through a temporary file so interruption never exposes partial audio. */
async function encodeToTarget(inputPath: string, target: ITranscodeTarget) {
    const directory = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const finalPath = await ensureUniquePath(
        path.join(directory, `${baseName}${target.extension}`),
    );
    const tempPath = `${finalPath}.transcoding`;
    await removeQuietly(tempPath);

    try {
        const nativeOptions = {
            runtimeDirectory: getMpvRuntimeDirectory(),
            inputPath,
            outputPath: tempPath,
            format: target.format,
            encoder: target.encoder,
            encoderOptions: target.encoderOptions,
            timeoutMs: TRANSCODE_TIMEOUT_MS,
        } as const;
        if (useLegacyFallback) {
            const { transcodeLegacy } = await import("./audio-transcode-legacy");
            await transcodeLegacy(nativeOptions);
        } else {
            await transcodeNative(nativeOptions);
        }
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
 * One encode uses roughly one physical core. Hyperthread siblings share
 * execution resources, so start from half the logical CPU count and then
 * apply the memory budget. This scales to 32/64 jobs on large workstations.
 */
const transcodeConcurrency = resolveNativeTranscodeConcurrency(
    availableParallelism(),
    totalmem(),
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
