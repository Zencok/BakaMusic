import { MakerBase, type MakerOptions } from "@electron-forge/maker-base";
import type { ForgePlatform } from "@electron-forge/shared-types";
import {
    buildForge,
    type CompressionLevel,
    type NsisOptions,
    type NsisWebOptions,
    type WindowsConfiguration,
} from "app-builder-lib";

type MakerNsisTarget = "nsis" | "nsis-web";

export function createNsisWebPackageUrl(
    baseUrl: string,
    packageName: string,
    version: string,
    arch: string,
    urlPrefix = "",
) {
    const encodedVersion = encodeURIComponent(version);
    const packageUrl = [
        baseUrl.replace(/\/$/, ""),
        `v${encodedVersion}`,
        `${packageName}-${encodedVersion}-${arch}.nsis.7z`,
    ].join("/");
    return `${urlPrefix}${packageUrl}`;
}

export interface MakerNsisConfig {
    appId: string;
    compression?: CompressionLevel;
    nsis: NsisOptions;
    nsisWeb?: NsisWebOptions;
    targets?: MakerNsisTarget[];
    webPackageBaseUrl?: string;
    webPackageName?: string;
    webPackageUrlPrefix?: string;
    win?: WindowsConfiguration;
}

/**
 * Adapts electron-builder's NSIS target to the Forge 7 maker interface while
 * consuming the application directory already packaged by Forge.
 */
export class MakerNsis extends MakerBase<MakerNsisConfig> {
    name = "nsis";

    defaultPlatforms: ForgePlatform[] = ["win32"];

    isSupportedOnCurrentPlatform() {
        return process.platform === "win32";
    }

    async make(options: MakerOptions) {
        const targets = this.config.targets ?? ["nsis"];
        const version = String(options.packageJSON.version);
        const webPackageUrl = this.config.webPackageBaseUrl == null
            ? this.config.nsisWeb?.appPackageUrl
            : createNsisWebPackageUrl(
                this.config.webPackageBaseUrl,
                this.config.webPackageName ?? options.packageJSON.name,
                version,
                options.targetArch,
                this.config.webPackageUrlPrefix,
            );

        return buildForge(
            { dir: options.dir },
            {
                // Release assets are uploaded by GitHub Actions (gh release),
                // not by electron-builder's implicit on-tag publisher.
                publish: "never",
                win: targets.map((target) => `${target}:${options.targetArch}`),
                config: {
                    appId: this.config.appId,
                    compression: this.config.compression ?? "maximum",
                    directories: {
                        output: options.makeDir,
                    },
                    productName: options.packageJSON.productName ?? options.appName,
                    win: this.config.win,
                    nsis: this.config.nsis,
                    nsisWeb: this.config.nsisWeb == null ? undefined : {
                        ...this.config.nsisWeb,
                        appPackageUrl: webPackageUrl,
                    },
                },
            },
        );
    }
}
