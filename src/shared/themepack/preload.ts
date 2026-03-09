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

const themeNodeId = "themepack-node";
const themePathKey = "themepack-path";
const themePackRequiredFiles = ["config.json", "index.css"] as const;
const themeScrollbarHideRulePattern = /(^|})\s*([^{}]*::-webkit-scrollbar[^{}]*)\{[^{}]*display\s*:\s*none\s*!important;?[^{}]*\}/g;

const validIframeMap = new Map<
  "app" | "header" | "body" | "music-bar" | "side-bar" | "page",
  HTMLIFrameElement | null
>([
    ["app", null],
    ["header", null],
    ["body", null],
    ["music-bar", null],
    ["side-bar", null],
    ["page", null],
]);

const nextThemePackBasePath: string = path.resolve(
    getGlobalContext().appPath.userData,
    "./bakamusic-themepacks",
);
const legacyThemePackBasePath: string = path.resolve(
    getGlobalContext().appPath.userData,
    "./musicfree-themepacks",
);
const themePackBasePath: string =
    fsSync.existsSync(nextThemePackBasePath) || !fsSync.existsSync(legacyThemePackBasePath)
        ? nextThemePackBasePath
        : legacyThemePackBasePath;

/**
 * TODO: iframe需要运行在独立的进程中，不然会影响到app的fps 得想个办法
 */

/** 选择某个主题 */
async function selectTheme(themePack: ICommon.IThemePack | null) {
    const themeNode = document.querySelector(`#${themeNodeId}`);
    if (themePack === null) {
    // 移除
        themeNode.innerHTML = "";
        validIframeMap.forEach((value, key) => {
            if (value !== null) {
                value.remove();
                validIframeMap.set(key, null);
            }
        });
        localStorage.removeItem(themePathKey);
    } else {
        const rawStyle = await fs.readFile(
            path.resolve(themePack.path, "index.css"),
            "utf-8",
        );
        themeNode.innerHTML = replaceAlias(
            stripThemeScrollbarHidingRules(rawStyle),
            themePack.path,
        );

        if (themePack.iframe) {
            validIframeMap.forEach(async (value, key) => {
                const themePackIframeSource = themePack.iframe[key];
                if (themePackIframeSource) {
                    // 如果有，且当前也有
                    let iframeNode = null;
                    if (value !== null) {
                        // 移除旧的
                        value.remove();
                        validIframeMap.set(key, null);
                    }
                    // 新的iframe
                    iframeNode = document.createElement("iframe");
                    iframeNode.scrolling = "no";
                    document.querySelector(`.${key}-container`)?.prepend?.(iframeNode);
                    validIframeMap.set(key, iframeNode);

                    if (themePackIframeSource.startsWith("http")) {
                        iframeNode.src = themePackIframeSource;
                    } else {
                        const rawHtml = await fs.readFile(
                            replaceAlias(themePackIframeSource, themePack.path, false),
                            "utf-8",
                        );
                        iframeNode.contentWindow.document.open();
                        iframeNode.contentWindow.document.write(
                            replaceAlias(rawHtml, themePack.path),
                        );
                        iframeNode.contentWindow.document.close();
                    }
                } else if (value) {
                    value.remove();
                    validIframeMap.set(key, null);
                }
            });
        } else {
            validIframeMap.forEach((value, key) => {
                if (value !== null) {
                    value.remove();
                    validIframeMap.set(key, null);
                }
            });
        }
        localStorage.setItem(themePathKey, themePack.path);
    }
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

function stripThemeScrollbarHidingRules(rawStyle: string) {
    return rawStyle.replace(themeScrollbarHideRulePattern, "$1");
}

async function checkPath() {
    // 路径:
    try {
        const res = await fs.stat(themePackBasePath);
        if (!res.isDirectory()) {
            await rimraf(themePackBasePath);
            throw new Error();
        }
    } catch {
        await fs.mkdir(themePackBasePath, {
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
        const jsonData = JSON.parse(rawConfig);

        const themePack: ICommon.IThemePack = {
            ...jsonData,
            hash: CryptoJS.MD5(rawConfig).toString(CryptoJS.enc.Hex),
            preview: jsonData.preview?.startsWith?.("#")
                ? jsonData.preview
                : jsonData.preview?.replace?.(
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
        const currentTheme: ICommon.IThemePack | null = await parseThemePack(
            currentThemePath,
        );
        return currentTheme;
    } catch {
        return null;
    }
}

async function loadThemePacks() {
    const themePackDirNames = await fs.readdir(themePackBasePath);
    const parsedThemePacks: ICommon.IThemePack[] = [];

    for (const themePackDir of themePackDirNames) {
        const themePackDirPath = path.resolve(themePackBasePath, themePackDir);
        const themePackRoot = await findThemePackRoot(themePackDirPath);
        if (!themePackRoot) {
            continue;
        }

        const parsedThemePack = await parseThemePack(themePackRoot);
        if (parsedThemePack) {
            parsedThemePacks.push(parsedThemePack);
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

    const cacheFolder = path.resolve(themePackBasePath, nanoid(12));

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

        return parsedThemePack;
    } catch (e) {
        await rimraf(cacheFolder);
        throw e instanceof Error ? e : new Error("Not Valid Theme Pack");
    }
}

async function uninstallThemePack(themePack: ICommon.IThemePack) {
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
};

exposeInMainWorld("@shared/themepack", mod);
