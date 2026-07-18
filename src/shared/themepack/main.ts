import {
    app,
    ipcMain,
    net,
    protocol,
} from "electron";
import axios from "axios";
import { createHash } from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { pathToFileURL } from "url";
import { rimraf } from "rimraf";
import { nanoid } from "nanoid";
import type { Entry } from "unzipper";
import createUnzipParser from "unzipper/lib/parse";
import {
    assertIpcSender,
    assertPathAccess,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";
import { parseThemeCss, validateThemePackConfig } from "./contract";
import {
    BUILTIN_DEFAULT_THEME_PATH,
    THEME_SPEC_V2,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const THEME_PROTOCOL = "bakamusic-theme";
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_THEME_TEXT_BYTES = 2 * 1024 * 1024;
const REQUIRED_FILES = ["config.json", "index.css"] as const;

const themeRootsByToken = new Map<string, string>();
let protocolSchemeRegistered = false;
let themeMainSetup = false;

function assertHttpsRedirect(options: { protocol?: string }) {
    if (options.protocol !== "https:") {
        throw new Error("Theme redirect protocol is not accepted");
    }
}

function getThemeSearchRoots() {
    return [
        path.resolve(app.getPath("userData"), "bakamusic-themepacks"),
        path.resolve(app.getPath("userData"), "musicfree-themepacks"),
    ] as const;
}

function isWithin(candidate: string, root: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || (
        relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
    );
}

function assertThemeRoot(candidate: string) {
    const resolved = fsSync.realpathSync.native(path.resolve(candidate));
    const roots = getThemeSearchRoots().map((root) => {
        try {
            return fsSync.realpathSync.native(path.resolve(root));
        } catch {
            return path.resolve(root);
        }
    });
    if (!roots.some((root) => isWithin(resolved, root))) {
        throw new Error("Theme path is outside the theme repositories");
    }
    return resolved;
}

function themeBaseUrl(token: string) {
    return `${THEME_PROTOCOL}://${token}/`;
}

function addTailSlash(value: string) {
    return value.endsWith("/") ? value : `${value}/`;
}

function replaceThemeAlias(value: string, baseUrl: string) {
    return value.replaceAll("@/", addTailSlash(baseUrl));
}

function normalizeArchiveEntryPath(entryPath: string) {
    return entryPath
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/^[A-Za-z]:/, "")
        .replace(/\/$/, "");
}

function resolveThemeFile(root: string, relativePath: string) {
    const target = path.resolve(root, relativePath);
    if (target !== root && !isWithin(target, root)) {
        throw new Error("Theme asset escapes its pack root");
    }
    const realTarget = fsSync.realpathSync.native(target);
    if (!isWithin(realTarget, root)) {
        throw new Error("Theme asset resolves outside its pack root");
    }
    return realTarget;
}

function resolveThemeAsset(root: string, aliasPath: string) {
    if (!aliasPath.startsWith("@/")) {
        throw new Error("Theme asset must use the @/ prefix");
    }
    return resolveThemeFile(root, aliasPath.slice(2));
}

async function ensureThemeRepository() {
    const [nextRoot] = getThemeSearchRoots();
    try {
        const stat = await fs.stat(nextRoot);
        if (!stat.isDirectory()) {
            await rimraf(nextRoot);
            throw new Error("Theme repository is not a directory");
        }
    } catch {
        await fs.mkdir(nextRoot, { recursive: true });
    }
}

async function findThemePackRoot(targetPath: string, depth = 0): Promise<string | null> {
    if (!targetPath || depth > 3) {
        return null;
    }
    try {
        const stat = await fs.stat(targetPath);
        if (!stat.isDirectory()) {
            return null;
        }
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const entryNames = new Set(entries.map((entry) => entry.name));
        if (REQUIRED_FILES.every((fileName) => entryNames.has(fileName))) {
            return targetPath;
        }
        for (const entry of entries) {
            if (
                entry.isDirectory()
                && !entry.name.startsWith(".")
                && entry.name !== "__MACOSX"
            ) {
                const match = await findThemePackRoot(path.resolve(targetPath, entry.name), depth + 1);
                if (match) {
                    return match;
                }
            }
        }
    } catch {
        return null;
    }
    return null;
}

async function readBoundedText(filePath: string) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_THEME_TEXT_BYTES) {
        throw new Error("Theme text asset exceeds the accepted size");
    }
    return fs.readFile(filePath, "utf8");
}

