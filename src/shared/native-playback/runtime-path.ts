import fs from "fs";
import path from "path";
import getResourcePath from "@/common/get-resource-path";

interface MediaRuntimeMetadata {
    engine?: unknown;
    mediaBackend?: unknown;
    decoders?: unknown;
}

export function getMpvRuntimeDirectory() {
    return getResourcePath(path.join(
        ".runtime",
        "mpv",
        `${process.platform}-${process.arch}`,
    ));
}

export function getMpvLibraryPath() {
    const directory = getMpvRuntimeDirectory();
    return process.platform === "win32"
        ? path.join(directory, "libmpv-2.dll")
        : process.platform === "darwin"
            ? path.join(directory, "lib", "libmpv.2.dylib")
            : path.join(directory, "lib", "libmpv.so.2");
}

export function hasNativePlaybackRuntime() {
    const directory = getMpvRuntimeDirectory();
    if (!fs.existsSync(getMpvLibraryPath())) {
        return false;
    }
    try {
        const metadata = JSON.parse(fs.readFileSync(
            path.join(directory, "runtime.json"),
            "utf8",
        )) as MediaRuntimeMetadata;
        return metadata.engine === "libmpv"
            && metadata.mediaBackend === "librempeg"
            && Array.isArray(metadata.decoders)
            && metadata.decoders.includes("ac4");
    } catch {
        return false;
    }
}
