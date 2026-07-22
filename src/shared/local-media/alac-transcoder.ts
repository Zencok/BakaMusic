import { app } from "electron";
import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import type { Stats } from "fs";
import path from "path";
import { parseFile } from "music-metadata";

const CACHE_DIRECTORY_NAME = "bakamusic-alac-cache";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const DETECTION_CACHE_MAX_ENTRIES = 512;
const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1_000;
const TRANSCODE_STDERR_MAX_CHARS = 16 * 1024;
const ALAC_CONTAINER_EXTENSIONS = new Set([".m4a", ".mp4"]);

interface IPlaybackFile {
    filePath: string;
    fileStat: Stats;
}

const alacDetectionCache = new Map<string, boolean>();
const transcodeJobs = new Map<string, Promise<IPlaybackFile>>();

function sourceIdentity(filePath: string, fileStat: Stats) {
    const comparablePath = process.platform === "win32"
        ? filePath.toLocaleLowerCase()
        : filePath;
    return `${comparablePath}\0${fileStat.size}\0${fileStat.mtimeMs}`;
}

function rememberAlacDetection(identity: string, isAlac: boolean) {
    alacDetectionCache.delete(identity);
    alacDetectionCache.set(identity, isAlac);
    while (alacDetectionCache.size > DETECTION_CACHE_MAX_ENTRIES) {
        const oldestKey = alacDetectionCache.keys().next().value as string | undefined;
        if (!oldestKey) {
            break;
        }
        alacDetectionCache.delete(oldestKey);
    }
}

async function isAlacFile(filePath: string, fileStat: Stats) {
    if (!ALAC_CONTAINER_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase())) {
        return false;
    }

    const identity = sourceIdentity(filePath, fileStat);
    const cached = alacDetectionCache.get(identity);
    if (cached !== undefined) {
        return cached;
    }

    const { format } = await parseFile(filePath, {
        duration: false,
        skipCovers: true,
    });
    const isAlac = format.codec?.trim().toLocaleLowerCase() === "alac";
    rememberAlacDetection(identity, isAlac);
    return isAlac;
}

function getFfmpegExecutablePath() {
    const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    return app.isPackaged
        ? path.join(process.resourcesPath, executableName)
        : path.join(process.cwd(), "node_modules", "ffmpeg-static", executableName);
}

function transcodeToFlac(inputPath: string, outputPath: string) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(getFfmpegExecutablePath(), [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            inputPath,
            "-map",
            "0:a:0",
            "-map_metadata",
            "-1",
            "-vn",
            "-c:a",
            "flac",
            "-compression_level",
            "5",
            "-threads",
            "1",
            "-f",
            "flac",
            outputPath,
        ], {
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
        });
        let stderr = "";
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };
        const timeout = setTimeout(() => {
            child.kill();
            finish(new Error("ALAC compatibility transcode timed out"));
        }, TRANSCODE_TIMEOUT_MS);

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            if (stderr.length < TRANSCODE_STDERR_MAX_CHARS) {
                stderr += chunk.slice(0, TRANSCODE_STDERR_MAX_CHARS - stderr.length);
            }
        });
        child.once("error", finish);
        child.once("close", (code) => {
            if (code === 0) {
                finish();
                return;
            }
            finish(new Error(
                `ALAC compatibility transcode exited with code ${code}: ${stderr.trim()}`,
            ));
        });
    });
}

async function pruneCache(cacheDirectory: string, protectedPath?: string) {
    const entries = await fs.readdir(cacheDirectory, { withFileTypes: true });
    const now = Date.now();
    const cacheFiles: Array<{ filePath: string; size: number; mtimeMs: number }> = [];

    await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile()) {
            return;
        }
        const filePath = path.join(cacheDirectory, entry.name);
        const fileStat = await fs.stat(filePath);
        if (entry.name.includes(".part-") || now - fileStat.mtimeMs > CACHE_MAX_AGE_MS) {
            if (filePath !== protectedPath) {
                await fs.rm(filePath, { force: true });
            }
            return;
        }
        cacheFiles.push({ filePath, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
    }));

    cacheFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);
    let retainedBytes = 0;
    for (const cacheFile of cacheFiles) {
        retainedBytes += cacheFile.size;
        if (retainedBytes > CACHE_MAX_BYTES && cacheFile.filePath !== protectedPath) {
            await fs.rm(cacheFile.filePath, { force: true });
        }
    }
}

async function createPlaybackFile(
    filePath: string,
    cacheFilePath: string,
) {
    const cacheDirectory = path.dirname(cacheFilePath);
    await fs.mkdir(cacheDirectory, { recursive: true });
    try {
        const cachedStat = await fs.stat(cacheFilePath);
        if (cachedStat.isFile() && cachedStat.size > 0) {
            const now = new Date();
            await fs.utimes(cacheFilePath, now, now);
            return { filePath: cacheFilePath, fileStat: await fs.stat(cacheFilePath) };
        }
    } catch {
        // The first request creates the compatibility file below.
    }

    const temporaryPath = `${cacheFilePath}.part-${process.pid}-${randomUUID()}`;
    try {
        await transcodeToFlac(filePath, temporaryPath);
        await fs.rename(temporaryPath, cacheFilePath);
        const playbackStat = await fs.stat(cacheFilePath);
        void pruneCache(cacheDirectory, cacheFilePath).catch(() => undefined);
        return { filePath: cacheFilePath, fileStat: playbackStat };
    } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function resolveLocalMediaPlaybackFile(
    filePath: string,
    fileStat: Stats,
): Promise<IPlaybackFile> {
    if (!await isAlacFile(filePath, fileStat)) {
        return { filePath, fileStat };
    }

    const cacheKey = createHash("sha256")
        .update(sourceIdentity(filePath, fileStat))
        .digest("hex");
    const cacheDirectory = path.join(app.getPath("temp"), CACHE_DIRECTORY_NAME);
    const cacheFilePath = path.join(cacheDirectory, `${cacheKey}.flac`);
    let job = transcodeJobs.get(cacheFilePath);
    if (!job) {
        job = createPlaybackFile(filePath, cacheFilePath)
            .finally(() => transcodeJobs.delete(cacheFilePath));
        transcodeJobs.set(cacheFilePath, job);
    }
    return await job;
}

export function cleanupLocalMediaPlaybackCache() {
    const cacheDirectory = path.join(app.getPath("temp"), CACHE_DIRECTORY_NAME);
    return fs.mkdir(cacheDirectory, { recursive: true })
        .then(() => pruneCache(cacheDirectory));
}
