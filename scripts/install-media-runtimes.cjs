const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { URL } = require("node:url");
const unzipper = require("unzipper");
const { path7za } = require("7zip-bin");

const root = path.resolve(__dirname, "..");
const manifest = require("./media-runtime-manifest.json");
const runtimeRoot = path.join(root, "res", ".runtime");
const platformKey = `${process.platform}-${process.arch}`;
const MAX_REDIRECTS = 5;
const runtimeRepository = "Zencok/mpv-libre-runtime";

function request(url, headers = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "user-agent": "BakaMusic media runtime installer",
                ...headers,
            },
        }, (response) => {
            const location = response.headers.location;
            if (
                location
                && response.statusCode >= 300
                && response.statusCode < 400
                && redirects < MAX_REDIRECTS
            ) {
                response.resume();
                resolve(request(new URL(location, url).toString(), headers, redirects + 1));
                return;
            }
            if (response.statusCode !== 200 && response.statusCode !== 206) {
                response.resume();
                reject(new Error(`Runtime download failed (${response.statusCode}): ${url}`));
                return;
            }
            resolve(response);
        });
        req.once("error", reject);
    });
}

async function hashFile(filePath, algorithm) {
    const hash = crypto.createHash(algorithm);
    if (fs.existsSync(filePath)) {
        for await (const chunk of fs.createReadStream(filePath)) {
            hash.update(chunk);
        }
    }
    return hash;
}

async function download(url, destination, algorithm, expectedDigest, expectedSize) {
    let existingBytes = 0;
    try {
        existingBytes = (await fsp.stat(destination)).size;
        if (existingBytes > 0) {
            const existingHash = await hashFile(destination, algorithm);
            if (existingBytes === expectedSize && existingHash.digest("hex") === expectedDigest) {
                console.log("  Cached archive verified.");
                return;
            }
        }
    } catch {
        // Start a new download below.
    }
    let response = await request(
        url,
        existingBytes > 0 ? { range: `bytes=${existingBytes}-` } : {},
    );
    let append = existingBytes > 0 && response.statusCode === 206;
    if (existingBytes > 0 && !append) {
        response.resume();
        existingBytes = 0;
        response = await request(url);
    }
    const totalBytes = existingBytes + Number(response.headers["content-length"] ?? 0);
    const hash = append
        ? await hashFile(destination, algorithm)
        : crypto.createHash(algorithm);
    let receivedBytes = existingBytes;
    let lastProgressAt = 0;
    response.on("data", (chunk) => {
        hash.update(chunk);
        receivedBytes += chunk.length;
        const now = Date.now();
        if (now - lastProgressAt >= 5_000) {
            lastProgressAt = now;
            const total = totalBytes > 0 ? ` / ${(totalBytes / 1024 / 1024).toFixed(1)} MiB` : "";
            console.log(`  ${(receivedBytes / 1024 / 1024).toFixed(1)} MiB${total}`);
        }
    });
    await pipeline(response, fs.createWriteStream(destination, {
        flags: append ? "a" : "w",
    }));
    const actualDigest = hash.digest("hex");
    if (actualDigest !== expectedDigest) {
        await fsp.rm(destination, { force: true });
        throw new Error(
            `${algorithm} mismatch for ${url}: expected ${expectedDigest}, got ${actualDigest}`,
        );
    }
    const actualSize = (await fsp.stat(destination)).size;
    if (actualSize !== expectedSize) {
        await fsp.rm(destination, { force: true });
        throw new Error(
            `Size mismatch for ${url}: expected ${expectedSize}, got ${actualSize}`,
        );
    }
}

function safeArchivePath(entryPath) {
    const normalized = entryPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (
        !parts.length
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || parts.some((part) => part === ".." || part.includes("\0"))
    ) {
        throw new Error(`Rejected archive path: ${entryPath}`);
    }
    return parts;
}

async function extractZip(archivePath, destination, selectEntry) {
    await fsp.mkdir(destination, { recursive: true });
    const archive = fs.createReadStream(archivePath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of archive) {
        const parts = safeArchivePath(entry.path);
        const selectedPath = selectEntry(parts, entry.type);
        if (!selectedPath) {
            entry.autodrain();
            continue;
        }
        const outputPath = path.resolve(destination, ...selectedPath);
        const relativePath = path.relative(destination, outputPath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            entry.autodrain();
            throw new Error(`Archive entry escaped destination: ${entry.path}`);
        }
        if (entry.type === "Directory") {
            await fsp.mkdir(outputPath, { recursive: true });
            entry.autodrain();
            continue;
        }
        await fsp.mkdir(path.dirname(outputPath), { recursive: true });
        await pipeline(entry, fs.createWriteStream(outputPath, { flags: "wx" }));
    }
}

