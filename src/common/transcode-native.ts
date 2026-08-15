import fs from "fs";
import path from "path";

interface IProbeAudioCodecOptions {
    runtimeDirectory: string;
    inputPath: string;
    timeoutMs: number;
}

export interface INativeTranscodeOptions extends IProbeAudioCodecOptions {
    outputPath: string;
    format: "mp3" | "flac";
    encoder: "libmp3lame" | "flac";
    encoderOptions: string;
}

interface ITranscodeNativeBinding {
    probeMp4AudioCodec: (filePath: string) => string | null;
    probeAudioCodec: (options: IProbeAudioCodecOptions) => Promise<string>;
    transcode: (options: INativeTranscodeOptions) => Promise<void>;
}

let cachedBinding: ITranscodeNativeBinding | null = null;
let cachedLoadError: NativeTranscodeUnavailableError | null = null;

export class NativeTranscodeUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NativeTranscodeUnavailableError";
    }
}

function requireNative(absPath: string): ITranscodeNativeBinding {
    const resolved = path.resolve(absPath);
    const nonWebpackRequire = (
        globalThis as typeof globalThis & {
            __non_webpack_require__?: NodeRequire;
        }
    ).__non_webpack_require__;
    if (typeof nonWebpackRequire === "function") {
        return nonWebpackRequire(resolved) as ITranscodeNativeBinding;
    }

    const nativeModule: { exports: ITranscodeNativeBinding } = {
        exports: {} as ITranscodeNativeBinding,
    };
    process.dlopen(nativeModule as unknown as NodeModule, resolved);
    return nativeModule.exports;
}

function candidateNativePaths() {
    const fileName = "transcode.node";
    const candidates: string[] = [];
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
        candidates.push(
            path.join(process.resourcesPath, "res", ".service", "native", fileName),
        );
    }
    if (process.env.BAKAMUSIC_NATIVE_DIR) {
        candidates.push(path.join(process.env.BAKAMUSIC_NATIVE_DIR, fileName));
    }
    candidates.push(
        path.join(__dirname, "..", "..", "res", ".service", "native", fileName),
        path.join(__dirname, "..", "..", "..", "res", ".service", "native", fileName),
        path.join(process.cwd(), "res", ".service", "native", fileName),
    );
    return candidates;
}

function resolveNativePath() {
    for (const candidate of candidateNativePaths()) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // Continue through development and packaged candidates.
        }
    }
    throw new Error(
        "transcode.node not found. Run `npm run native:install` "
        + "(or `npm run build:native` with a local native/ checkout).",
    );
}

function loadBinding() {
    if (cachedBinding) {
        return cachedBinding;
    }
    if (cachedLoadError) {
        throw cachedLoadError;
    }
    try {
        const nativePath = resolveNativePath();
        const binding = requireNative(nativePath);
        if (
            !binding
            || typeof binding.probeMp4AudioCodec !== "function"
            || typeof binding.probeAudioCodec !== "function"
            || typeof binding.transcode !== "function"
        ) {
            throw new Error(`Invalid transcode native module at ${nativePath}`);
        }
        cachedBinding = binding;
        return binding;
    } catch (error) {
        cachedLoadError = new NativeTranscodeUnavailableError(
            error instanceof Error ? error.message : String(error),
        );
        throw cachedLoadError;
    }
}

export function probeAudioCodecNative(options: IProbeAudioCodecOptions) {
    return loadBinding().probeAudioCodec(options);
}

export function transcodeNative(options: INativeTranscodeOptions) {
    return loadBinding().transcode(options);
}
