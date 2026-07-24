import fs from "fs";
import path from "path";

export interface ITaglibPicture {
    format: string;
    data: Buffer;
    description?: string;
    pictureType?: string;
}

export interface ITaglibReadOptions {
    /** When false, skip audio property probing (duration/bitrate/...). Default true. */
    duration?: boolean;
    /** When true, skip embedded cover extraction. Default false. */
    skipCovers?: boolean;
}

export interface ITaglibReadResult {
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    lyrics?: string;
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    bitsPerSample?: number;
    channels?: number;
    lossless?: boolean;
    codec?: string;
    container?: string;
    pictures?: ITaglibPicture[];
}

export interface ITaglibWritePicture {
    path?: string;
    data?: Buffer;
    mimeType?: string;
}

export interface ITaglibWriteInput {
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    lyrics?: string | null;
    pictures?: ITaglibWritePicture[];
    clearPictures?: boolean;
}

interface ITaglibNativeBinding {
    readTags: (filePath: string, options?: ITaglibReadOptions) => ITaglibReadResult;
    writeTags: (filePath: string, tags: ITaglibWriteInput) => void;
    taglibVersion: string;
}

let cachedBinding: ITaglibNativeBinding | null = null;

/**
 * Load a N-API `.node` from an absolute path.
 *
 * Webpack rewrites bare `require` / `createRequire` in the utility-process
 * bundle. `new Function("return require(id)")` also fails there because
 * `require` is a CJS local, not a global → `ReferenceError: require is not defined`.
 *
 * Prefer Forge's `__non_webpack_require__` when present; otherwise use
 * `process.dlopen` which needs no CommonJS require (works in Electron
 * utilityProcess / ELECTRON_RUN_AS_NODE).
 */
function requireNative(absPath: string): ITaglibNativeBinding {
    const resolved = path.resolve(absPath);

    const nonWebpackRequire = (
        globalThis as typeof globalThis & {
            __non_webpack_require__?: NodeRequire;
        }
    ).__non_webpack_require__;
    if (typeof nonWebpackRequire === "function") {
        return nonWebpackRequire(resolved) as ITaglibNativeBinding;
    }

    // Minimal object for process.dlopen (only `exports` is required at runtime).
    const nativeModule: { exports: ITaglibNativeBinding } = {
        exports: {} as ITaglibNativeBinding,
    };
    process.dlopen(nativeModule as unknown as NodeModule, resolved);
    return nativeModule.exports;
}

function candidateNativePaths(): string[] {
    const fileName = "taglib.node";
    const candidates: string[] = [];

    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
        candidates.push(
            path.join(process.resourcesPath, "res", ".service", "native", fileName),
        );
    }

    if (process.env.BAKAMUSIC_NATIVE_DIR) {
        candidates.push(path.join(process.env.BAKAMUSIC_NATIVE_DIR, fileName));
    }

    // Electron utility / main: .webpack/main → repo root or packaged resources sibling.
    candidates.push(
        path.join(__dirname, "..", "..", "res", ".service", "native", fileName),
        path.join(__dirname, "..", "..", "..", "res", ".service", "native", fileName),
        path.join(process.cwd(), "res", ".service", "native", fileName),
    );

    return candidates;
}

function resolveTaglibNativePath(): string {
    for (const candidate of candidateNativePaths()) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // continue
        }
    }
    throw new Error(
        "taglib.node not found. Run `npm run native:install` "
        + "(or `npm run build:native` with a local native/ checkout).",
    );
}

function loadBinding(): ITaglibNativeBinding {
    if (cachedBinding) {
        return cachedBinding;
    }
    const nativePath = resolveTaglibNativePath();
    const binding = requireNative(nativePath);
    if (
        !binding
        || typeof binding.readTags !== "function"
        || typeof binding.writeTags !== "function"
    ) {
        throw new Error(`Invalid taglib native module at ${nativePath}`);
    }
    cachedBinding = binding;
    return binding;
}

export function getTaglibVersion(): string {
    return loadBinding().taglibVersion;
}

export function readTags(
    filePath: string,
    options?: ITaglibReadOptions,
): ITaglibReadResult {
    return loadBinding().readTags(filePath, options);
}

export function writeTags(
    filePath: string,
    tags: ITaglibWriteInput,
): void {
    loadBinding().writeTags(filePath, tags);
}
