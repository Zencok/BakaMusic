import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

import { mainConfig } from "./config/webpack.main.config";
import { rendererConfig } from "./config/webpack.renderer.config";
import { githubAcceleratorPrefixes } from "./src/common/constant";
import { createExternalRuntimePlugin } from "./config/forge-external-runtime-plugin";
import { createFusesPlugin } from "./config/forge-fuses-plugin";
import { createMacosBundleSignPlugin } from "./config/forge-macos-sign-plugin";
import { MakerAppImage } from "./config/forge-appimage-maker";
import { MakerNsis } from "./config/forge-nsis-maker";
import path from "path";

const windowsSigningConfigured = !!(
    process.env.WINDOWS_CERTIFICATE_FILE
    && process.env.WINDOWS_CERTIFICATE_PASSWORD
);
const macSigningConfigured = !!process.env.MACOS_SIGN_IDENTITY;
const nsisWebGithubAccelerator = process.env.NSIS_WEB_GITHUB_ACCELERATOR
    ?? githubAcceleratorPrefixes[0];

// Sign only when credentials are provided. Without a Developer ID the build
// falls back to ad-hoc signing: the fuses plugin re-signs the main executable
// after flipping fuses, and the macos-bundle-sign plugin re-signs every loose
// Mach-O plus nested helpers after packaging. Plain ad-hoc signatures carry
// no hardened runtime and no entitlements, so Library Validation stays off;
// what actually kills utility processes on macOS is *invalid* signatures
// (stale page hashes), which the bundle signer repairs at package time.
// The allowLoadingUnsignedLibraries flag in native-playback routes the
// utility process through the Plugin Helper for the signed-with-identity
// path.
const macSignOptions = macSigningConfigured ? {
    identity: process.env.MACOS_SIGN_IDENTITY,
    identityValidation: true,
    hardenedRuntime: true,
    // Do not run spctl assessment after signing — that is a verify gate.
    gatekeeperAssess: false,
} : undefined;

const nativeSourceIgnorePlugin = {
    __isElectronForgePlugin: true,
    name: "ignore-native-source",
    init() {
        return undefined;
    },
    getHooks() {
        return {
            resolveForgeConfig: async (forgeConfig) => {
                forgeConfig.packagerConfig = forgeConfig.packagerConfig ?? {};
                const existingIgnore = forgeConfig.packagerConfig.ignore;

                forgeConfig.packagerConfig.ignore = (file: string) => {
                    if (/^[/\\]native($|[/\\])/.test(file)) {
                        return true;
                    }
                    return typeof existingIgnore === "function" ? existingIgnore(file) : false;
                };
                return forgeConfig;
            },
        };
    },
} as NonNullable<ForgeConfig["plugins"]>[number];