async function parseThemePack(themePackPath: string): Promise<ICommon.IThemePack | null> {
    try {
        const foundRoot = await findThemePackRoot(themePackPath);
        if (!foundRoot) {
            return null;
        }
        const root = assertThemeRoot(foundRoot);
        const rawConfig = await readBoundedText(resolveThemeFile(root, "config.json"));
        const rawCss = await readBoundedText(resolveThemeFile(root, "index.css"));
        const jsonData = JSON.parse(rawConfig) as Record<string, unknown>;
        validateThemePackConfig(jsonData);
        const parsedCss = parseThemeCss(rawCss);
        if (parsedCss.tokens.get("--theme-scheme") !== jsonData.scheme) {
            throw new Error("config.scheme and --theme-scheme must match");
        }
        if (typeof jsonData.preview !== "string") {
            throw new Error("Theme preview is missing");
        }
        if (!jsonData.preview.startsWith("#")) {
            await fs.access(resolveThemeAsset(root, jsonData.preview));
        }
        const iframe = jsonData.iframe as { app: string } | undefined;
        if (iframe) {
            await fs.access(resolveThemeAsset(root, iframe.app));
        }

        const token = createHash("sha256")
            .update(root)
            .update("\0")
            .update(rawConfig)
            .update("\0")
            .update(rawCss)
            .digest("hex");
        const compatibilityHash = createHash("md5")
            .update(`${rawConfig}\n${rawCss}`)
            .digest("hex");
        themeRootsByToken.set(token, root);
        const baseUrl = themeBaseUrl(token);

        return {
            id: jsonData.id as string | undefined,
            spec: jsonData.spec as string,
            name: jsonData.name as string,
            author: jsonData.author as string | undefined,
            authorUrl: jsonData.authorUrl as string | undefined,
            version: jsonData.version as string | undefined,
            description: jsonData.description as string | undefined,
            createdAt: jsonData.createdAt as string | undefined,
            tags: jsonData.tags as string[] | undefined,
            scheme: jsonData.scheme as "light" | "dark",
            iframe,
            hash: compatibilityHash,
            preview: jsonData.preview.startsWith("#")
                ? jsonData.preview
                : replaceThemeAlias(jsonData.preview, baseUrl),
            path: baseUrl,
        };
    } catch {
        return null;
    }
}

async function extractThemePackArchive(archivePath: string, outputPath: string) {
    const archiveEntries = fsSync
        .createReadStream(archivePath)
        .pipe(createUnzipParser({ forceStream: true })) as AsyncIterable<Entry>;
    let entryCount = 0;
    let extractedBytes = 0;

    for await (const entry of archiveEntries) {
        entryCount++;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
            throw new Error("Theme archive has too many entries");
        }
        const normalized = normalizeArchiveEntryPath(entry.path);
        if (!normalized || normalized === "__MACOSX" || normalized.startsWith("__MACOSX/")) {
            await entry.autodrain().promise();
            continue;
        }
        const targetPath = path.resolve(outputPath, normalized);
        if (targetPath !== outputPath && !isWithin(targetPath, outputPath)) {
            await entry.autodrain().promise();
            throw new Error("Theme archive entry escapes the output directory");
        }
        if (entry.type === "Directory") {
            await fs.mkdir(targetPath, { recursive: true });
            await entry.autodrain().promise();
            continue;
        }
        if (entry.type !== "File") {
            await entry.autodrain().promise();
            continue;
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        let entryBytes = 0;
        const limiter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                entryBytes += chunk.length;
                extractedBytes += chunk.length;
                if (entryBytes > MAX_ENTRY_BYTES || extractedBytes > MAX_EXTRACTED_BYTES) {
                    callback(new Error("Theme archive expands beyond the accepted size"));
                    return;
                }
                callback(null, chunk);
            },
        });
        await pipeline(entry, limiter, fsSync.createWriteStream(targetPath, { flags: "wx" }));
    }
}

