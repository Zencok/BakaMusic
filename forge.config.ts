import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

import { mainConfig } from "./config/webpack.main.config";
import { rendererConfig } from "./config/webpack.renderer.config";
import { createExternalRuntimePlugin } from "./config/forge-external-runtime-plugin";
import { createFusesPlugin } from "./config/forge-fuses-plugin";
import path from "path";

const requireReleaseSigning = process.env.REQUIRE_RELEASE_SIGNING === "true";
const windowsSigningConfigured = !!(
    process.env.WINDOWS_CERTIFICATE_FILE
    && process.env.WINDOWS_CERTIFICATE_PASSWORD
);
const macSigningConfigured = !!process.env.MACOS_SIGN_IDENTITY;
const macNotarizationConfigured = !!(
    process.env.APPLE_API_KEY
    && process.env.APPLE_API_KEY_ID
    && process.env.APPLE_API_ISSUER
);

if (requireReleaseSigning && process.platform === "win32" && !windowsSigningConfigured) {
    throw new Error("Tagged Windows builds require code-signing credentials");
}
// macOS: sign when credentials exist, but do not hard-fail tagged builds when
// notarization secrets are incomplete. CI can still ship an unsigned/signed-only app.

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
        asar: true,
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
        osxSign: macSigningConfigured ? {
            identity: process.env.MACOS_SIGN_IDENTITY,
            hardenedRuntime: true,
            // Do not run spctl assessment after signing — that is a verify gate.
            gatekeeperAssess: false,
        } : undefined,
        // Notarize only in the workflow post-step (best-effort). Running it here
        // turns packager failures into hard make failures.
        osxNotarize: undefined,
    },
    rebuildConfig: {},
    makers: [
        // new MakerSquirrel({
        //   exe: "BakaMusic",
        //   setupIcon: path.resolve(__dirname, "resources/logo.ico"),
        //   setupMsi: "BakaMusicInstaller",
        // }),
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
    ],
    plugins: [
        new WebpackPlugin({
            loggerPort: 9200,
            devContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: bakamusic-theme: https: http:; media-src 'self' data: blob: file: bakamusic-media: bakamusic-theme: https: http:; font-src 'self' data: file: bakamusic-theme:; connect-src 'self' https: http: ws: wss:; worker-src 'self' blob:; frame-src 'self' data: blob: bakamusic-theme:; object-src 'none'; base-uri 'none'; form-action 'none';",
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
    ],
};

export default config;
