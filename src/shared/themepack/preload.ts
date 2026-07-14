import { addFileScheme, addTailSlash } from "@/common/file-util";
import path from "path";
import fsSync from "fs";
import fs from "fs/promises";
import { pipeline } from "stream/promises";
import { rimraf } from "rimraf";
import { nanoid } from "nanoid";
import unzipper from "unzipper";
import { getGlobalContext } from "../global-context/preload";
import CryptoJS from "crypto-js";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import { parseThemeCss, validateThemePackConfig } from "./contract";
import {
    BUILTIN_DEFAULT_THEME_CSS,
    BUILTIN_DEFAULT_THEME_HASH,
    BUILTIN_DEFAULT_THEME_PATH,
    THEME_SPEC_V2,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const themeNodeId = "themepack-node";
const themePathKey = "themepack-path";
const themePackRequiredFiles = ["config.json", "index.css"] as const;

function isThemeSpecV2(themePack: ICommon.IThemePack | null | undefined): boolean {
    return themePack?.spec === THEME_SPEC_V2;
}

function resolveThemeScheme(
    themePack: ICommon.IThemePack,
    themeTokens: ReadonlyMap<string, string>,
): "light" | "dark" {
    if (themePack.scheme === "dark" || themePack.scheme === "light") {
        return themePack.scheme;
    }
    const cssScheme = themeTokens.get("--theme-scheme");
    if (cssScheme === "dark" || cssScheme === "light") {
        return cssScheme;
    }
    // Fallback: dark text → light scheme, light text → dark scheme
    const text = themeTokens.get("--theme-text") ?? "";
    const rgb = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb) {
        const r = Number(rgb[1]);
        const g = Number(rgb[2]);
        const b = Number(rgb[3]);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return lum > 0.55 ? "dark" : "light";
    }
    if (/#([0-9a-f]{3}|[0-9a-f]{6})\b/i.test(text)) {
        const hex = text.trim();
        const short = hex.length === 4;
        const full = short
            ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
            : hex;
        const n = Number.parseInt(full.slice(1), 16);
        if (!Number.isNaN(n)) {
            const r = (n >> 16) & 255;
            const g = (n >> 8) & 255;
            const b = n & 255;
            const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            return lum > 0.55 ? "dark" : "light";
        }
    }
    return "light";
}

function applyThemeDocumentAttrs(
    themePack: ICommon.IThemePack,
    themeTokens: ReadonlyMap<string, string>,
) {
    document.documentElement.setAttribute("data-theme-spec", "2");
    const scheme = resolveThemeScheme(themePack, themeTokens);
    document.documentElement.setAttribute("data-theme-scheme", scheme);
    // Keep body in sync (index.html also sets data-ui-style on body)
    document.body?.setAttribute("data-theme-scheme", scheme);
    document.body?.setAttribute("data-theme-spec", "2");
}
let themeBackgroundIframe: HTMLIFrameElement | null = null;

const nextThemePackBasePath: string = path.resolve(
    getGlobalContext().appPath.userData,
    "./bakamusic-themepacks",
);
const legacyThemePackBasePath: string = path.resolve(
    getGlobalContext().appPath.userData,
    "./musicfree-themepacks",
);
const themePackSearchPaths = [nextThemePackBasePath, legacyThemePackBasePath] as const;

/**
 * TODO: iframe需要运行在独立的进程中，不然会影响到app的fps 得想个办法
 */

function clearThemeIframes() {
    themeBackgroundIframe?.remove();
    themeBackgroundIframe = null;
}

function getOrCreateThemeStyleNode(): HTMLStyleElement {
    let themeNode = document.querySelector(`#${themeNodeId}`) as HTMLStyleElement | null;
    if (!themeNode) {
        themeNode = document.createElement("style");
        themeNode.id = themeNodeId;
    }
    // Always last in head so pack rules win equal-specificity battles too
    document.head.appendChild(themeNode);
    return themeNode;
}

function applyThemeCss(themePack: ICommon.IThemePack, rawStyle: string, aliasBasePath?: string) {
    const parsedThemeCss = parseThemeCss(rawStyle);
    const themeNode = getOrCreateThemeStyleNode();
    applyThemeDocumentAttrs(themePack, parsedThemeCss.tokens);
    themeNode.textContent = aliasBasePath
        ? replaceAlias(parsedThemeCss.css, aliasBasePath)
        : parsedThemeCss.css;
}