async function hoistThemeRoot(themeRoot: string, cacheFolder: string) {
    if (themeRoot === cacheFolder) {
        return cacheFolder;
    }
    const entries = await fs.readdir(themeRoot, { withFileTypes: true });
    for (const entry of entries) {
        await fs.rename(
            path.resolve(themeRoot, entry.name),
            path.resolve(cacheFolder, entry.name),
        );
    }
    const wrapper = path.relative(cacheFolder, themeRoot).split(path.sep)[0];
    if (wrapper) {
        await rimraf(path.resolve(cacheFolder, wrapper));
    }
    return cacheFolder;
}

async function installThemePack(archivePath: string) {
    await ensureThemeRepository();
    const sourcePath = assertPathAccess(archivePath, {
        extensions: [".mftheme", ".zip"],
    });
    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size > MAX_ARCHIVE_BYTES) {
        throw new Error("Theme archive exceeds the accepted size");
    }
    const [themeRoot] = getThemeSearchRoots();
    const cacheFolder = path.resolve(themeRoot, nanoid(12));
    try {
        await fs.mkdir(cacheFolder, { recursive: true });
        await extractThemePackArchive(sourcePath, cacheFolder);
        const packRoot = await findThemePackRoot(cacheFolder);
        if (!packRoot) {
            throw new Error("Theme archive does not contain a valid pack");
        }
        await hoistThemeRoot(packRoot, cacheFolder);
        const pack = await parseThemePack(cacheFolder);
        if (!pack || pack.spec !== THEME_SPEC_V2) {
            throw new Error(`Theme pack must use ${THEME_SPEC_V2}`);
        }
        return pack;
    } catch (error) {
        await rimraf(cacheFolder);
        throw error;
    }
}

async function installRemoteThemePack(remoteUrl: string) {
    const parsedUrl = assertUrl(remoteUrl, ["https:"], 8192);
    const response = await axios.get<ArrayBuffer>(parsedUrl.toString(), {
        responseType: "arraybuffer",
        timeout: 30_000,
        maxRedirects: 5,
        beforeRedirect: assertHttpsRedirect,
        maxContentLength: MAX_ARCHIVE_BYTES,
        maxBodyLength: MAX_ARCHIVE_BYTES,
    });
    const data = Buffer.from(response.data);
    if (!data.length || data.length > MAX_ARCHIVE_BYTES) {
        throw new Error("Theme download size is not accepted");
    }
    const temporaryPath = path.resolve(app.getPath("temp"), `${nanoid(16)}.mftheme`);
    try {
        await fs.writeFile(temporaryPath, data, { flag: "wx" });
        return await installThemePack(temporaryPath);
    } finally {
        await fs.rm(temporaryPath, { force: true });
    }
}

async function loadThemePacks() {
    await ensureThemeRepository();
    const packs: ICommon.IThemePack[] = [];
    const keys = new Set<string>();
    for (const searchRoot of getThemeSearchRoots()) {
        let entries: string[];
        try {
            entries = await fs.readdir(searchRoot);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const pack = await parseThemePack(path.resolve(searchRoot, entry));
            const key = pack?.id || pack?.hash || pack?.path;
            if (pack && key && !keys.has(key)) {
                keys.add(key);
                packs.push(pack);
            }
        }
    }
    return packs;
}

async function resolvePackFromSelection(selection: string | null) {
    if (!selection || selection === BUILTIN_DEFAULT_THEME_PATH) {
        return createBuiltinDefaultThemePack();
    }
    if (selection.startsWith(`${THEME_PROTOCOL}://`)) {
        const token = new URL(selection).hostname;
        let root = themeRootsByToken.get(token);
        if (!root) {
            await loadThemePacks();
            root = themeRootsByToken.get(token);
        }
        return root ? await parseThemePack(root) : createBuiltinDefaultThemePack();
    }
    try {
        return await parseThemePack(assertThemeRoot(selection))
            ?? createBuiltinDefaultThemePack();
    } catch {
        return createBuiltinDefaultThemePack();
    }
}

