import fs from "fs";
import path from "path";
import type { ForgeConfig } from "@electron-forge/shared-types";

interface IPackageMetadata {
    name?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

const runtimeDependencyAllowlists = new Map<string, ReadonlySet<string>>([
    ["get-windows", new Set([
        "@mapbox/node-pre-gyp",
    ])],
    ["@mapbox/node-pre-gyp", new Set([
        "consola",
        "detect-libc",
        "nopt",
        "semver",
    ])],
]);

function findPackageDirectory(
    packageName: string,
    searchDirectory: string,
    optional = false,
) {
    let currentDirectory = searchDirectory;

    while (true) {
        const packageDirectory = path.join(currentDirectory, "node_modules", packageName);
        const packagePath = path.join(packageDirectory, "package.json");
        if (fs.existsSync(packagePath)) {
            const metadata = JSON.parse(
                fs.readFileSync(packagePath, "utf8"),
            ) as IPackageMetadata;
            if (metadata.name === packageName) {
                return {
                    directory: packageDirectory,
                    metadata,
                };
            }
        }

        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            if (optional) {
                return null;
            }
            throw new Error(`Failed to locate package root for ${packageName}`);
        }
        currentDirectory = parentDirectory;
    }
}

function collectRuntimePackageNames(
    rootPackageNames: string[],
    projectDirectory: string,
) {
    const packageNames = new Set<string>();
    const visitedDirectories = new Set<string>();

    const visitPackage = (
        packageName: string,
        searchDirectory: string,
        optional = false,
    ) => {
        const packageInfo = findPackageDirectory(
            packageName,
            searchDirectory,
            optional,
        );
        if (!packageInfo) {
            return;
        }

        const { directory, metadata } = packageInfo;
        if (visitedDirectories.has(directory)) {
            return;
        }

        visitedDirectories.add(directory);
        packageNames.add(packageName);
        const dependencyAllowlist = runtimeDependencyAllowlists.get(packageName);
        for (const dependencyName of Object.keys(metadata.dependencies ?? {})) {
            if (!dependencyAllowlist || dependencyAllowlist.has(dependencyName)) {
                visitPackage(dependencyName, directory);
            }
        }
        for (const dependencyName of Object.keys(
            metadata.optionalDependencies ?? {},
        )) {
            if (!dependencyAllowlist || dependencyAllowlist.has(dependencyName)) {
                visitPackage(dependencyName, directory, true);
            }
        }
    };

    for (const packageName of rootPackageNames) {
        visitPackage(packageName, projectDirectory);
    }

    return packageNames;
}

function shouldIncludePackagePath(file: string, packageNames: Set<string>) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (normalizedFile === "/node_modules") {
        return true;
    }

    for (const packageName of packageNames) {
        const packagePrefix = `/node_modules/${packageName}`;
        if (normalizedFile === packagePrefix || normalizedFile.startsWith(`${packagePrefix}/`)) {
            return true;
        }

        if (packageName.startsWith("@")) {
            const scopePrefix = `/node_modules/${packageName.split("/")[0]}`;
            if (normalizedFile === scopePrefix) {
                return true;
            }
        }
    }

    return false;
}

function getPackageRelativePath(file: string, packageName: string) {
    const normalizedFile = file.replaceAll("\\", "/");
    const packagePrefix = `/node_modules/${packageName}`;
    if (
        normalizedFile !== packagePrefix
        && !normalizedFile.startsWith(`${packagePrefix}/`)
    ) {
        return null;
    }

    return normalizedFile.slice(packagePrefix.length);
}

function isSharpRuntimePath(file: string) {
    const runtimePath = getPackageRelativePath(file, "sharp");
    if (runtimePath === null) {
        return null;
    }

    return runtimePath === ""
        || runtimePath === "/package.json"
        || runtimePath === "/LICENSE"
        || runtimePath === "/dist"
        || /^\/dist\/[^/]+\.cjs$/.test(runtimePath);
}

function isGetWindowsRuntimePath(file: string) {
    const runtimePath = getPackageRelativePath(file, "get-windows");
    if (runtimePath === null) {
        return null;
    }

    return runtimePath === ""
        || runtimePath === "/package.json"
        || runtimePath === "/index.js"
        || runtimePath === "/main"
        || runtimePath === "/lib"
        || runtimePath.startsWith("/lib/");
}

export function createExternalRuntimePlugin(rootPackageNames: string[]) {
    let projectDirectory = "";

    return {
        __isElectronForgePlugin: true,
        name: "include-external-runtime-dependencies",
        init(directory: string) {
            projectDirectory = directory;
        },
        getHooks() {
            return {
                resolveForgeConfig: async (forgeConfig: ForgeConfig) => {
                    const packageNames = collectRuntimePackageNames(
                        rootPackageNames,
                        projectDirectory,
                    );
                    forgeConfig.packagerConfig = forgeConfig.packagerConfig ?? {};
                    const existingIgnore = forgeConfig.packagerConfig.ignore;

                    forgeConfig.packagerConfig.ignore = (file: string) => {
                        for (const runtimePathFilter of [
                            isSharpRuntimePath,
                            isGetWindowsRuntimePath,
                        ]) {
                            const includeRuntimePath = runtimePathFilter(file);
                            if (includeRuntimePath !== null) {
                                return !includeRuntimePath;
                            }
                        }
                        if (shouldIncludePackagePath(file, packageNames)) {
                            return false;
                        }
                        return typeof existingIgnore === "function"
                            ? existingIgnore(file)
                            : true;
                    };
                    return forgeConfig;
                },
            };
        },
    } as NonNullable<ForgeConfig["plugins"]>[number];
}
