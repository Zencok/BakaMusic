import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./config/webpack.main.config";
import { rendererConfig } from "./config/webpack.renderer.config";
import path from "path";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "com.zencok.bakamusic",
    icon: path.resolve(__dirname, "res/logo"),
    executableName: "BakaMusic",
    extraResource: [path.resolve(__dirname, "res")],
    protocols: [
      {
        name: "BakaMusic",
        schemes: ["bakamusic"],
      },
    ],
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
      ["darwin"]
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
      devContentSecurityPolicy: `default-src * self blob: data: gap: file:; style-src * self 'unsafe-inline' blob: data: gap: file:; script-src * 'self' 'unsafe-inline' blob: data: gap: file:; object-src * 'self' blob: data: gap:; img-src * self 'unsafe-inline' blob: data: gap: file:; connect-src self * 'unsafe-inline' blob: data: gap: ws: wss:; frame-src * self blob: data: gap:;`,
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/renderer/document/index.html",
            js: "./src/renderer/document/index.tsx",
            name: "main_window",
            nodeIntegration: true,
            preload: {
              js: "./src/preload/index.ts",
            },
          },
          {
            html: "./src/renderer-lrc/document/index.html",
            js: "./src/renderer-lrc/document/index.tsx",
            name: "lrc_window",
            nodeIntegration: true,
            preload: {
              js: "./src/preload/extension.ts",
            },
          },
          {
            html: "./src/renderer-minimode/document/index.html",
            js: "./src/renderer-minimode/document/index.tsx",
            name: "minimode_window",
            nodeIntegration: true,
            preload: {
              js: "./src/preload/extension.ts",
            },
          },
          /** webworkers */
          {
            js: "./src/webworkers/downloader.ts",
            name: "worker_downloader",
            nodeIntegration: true,
          },
          {
            js: "./src/webworkers/local-file-watcher.ts",
            name: "local_file_watcher",
            nodeIntegration: true,
          },
          {
            js: "./src/webworkers/db-worker.ts",
            name: "db",
            nodeIntegration: true,
          }
        ],
      },
    }),
    {
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["sharp"],
        includeDeps: true,
      },
    },
  ],
};

export default config;