function resolveRegisteredRoot(themeUrl: string) {
    assertString(themeUrl, "theme URL", 8192);
    const parsed = new URL(themeUrl);
    if (parsed.protocol !== `${THEME_PROTOCOL}:`) {
        throw new Error("Theme URL protocol is not accepted");
    }
    const root = themeRootsByToken.get(parsed.hostname);
    if (!root) {
        throw new Error("Theme pack is not registered");
    }
    return root;
}

async function readThemeContents(themeUrl: string) {
    const root = resolveRegisteredRoot(themeUrl);
    const rawCss = await readBoundedText(resolveThemeFile(root, "index.css"));
    const rawConfig = await readBoundedText(resolveThemeFile(root, "config.json"));
    const config = JSON.parse(rawConfig) as Record<string, unknown>;
    validateThemePackConfig(config);
    const iframe = config.iframe as { app: string } | undefined;
    const iframeHtml = iframe
        ? await readBoundedText(resolveThemeAsset(root, iframe.app))
        : null;
    return { rawCss, iframeHtml };
}

async function uninstallThemePack(themePack: ICommon.IThemePack) {
    if (isBuiltinDefaultTheme(themePack)) {
        return;
    }
    const root = resolveRegisteredRoot(themePack.path);
    themeRootsByToken.forEach((registeredRoot, token) => {
        if (registeredRoot === root) {
            themeRootsByToken.delete(token);
        }
    });
    await rimraf(assertThemeRoot(root));
}

export function registerThemeProtocolScheme() {
    if (protocolSchemeRegistered) {
        return;
    }
    protocolSchemeRegistered = true;
    protocol.registerSchemesAsPrivileged([{
        scheme: THEME_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    }]);
}

export async function setupThemePackMain() {
    if (themeMainSetup) {
        return;
    }
    themeMainSetup = true;
    await ensureThemeRepository();
    protocol.handle(THEME_PROTOCOL, async (request) => {
        try {
            const parsed = new URL(request.url);
            const root = themeRootsByToken.get(parsed.hostname);
            if (!root) {
                return new Response("Theme pack not found", { status: 404 });
            }
            const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
            if (!relativePath) {
                return new Response("Theme asset path rejected", { status: 403 });
            }
            const assetPath = resolveThemeFile(root, relativePath);
            if (!(await fs.stat(assetPath)).isFile()) {
                return new Response("Theme asset is not a file", { status: 404 });
            }
            return net.fetch(pathToFileURL(assetPath).toString());
        } catch {
            return new Response("Theme asset request rejected", { status: 400 });
        }
    });

    ipcMain.handle("@shared/themepack/init-current", async (event, selection) => {
        assertIpcSender(event, ["main"]);
        if (selection !== null) {
            assertString(selection, "theme selection", 8192);
        }
        return resolvePackFromSelection(selection);
    });
    ipcMain.handle("@shared/themepack/load-all", async (event) => {
        assertIpcSender(event, ["main"]);
        return loadThemePacks();
    });
    ipcMain.handle("@shared/themepack/read-contents", async (event, themeUrl) => {
        assertIpcSender(event, ["main"]);
        return readThemeContents(themeUrl);
    });
    ipcMain.handle("@shared/themepack/install-local", async (event, archivePath) => {
        assertIpcSender(event, ["main"]);
        assertString(archivePath, "theme archive path", 32768);
        return installThemePack(archivePath);
    });
    ipcMain.handle("@shared/themepack/install-remote", async (event, remoteUrl) => {
        assertIpcSender(event, ["main"]);
        assertString(remoteUrl, "theme URL", 8192);
        return installRemoteThemePack(remoteUrl);
    });
    ipcMain.handle("@shared/themepack/uninstall", async (event, themePack) => {
        assertIpcSender(event, ["main"]);
        if (!themePack || typeof themePack !== "object") {
            throw new Error("Theme pack is not valid");
        }
        return uninstallThemePack(themePack);
    });
}
