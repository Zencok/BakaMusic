import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ForgeConfig } from "@electron-forge/shared-types";

const execFileAsync = promisify(execFile);

/**
 * Forge's osxSign only runs with a real Developer ID identity. Without one,
 * nothing re-signs the packaged .app: the fuses plugin re-signs the main
 * executable, but nested helper bundles keep upstream signatures and — more
 * importantly — the loose Mach-O files under Contents/Resources (koffi.node,
 * the libmpv runtime dylibs) are never covered by `codesign --deep`. macOS
 * spawns Chromium utility children with CS_KILL|CS_HARD, so one stale
 * signature SIGKILLs the whole utility process. This plugin runs
 * scripts/sign-macos-bundle.cjs after packaging to ad-hoc sign every Mach-O
 * in the bundle and seal the outer app.
 */
export function createMacosBundleSignPlugin() {
    return {
        __isElectronForgePlugin: true,
        name: "macos-bundle-sign",
        init() {
            return undefined;
        },
        getHooks() {
            return {
                postPackage: async (_forgeConfig, packageResult) => {
                    if (packageResult.platform !== "darwin" && packageResult.platform !== "mas") {
                        return undefined;
                    }
                    // With a real identity, osxSign already sealed the bundle;
                    // keep this fallback strictly for the unsigned path.
                    if (process.env.MACOS_SIGN_IDENTITY) {
                        return undefined;
                    }
                    const scriptPath = path.resolve(__dirname, "../scripts/sign-macos-bundle.cjs");
                    for (const appPath of resolveAppBundles(packageResult.outputPaths)) {
                        console.log(`==> macos-bundle-sign: ad-hoc signing ${appPath}`);
                        const { stdout } = await execFileAsync(
                            process.execPath,
                            [scriptPath, appPath],
                            { windowsHide: true },
                        );
                        if (stdout.trim()) {
                            console.log(stdout.trim());
                        }
                    }
                    return undefined;
                },
            };
        },
    } as NonNullable<ForgeConfig["plugins"]>[number];
}

function resolveAppBundles(outputPaths: string[]): string[] {
    const bundles: string[] = [];
    for (const outputPath of outputPaths) {
        if (path.extname(outputPath) === ".app" && fs.existsSync(outputPath)) {
            bundles.push(outputPath);
            continue;
        }
        // @electron/packager may report the parent directory; resolve the
        // single .app bundle inside it.
        const children = fs.existsSync(outputPath)
            ? fs.readdirSync(outputPath)
                .filter((name) => name.endsWith(".app"))
                .map((name) => path.join(outputPath, name))
            : [];
        if (children.length === 0) {
            throw new Error(`macos-bundle-sign: no .app bundle found under ${outputPath}`);
        }
        bundles.push(...children);
    }
    return bundles;
}