const config: ForgeConfig = {
    packagerConfig: {
        appBundleId: "com.zencok.bakamusic",
        asar: {
            // sharp's native addon loads sibling DLL/shared-library files at
            // runtime; the whole platform package must live outside app.asar.
            unpack: "**/node_modules/@img/sharp-*/**/*",
        },
        icon: path.resolve(__dirname, "res/logo"),
        executableName: "BakaMusic",
        extraResource: [path.resolve(__dirname, "res")],
        protocols: [
            {
                name: "BakaMusic",
                schemes: ["bakamusic"],
            },
        ],
        windowsSign: windowsSigningConfigured ? {
            certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            description: "BakaMusic",
            website: "https://github.com/Zencok/BakaMusic",
        } : undefined,
        osxSign: macSignOptions,
        // Notarize only in the workflow post-step (best-effort). Running it here
        // turns packager failures into hard make failures.
        osxNotarize: undefined,
    },
    rebuildConfig: {},
    makers: [
        new MakerNsis({
            appId: "com.zencok.bakamusic",
            compression: "maximum",
            targets: ["nsis", "nsis-web"],
            webPackageBaseUrl: "https://github.com/Zencok/BakaMusic/releases/download",
            webPackageName: "bakamusic",
            webPackageUrlPrefix: nsisWebGithubAccelerator,
            win: {
                icon: path.resolve(__dirname, "res/logo.ico"),
            },
            nsis: {
                artifactName: "BakaMusic-${version}-win32-${arch}-setup.${ext}",
                oneClick: false,
                perMachine: false,
                selectPerMachineByDefault: true,
                allowElevation: true,
                allowToChangeInstallationDirectory: true,
                include: path.resolve(__dirname, "release/installer.nsh"),
                installerIcon: path.resolve(__dirname, "res/logo.ico"),
                uninstallerIcon: path.resolve(__dirname, "res/logo.ico"),
                installerLanguages: ["en_US", "zh_CN"],
                multiLanguageInstaller: true,
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
                shortcutName: "BakaMusic",
                runAfterFinish: true,
                deleteAppDataOnUninstall: false,
            },
            nsisWeb: {
                artifactName: "BakaMusic-${version}-win32-${arch}-web-setup.${ext}",
            },
        }),
        new MakerZIP({}, ["darwin"]),
        new MakerDMG(
            {
                // background
                format: "ULFO",
            },
            ["darwin"],
        ),
        // new MakerRpm({}),
        new MakerDeb({
            options: {
                name: "BakaMusic",
                bin: "BakaMusic",
                mimeType: ["x-scheme-handler/bakamusic"],
            },
        }),
        new MakerAppImage({
            appId: "com.zencok.bakamusic",
            compression: "maximum",
            linux: {
                category: "AudioVideo",
                executableName: "BakaMusic",
                icon: path.resolve(__dirname, "res/logo.png"),
                mimeTypes: ["x-scheme-handler/bakamusic"],
            },
            appImage: {
                artifactName: "BakaMusic-${version}-linux-${arch}.${ext}",
                compression: "xz",
            },
        }),
    ],
    plugins: [
        new WebpackPlugin({
            loggerPort: 9200,
            devContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: bakamusic-theme: https: http:; media-src 'self' data: blob: file: bakamusic-theme: https: http:; font-src 'self' data: file: bakamusic-theme:; connect-src 'self' https: http: ws: wss:; worker-src 'self' blob:; frame-src 'self' data: blob: bakamusic-theme:; object-src 'none'; base-uri 'none'; form-action 'none';",
            devServer: {
                // Keep liveReload so SCSS/TSX rebuilds still refresh when HMR cannot
                // apply (common after the async bootstrap/runtime-root split).
                // Overlay is limited to compile errors — full-page web overlay is
                // flaky in Electron, but liveReload itself is fine.
                liveReload: true,
                hot: true,
                client: {
                    overlay: {
                        errors: true,
                        warnings: false,
                        runtimeErrors: false,
                    },
                    // Prefer reconnect over silent stall when the renderer WS drops.
                    reconnect: true,
                },
            },
            mainConfig,
            renderer: {
                config: rendererConfig,
                entryPoints: [
                    {
                        html: "./src/renderer/document/index.html",
                        js: "./src/renderer/document/index.tsx",
                        name: "main_window",
                        nodeIntegration: false,
                        preload: {
                            js: "./src/preload/index.ts",
                        },
                    },
                    {
                        html: "./src/renderer-lrc/document/index.html",
                        js: "./src/renderer-lrc/document/index.tsx",
                        name: "lrc_window",
                        nodeIntegration: false,
                        preload: {
                            js: "./src/preload/extension.ts",
                        },
                    },
                    {
                        html: "./src/renderer-minimode/document/index.html",
                        js: "./src/renderer-minimode/document/index.tsx",
                        name: "minimode_window",
                        nodeIntegration: false,
                        preload: {
                            js: "./src/preload/extension.ts",
                        },
                    },
                    {
                        html: "./src/renderer-mv/document/index.html",
                        js: "./src/renderer-mv/document/index.tsx",
                        name: "mv_window",
                        nodeIntegration: false,
                        preload: {
                            js: "./src/preload/mv.ts",
                        },
                    },
                ],
            },
        }),
        nativeSourceIgnorePlugin,
        new AutoUnpackNativesPlugin({}),
        // Include external packages through their filesystem metadata so package
        // exports cannot hide package.json from Forge's runtime dependency scan.
        createExternalRuntimePlugin([
            "sharp",
            "get-windows",
            "koffi",
            "@particle/dbus-next",
        ]),
        // Keep fuses last: they are flipped after the app copy and before code signing.
        createFusesPlugin({
            version: FuseVersion.V1,
            strictlyRequireAllFuses: true,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
            // Renderer entry points are currently served from file:// inside
            // app.asar, so Electron requires the file-protocol privileges.
            [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
            [FuseV1Options.WasmTrapHandlers]: true,
        }),
        // Ad-hoc sign the finished .app (loose Mach-O under Contents/Resources,
        // nested helpers, outer seal) whenever no Developer ID is configured.
        createMacosBundleSignPlugin(),
    ],
};

export default config;