function resolvePackAssetPath(aliasPath: string, basePath: string): string {
    if (!aliasPath.startsWith("@/")) {
        throw new Error(`Theme asset must use @/: ${aliasPath}`);
    }
    const resolvedBasePath = path.resolve(basePath);
    const resolvedAssetPath = path.resolve(resolvedBasePath, aliasPath.slice(2));
    const safeBasePath = `${resolvedBasePath}${path.sep}`;
    if (!resolvedAssetPath.startsWith(safeBasePath)) {
        throw new Error(`Theme asset escapes pack root: ${aliasPath}`);
    }
    return resolvedAssetPath;
}

async function applyThemeIframe(themePack: ICommon.IThemePack) {
    clearThemeIframes();
    const iframeSource = themePack.iframe?.app;
    if (!iframeSource) {
        return;
    }

    const rawHtml = await fs.readFile(
        resolvePackAssetPath(iframeSource, themePack.path),
        "utf-8",
    );
    const iframeNode = document.createElement("iframe");
    iframeNode.setAttribute("sandbox", "allow-scripts");
    iframeNode.setAttribute("aria-hidden", "true");
    iframeNode.scrolling = "no";
    iframeNode.srcdoc = replaceAlias(rawHtml, themePack.path);
    document.querySelector(".app-container")?.prepend(iframeNode);
    themeBackgroundIframe = iframeNode;
}

/** 选择某个主题（仅 bakamusic-theme@2；null → 内置默认 V2） */
async function selectTheme(themePack: ICommon.IThemePack | null) {
    // Built-in default is a first-class V2 pack (not “no theme”)
    if (themePack === null || isBuiltinDefaultTheme(themePack)) {
        const builtin = createBuiltinDefaultThemePack(themePack?.name);
        clearThemeIframes();
        applyThemeCss(builtin, BUILTIN_DEFAULT_THEME_CSS);
        localStorage.setItem(themePathKey, BUILTIN_DEFAULT_THEME_PATH);
        return;
    }

    if (!isThemeSpecV2(themePack)) {
        throw new Error(
            `Unsupported theme spec (need ${THEME_SPEC_V2}, got ${themePack.spec || "missing"})`,
        );
    }

    if (!themePack.path || themePack.path === BUILTIN_DEFAULT_THEME_PATH) {
        const builtin = createBuiltinDefaultThemePack(themePack.name);
        clearThemeIframes();
        applyThemeCss(builtin, BUILTIN_DEFAULT_THEME_CSS);
        localStorage.setItem(themePathKey, BUILTIN_DEFAULT_THEME_PATH);
        return;
    }

    const rawStyle = await fs.readFile(
        path.resolve(themePack.path, "index.css"),
        "utf-8",
    );
    applyThemeCss(themePack, rawStyle, themePack.path);

    await applyThemeIframe(themePack);
    localStorage.setItem(themePathKey, themePack.path);
}

/** 替换标记 */
function replaceAlias(
    rawText: string,
    basePath: string,
    withFileScheme = true,
) {
    return rawText.replaceAll(
        "@/",
        addTailSlash(withFileScheme ? addFileScheme(basePath) : basePath),
    );
}

async function checkPath() {
    // 路径:
    try {
        const res = await fs.stat(nextThemePackBasePath);
        if (!res.isDirectory()) {
            await rimraf(nextThemePackBasePath);
            throw new Error();
        }
    } catch {
        await fs.mkdir(nextThemePackBasePath, {
            recursive: true,
        });
    }
}

