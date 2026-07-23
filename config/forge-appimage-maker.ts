import { MakerBase, type MakerOptions } from "@electron-forge/maker-base";
import type { ForgePlatform } from "@electron-forge/shared-types";
import {
    buildForge,
    type AppImageOptions,
    type CompressionLevel,
    type LinuxConfiguration,
} from "app-builder-lib";

export interface MakerAppImageConfig {
    appId: string;
    appImage?: AppImageOptions;
    compression?: CompressionLevel;
    linux?: LinuxConfiguration;
}

/**
 * Adapts electron-builder's AppImage target to Forge 7 while reusing the
 * application directory and bundled media runtime already packaged by Forge.
 */
export class MakerAppImage extends MakerBase<MakerAppImageConfig> {
    name = "appimage";

    defaultPlatforms: ForgePlatform[] = ["linux"];

    isSupportedOnCurrentPlatform() {
        return process.platform === "linux";
    }

    async make(options: MakerOptions) {
        return buildForge(
            { dir: options.dir },
            {
                linux: [`AppImage:${options.targetArch}`],
                config: {
                    appId: this.config.appId,
                    appImage: this.config.appImage,
                    compression: this.config.compression ?? "maximum",
                    directories: {
                        output: options.makeDir,
                    },
                    linux: this.config.linux,
                    productName: options.packageJSON.productName ?? options.appName,
                },
            },
        );
    }
}