async function extract7Zip(archivePath, destination) {
    const extractionRoot = `${destination}.extract`;
    await fsp.rm(extractionRoot, { recursive: true, force: true });
    await fsp.mkdir(extractionRoot, { recursive: true });
    try {
        const result = spawnSync(path7za, [
            "x",
            "-y",
            `-o${extractionRoot}`,
            archivePath,
        ], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (result.status !== 0) {
            throw new Error(`7-Zip extraction failed: ${result.stderr || result.stdout}`);
        }
        const entries = await fsp.readdir(extractionRoot, { withFileTypes: true });
        const rootDirectory = entries.length === 1 && entries[0].isDirectory()
            ? path.join(extractionRoot, entries[0].name)
            : extractionRoot;
        if (rootDirectory === extractionRoot) {
            await fsp.rename(extractionRoot, destination);
        } else {
            await fsp.rename(rootDirectory, destination);
        }
    } finally {
        await fsp.rm(extractionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function extractTarXz(archivePath, destination) {
    const extractionRoot = `${destination}.extract`;
    await fsp.rm(extractionRoot, { recursive: true, force: true });
    await fsp.mkdir(extractionRoot, { recursive: true });
    try {
        const listing = spawnSync("tar", ["-tJf", archivePath], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (listing.status !== 0) {
            throw new Error(`tar listing failed: ${listing.stderr || listing.stdout}`);
        }
        for (const entryPath of listing.stdout.split(/\r?\n/).filter(Boolean)) {
            safeArchivePath(entryPath);
        }
        const extraction = spawnSync("tar", [
            "-xJf",
            archivePath,
            "-C",
            extractionRoot,
        ], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (extraction.status !== 0) {
            throw new Error(`tar extraction failed: ${extraction.stderr || extraction.stdout}`);
        }
        const entries = await fsp.readdir(extractionRoot, { withFileTypes: true });
        const rootDirectory = entries.length === 1 && entries[0].isDirectory()
            ? path.join(extractionRoot, entries[0].name)
            : extractionRoot;
        if (rootDirectory === extractionRoot) {
            await fsp.rename(extractionRoot, destination);
        } else {
            await fsp.rename(rootDirectory, destination);
        }
    } finally {
        await fsp.rm(extractionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function installExtractedDirectory(temporaryRoot, destination) {
    await fsp.rm(destination, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
    });
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await fsp.rename(temporaryRoot, destination);
            return;
        } catch (error) {
            if (error?.code !== "EPERM" && error?.code !== "EBUSY") {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    await fsp.cp(temporaryRoot, destination, {
        recursive: true,
        force: true,
    });
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

function stripFirstDirectory(parts) {
    return parts.length > 1 ? parts.slice(1) : null;
}

function validateMpvRuntime(directory) {
    const libraryName = process.platform === "win32"
        ? "libmpv-2.dll"
        : process.platform === "darwin"
            ? path.join("lib", "libmpv.2.dylib")
            : path.join("lib", "libmpv.so.2");
    const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    for (const relativePath of [libraryName, ffmpegName, ffprobeName]) {
        const filePath = path.join(directory, relativePath);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1_000_000) {
            throw new Error(`libmpv runtime entry is invalid: ${relativePath}`);
        }
    }
    const decoderProbe = spawnSync(path.join(directory, ffmpegName), [
        "-hide_banner",
        "-decoders",
    ], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
    });
    if (decoderProbe.status !== 0 || !/\bac4\b/i.test(decoderProbe.stdout)) {
        throw new Error("libmpv runtime does not contain the LibreMPEG AC-4 decoder");
    }
}

async function pruneMpvCommandLineTools(directory) {
    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    await Promise.all(["ffmpeg", "ffprobe"].map((name) =>
        fsp.rm(path.join(directory, `${name}${executableSuffix}`), { force: true }),
    ));
}

function validateReleaseDescriptor(descriptor, platformDescriptor) {
    if (!/^runtime-mpv-[A-Za-z0-9._-]+$/.test(descriptor.build)) {
        throw new Error("Invalid mpv-libre-runtime release tag");
    }
    if (!/^[a-f0-9]{64}$/.test(platformDescriptor.sha256)) {
        throw new Error(`Invalid SHA-256 for ${platformKey}`);
    }
    if (!Number.isSafeInteger(platformDescriptor.size) || platformDescriptor.size < 1_000_000) {
        throw new Error(`Invalid archive size for ${platformKey}`);
    }
    const artifactUrl = new URL(platformDescriptor.url);
    const releasePrefix = `/${runtimeRepository}/releases/download/${descriptor.build}/`;
    if (
        artifactUrl.protocol !== "https:"
        || artifactUrl.hostname !== "github.com"
        || !artifactUrl.pathname.startsWith(releasePrefix)
    ) {
        throw new Error(`Invalid mpv-libre-runtime artifact URL for ${platformKey}`);
    }
    const manifestUrl = new URL(descriptor.releaseManifest.url);
    if (
        manifestUrl.protocol !== "https:"
        || manifestUrl.hostname !== "github.com"
        || manifestUrl.pathname !== `${releasePrefix}runtime-manifest-v1.json`
        || !/^[a-f0-9]{64}$/.test(descriptor.releaseManifest.sha256)
    ) {
        throw new Error("Invalid mpv-libre-runtime release manifest reference");
    }
}

async function installRuntime(name, descriptor, platformDescriptor) {
    if (name === "mpv") {
        validateReleaseDescriptor(descriptor, platformDescriptor);
    }
    const destination = path.join(runtimeRoot, name, platformKey);
    const versionPath = path.join(destination, "runtime.json");
    try {
        const installed = JSON.parse(await fsp.readFile(versionPath, "utf8"));
        const metadataMatches = installed.engine === descriptor.engine
            && installed.mediaBackend === descriptor.mediaBackend
            && JSON.stringify(installed.decoders) === JSON.stringify(descriptor.decoders)
            && installed.digest === platformDescriptor.sha256
            && installed.size === platformDescriptor.size
            && installed.releaseManifest?.url === descriptor.releaseManifest.url
            && installed.releaseManifest?.sha256 === descriptor.releaseManifest.sha256;
        if (
            installed.version === descriptor.version
            && (
                (installed.source === "local-build" && metadataMatches)
                || (installed.url === platformDescriptor.url && metadataMatches)
            )
        ) {
            if (name === "mpv") {
                await pruneMpvCommandLineTools(destination);
            }
            return false;
        }
    } catch {
        // A missing or stale runtime is replaced below.
    }

    const temporaryRoot = path.join(
        runtimeRoot,
        `.install-${name}-${process.pid}-${crypto.randomUUID()}`,
    );
    const downloadDirectory = path.join(runtimeRoot, ".downloads");
    const archiveUrlPath = new URL(platformDescriptor.url).pathname;
    const archiveExtension = archiveUrlPath.endsWith(".7z")
        ? ".7z"
        : archiveUrlPath.endsWith(".tar.xz")
            ? ".tar.xz"
            : ".zip";
    const archivePath = path.join(
        downloadDirectory,
        `${name}-${descriptor.version}-${platformKey}${archiveExtension}`,
    );
    await fsp.mkdir(runtimeRoot, { recursive: true });
    try {
        const algorithm = platformDescriptor.sha512 ? "sha512" : "sha256";
        const digest = platformDescriptor.sha512 ?? platformDescriptor.sha256;
        await fsp.mkdir(downloadDirectory, { recursive: true });
        const legacyPartials = (await fsp.readdir(runtimeRoot, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.startsWith(`.install-${name}-`))
            .map((entry) => path.join(runtimeRoot, entry.name));
        if (!fs.existsSync(archivePath) && legacyPartials.length) {
            const candidates = await Promise.all(legacyPartials.map(async (filePath) => ({
                filePath,
                size: (await fsp.stat(filePath)).size,
            })));
            candidates.sort((left, right) => right.size - left.size);
            await fsp.rename(candidates[0].filePath, archivePath);
        }
        console.log(`Downloading ${name} ${descriptor.version} for ${platformKey}...`);
        await download(
            platformDescriptor.url,
            archivePath,
            algorithm,
            digest,
            platformDescriptor.size,
        );
        if (archiveExtension === ".7z") {
            await extract7Zip(archivePath, temporaryRoot);
        } else if (archiveExtension === ".tar.xz") {
            await extractTarXz(archivePath, temporaryRoot);
        } else {
            await extractZip(archivePath, temporaryRoot, stripFirstDirectory);
        }
        if (name === "mpv") {
            validateMpvRuntime(temporaryRoot);
            await pruneMpvCommandLineTools(temporaryRoot);
        }
        await fsp.writeFile(
            path.join(temporaryRoot, "runtime.json"),
            `${JSON.stringify({
                name,
                version: descriptor.version,
                build: descriptor.build,
                engine: descriptor.engine,
                mediaBackend: descriptor.mediaBackend,
                decoders: descriptor.decoders,
                sourceCommits: descriptor.sourceCommits,
                platform: platformKey,
                url: platformDescriptor.url,
                digest,
                size: platformDescriptor.size,
                status: platformDescriptor.status,
                releaseManifest: descriptor.releaseManifest,
            }, null, 2)}\n`,
            "utf8",
        );
        await installExtractedDirectory(temporaryRoot, destination);
        console.log(`Installed ${name} ${descriptor.version}.`);
        return true;
    } finally {
        if (fs.existsSync(path.join(destination, "runtime.json"))) {
            await fsp.rm(archivePath, { force: true }).catch(() => undefined);
        }
        await fsp.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function main() {
    const onlyArgument = process.argv.find((argument) => argument.startsWith("--only="));
    const selectedNames = onlyArgument
        ? new Set(onlyArgument.slice("--only=".length).split(",").filter(Boolean))
        : null;
    const unsupported = [];
    for (const [name, descriptor] of Object.entries(manifest)) {
        if (selectedNames && !selectedNames.has(name)) {
            continue;
        }
        const platformDescriptor = descriptor.platforms[platformKey];
        if (!platformDescriptor) {
            unsupported.push(name);
            continue;
        }
        await installRuntime(name, descriptor, platformDescriptor);
    }
    if (unsupported.length) {
        console.log(
            `Native media runtimes are optional on ${platformKey}: ${unsupported.join(", ")}.`,
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