const downloadResponse = async (response: Response, filePath: string) => {
    if (!response.ok) {
        throw new Error(
            `Download failed with status ${response.status}: ${response.statusText}`,
        );
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
};

async function findThemePackRoot(
    targetPath: string,
    currentDepth = 0,
): Promise<string | null> {
    if (!targetPath) {
        return null;
    }

    try {
        const stat = await fs.stat(targetPath);
        if (!stat.isDirectory()) {
            return null;
        }

        const entries = await fs.readdir(targetPath, {
            withFileTypes: true,
        });
        const entryNames = entries.map((entry) => entry.name);
        const isThemeRoot = themePackRequiredFiles.every((fileName) =>
            entryNames.includes(fileName),
        );

        if (isThemeRoot) {
            return targetPath;
        }

        if (currentDepth >= 3) {
            return null;
        }

        const directoryEntries = entries.filter(
            (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith(".") &&
                entry.name !== "__MACOSX",
        );

        for (const entry of directoryEntries) {
            const matchedPath = await findThemePackRoot(
                path.resolve(targetPath, entry.name),
                currentDepth + 1,
            );
            if (matchedPath) {
                return matchedPath;
            }
        }

        return null;
    } catch {
        return null;
    }
}

async function parseThemePack(
    themePackPath: string,
): Promise<ICommon.IThemePack | null> {
    try {
        if (!themePackPath) {
            return null;
        }

        const resolvedThemePackPath = await findThemePackRoot(themePackPath);
        if (!resolvedThemePackPath) {
            throw new Error("Not Valid Theme Pack");
        }

        const rawConfig = await fs.readFile(
            path.resolve(resolvedThemePackPath, "config.json"),
            "utf-8",
        );
        const jsonData = JSON.parse(rawConfig) as Record<string, unknown>;
        validateThemePackConfig(jsonData);
        const rawCss = await fs.readFile(
            path.resolve(resolvedThemePackPath, "index.css"),
            "utf-8",
        );
        const parsedCss = parseThemeCss(rawCss);
        if (parsedCss.tokens.get("--theme-scheme") !== jsonData.scheme) {
            throw new Error("config.scheme and --theme-scheme must match");
        }
        if (typeof jsonData.preview === "string" && !jsonData.preview.startsWith("#")) {
            await fs.access(resolvePackAssetPath(jsonData.preview, resolvedThemePackPath));
        }
        const iframe = jsonData.iframe as { app: string } | undefined;
        if (iframe) {
            await fs.access(resolvePackAssetPath(iframe.app, resolvedThemePackPath));
        }

        const themePack: ICommon.IThemePack = {
            id: jsonData.id as string | undefined,
            spec: jsonData.spec as string,
            name: jsonData.name as string,
            author: jsonData.author as string,
            authorUrl: jsonData.authorUrl as string | undefined,
            version: jsonData.version as string,
            description: jsonData.description as string,
            createdAt: jsonData.createdAt as string | undefined,
            tags: jsonData.tags as string[],
            scheme: jsonData.scheme as "light" | "dark",
            iframe,
            hash: CryptoJS.MD5(`${rawConfig}\n${rawCss}`).toString(CryptoJS.enc.Hex),
            preview: (jsonData.preview as string).startsWith("#")
                ? jsonData.preview as string
                : (jsonData.preview as string).replace(
                    "@/",
                    addTailSlash(addFileScheme(resolvedThemePackPath)),
                ),
            path: resolvedThemePackPath,
        };
        return themePack;
    } catch {
        return null;
    }
}

function normalizeThemePackEntryPath(entryPath: string) {
    return entryPath
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/^[A-Za-z]:/, "")
        .replace(/\/$/, "");
}

async function extractThemePackArchive(
    themePackPath: string,
    outputPath: string,
) {
    const zipDirectory = await unzipper.Open.file(themePackPath);
    const safeOutputRoot = `${outputPath}${path.sep}`;

    for (const entry of zipDirectory.files) {
        const normalizedEntryPath = normalizeThemePackEntryPath(entry.path);
        if (
            !normalizedEntryPath ||
            normalizedEntryPath === "__MACOSX" ||
            normalizedEntryPath.startsWith("__MACOSX/")
        ) {
            continue;
        }

        const targetPath = path.resolve(outputPath, normalizedEntryPath);
        if (targetPath !== outputPath && !targetPath.startsWith(safeOutputRoot)) {
            continue;
        }

        if (entry.type === "Directory") {
            await fs.mkdir(targetPath, {
                recursive: true,
            });
            continue;
        }

        await fs.mkdir(path.dirname(targetPath), {
            recursive: true,
        });

        await pipeline(entry.stream(), fsSync.createWriteStream(targetPath));
    }
}

async function hoistThemePackRoot(themePackRoot: string, cacheFolder: string) {
    if (themePackRoot === cacheFolder) {
        return cacheFolder;
    }

    const rootEntries = await fs.readdir(themePackRoot, {
        withFileTypes: true,
    });

    for (const entry of rootEntries) {
        await fs.rename(
            path.resolve(themePackRoot, entry.name),
            path.resolve(cacheFolder, entry.name),
        );
    }

    const relativeRootPath = path.relative(cacheFolder, themePackRoot);
    const firstWrapperDir = relativeRootPath.split(path.sep)[0];
    if (firstWrapperDir) {
        await rimraf(path.resolve(cacheFolder, firstWrapperDir));
    }

    return cacheFolder;
}

/** 加载所有的主题包 */
async function initCurrentTheme() {
    try {
        await checkPath();
        const currentThemePath = localStorage.getItem(themePathKey);
        if (!currentThemePath || currentThemePath === BUILTIN_DEFAULT_THEME_PATH) {
            return createBuiltinDefaultThemePack();
        }
        const currentTheme: ICommon.IThemePack | null = await parseThemePack(
            currentThemePath,
        );
        return currentTheme;
    } catch {
        return createBuiltinDefaultThemePack();
    }
}

async function loadThemePacks() {
    const parsedThemePacks: ICommon.IThemePack[] = [];
    const loadedThemeKeys = new Set<string>();

    // Read both the current and historical storage roots. Creating the new
    // folder must never make already-installed themes disappear.
    for (const themePackSearchPath of themePackSearchPaths) {
        let themePackDirNames: string[];
        try {
            themePackDirNames = await fs.readdir(themePackSearchPath);
        } catch {
            continue;
        }

        for (const themePackDir of themePackDirNames) {
            const themePackDirPath = path.resolve(themePackSearchPath, themePackDir);
            const themePackRoot = await findThemePackRoot(themePackDirPath);
            if (!themePackRoot) {
                continue;
            }

            const parsedThemePack = await parseThemePack(themePackRoot);
            const themeKey = parsedThemePack?.id || parsedThemePack?.hash || parsedThemePack?.path;
            if (parsedThemePack && themeKey && !loadedThemeKeys.has(themeKey)) {
                loadedThemeKeys.add(themeKey);
                parsedThemePacks.push(parsedThemePack);
            }
        }
    }
    return parsedThemePacks;
}

async function installRemoteThemePack(remoteUrl: string) {
    const cacheFilePath = path.resolve(
        getGlobalContext().appPath.temp,
        `./${nanoid()}.mftheme`,
    );
    try {
        const resp = await fetch(remoteUrl);
        await downloadResponse(resp, cacheFilePath);
        const config = await installThemePack(cacheFilePath);
        if (!config) {
            throw new Error("Download fail");
        }
        return config;
    } finally {
        await rimraf(cacheFilePath);
    }
}

async function installThemePack(themePackPath: string) {
    await checkPath();

    const cacheFolder = path.resolve(nextThemePackBasePath, nanoid(12));

    try {
        await fs.mkdir(cacheFolder, {
            recursive: true,
        });

        await extractThemePackArchive(themePackPath, cacheFolder);

        const themePackRoot = await findThemePackRoot(cacheFolder);
        if (!themePackRoot) {
            throw new Error("Not Valid Theme Pack");
        }

        const finalThemePackPath = await hoistThemePackRoot(
            themePackRoot,
            cacheFolder,
        );

        const parsedThemePack = await parseThemePack(finalThemePackPath);
        if (!parsedThemePack) {
            throw new Error("Not Valid Theme Pack");
        }
        if (!isThemeSpecV2(parsedThemePack)) {
            await rimraf(cacheFolder);
            throw new Error(
                `Unsupported theme spec (need ${THEME_SPEC_V2}, got ${parsedThemePack.spec || "missing"})`,
            );
        }

        return parsedThemePack;
    } catch (e) {
        await rimraf(cacheFolder);
        throw e instanceof Error ? e : new Error("Not Valid Theme Pack");
    }
}

async function uninstallThemePack(themePack: ICommon.IThemePack) {
    if (isBuiltinDefaultTheme(themePack) || themePack.path === BUILTIN_DEFAULT_THEME_PATH) {
        return;
    }
    return await rimraf(themePack.path);
}

export const mod = {
    selectTheme,
    initCurrentTheme,
    loadThemePacks,
    installThemePack,
    uninstallThemePack,
    installRemoteThemePack,
    replaceAlias,
    THEME_SPEC_V2,
    isThemeSpecV2,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
    BUILTIN_DEFAULT_THEME_PATH,
    BUILTIN_DEFAULT_THEME_HASH,
};

exposeInMainWorld("@shared/themepack", mod);
