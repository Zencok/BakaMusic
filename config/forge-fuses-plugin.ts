import path from "path";
import {
    flipFuses,
    type FuseConfig,
} from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

/**
 * Forge's published fuse plugin currently peers on @electron/fuses 1.x, while
 * Electron 43 carries the ninth V1 fuse. Keep this tiny hook local so strict
 * fuse coverage follows Electron without relaxing npm's peer-dependency checks.
 */
export function createFusesPlugin(fusesConfig: FuseConfig) {
    return {
        __isElectronForgePlugin: true,
        name: "fuses",
        init() {
            return undefined;
        },
        getHooks() {
            return {
                packageAfterCopy: async (
                    forgeConfig,
                    resourcesAppPath,
                    _electronVersion,
                    platform,
                    arch,
                ) => {
                    const applePlatform = platform === "darwin" || platform === "mas";
                    const basePath = path.resolve(resourcesAppPath, "../..");
                    const executablePath = applePlatform
                        ? path.join(basePath, "MacOS", "Electron")
                        : path.join(basePath, platform === "win32" ? "electron.exe" : "electron");
                    const osxSign = forgeConfig.packagerConfig?.osxSign;
                    const hasOsxSign = typeof osxSign === "object"
                        ? Object.keys(osxSign).length > 0
                        : Boolean(osxSign);

                    await flipFuses(executablePath, {
                        resetAdHocDarwinSignature:
                            applePlatform && arch === "arm64" && !hasOsxSign,
                        ...fusesConfig,
                    });
                },
            };
        },
    } as NonNullable<ForgeConfig["plugins"]>[number];
}
