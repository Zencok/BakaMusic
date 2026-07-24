const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const entrySource = read("src/renderer/document/index.tsx");
assert.match(entrySource, /createRoot\(rootElement\)\.render\(<StartupShell/);
assert.match(entrySource, /import\("\.\/bootstrap"\)/);
assert.match(entrySource, /import\("\.\/runtime-root"\)/);
assert.match(entrySource, /import "\.\/startup-shell\.scss"/);
assert.match(entrySource, /window\.location\.reload\(\)/);
assert.match(entrySource, /prefers-reduced-motion|startup-shell/, "startup shell styling must remain lightweight");
assert.doesNotMatch(entrySource, /loadingPercent|Math\.random|setInterval/);
assert.doesNotMatch(entrySource, /import App from/);

const startupShellStyleSource = read("src/renderer/document/startup-shell.scss");
assert.match(startupShellStyleSource, /prefers-color-scheme:\s*dark/);
assert.match(startupShellStyleSource, /prefers-reduced-motion:\s*reduce/);
assert.match(startupShellStyleSource, /\[data-state="leaving"\]/);
assert.doesNotMatch(startupShellStyleSource, /#18181b/i);

const rendererDocumentSource = read("src/renderer/document/index.html");
assert.match(rendererDocumentSource, /<title>BakaMusic<\/title>/);
assert.match(rendererDocumentSource, /prefers-color-scheme:\s*dark/);

const runtimeRootSource = read("src/renderer/document/runtime-root.tsx");
assert.match(runtimeRootSource, /import App from "\.\.\/app"/);
assert.match(runtimeRootSource, /<ErrorBoundary/);

const bootstrapHookSource = read("src/renderer/document/useBootstrap.ts");
assert.match(
    bootstrapHookSource,
    /useLayoutEffect\(\(\) => \{\s*void Themepack\.setupThemePacks\(\);[\s\S]*?\}, \[\]\);/,
);
assert.match(bootstrapHookSource, /navigateRef\.current\(route\)/);

const rendererBootstrapSource = read("src/renderer/document/bootstrap.ts");
assert.match(
    rendererBootstrapSource,
    /messageBus\.onCommand\("SyncAppState",[\s\S]*?sendAppStateTo\(from\);[\s\S]*?sendAppStateTo\(\);/,
    "restored extension windows must receive the initial player snapshot",
);

const mainPageSource = read("src/renderer/pages/main-page/index.tsx");
assert.match(mainPageSource, /lazy\(\(\) => import\("\.\/views\/search-view"\)\)/);
assert.match(mainPageSource, /<Suspense/);
assert.doesNotMatch(mainPageSource, /import SearchView from/);

const audioControllerSource = read(
    "src/renderer/core/track-player/controller/libmpv-audio-controller.ts",
);
assert.match(audioControllerSource, /sourceGeneration/);
assert.match(audioControllerSource, /nativePlayback\.onSnapshot/);
assert.doesNotMatch(audioControllerSource, /new Audio\(|AudioContext|hls\.js/);
assert.equal(
    fs.existsSync(path.join(
        __dirname,
        "..",
        "src/renderer/core/track-player/controller/audio-controller.ts",
    )),
    false,
);

const backupSource = read(
    "src/renderer/pages/main-page/views/setting-view/routers/Backup/index.tsx",
);
assert.match(backupSource, /await import\("@\/renderer\/core\/backup-resume(?:\/format)?"\)/);
assert.match(backupSource, /@shared\/backup\/renderer/);
assert.doesNotMatch(backupSource, /(?:import\("webdav"\)|from "webdav")/);
assert.doesNotMatch(backupSource, /import BackupResume from/);
const backupMainSource = read("src/shared/backup/main.ts");
assert.match(backupMainSource, /await import\("webdav"\)/);
assert.doesNotMatch(backupMainSource, /from "webdav"/);

const downloaderWorkerSource = read("src/webworkers/downloader.ts");
assert.match(downloaderWorkerSource, /await import\("@\/common\/taglib-native"\)/);
assert.doesNotMatch(downloaderWorkerSource, /node-taglib-sharp|music-metadata/);
assert.doesNotMatch(downloaderWorkerSource, /from "@\/common\/taglib-native"/);

const taglibNativeSource = read("src/common/taglib-native.ts");
assert.match(taglibNativeSource, /taglib\.node/);
assert.match(taglibNativeSource, /createRequire/);

const commonPreloadSource = read("src/preload/common-preload.ts");
assert.doesNotMatch(commonPreloadSource, /themepack|global-context|electron-log|window-drag/);
assert.doesNotMatch(commonPreloadSource, /@shared\/utils\/preload/);

const mainPreloadSource = read("src/preload/index.ts");
assert.match(mainPreloadSource, /@shared\/utils\/preload/);
assert.match(mainPreloadSource, /@shared\/themepack\/preload/);
assert.match(mainPreloadSource, /@shared\/backup\/preload/);

const extensionPreloadSource = read("src/preload/extension.ts");
assert.match(extensionPreloadSource, /@shared\/utils\/preload-window/);
assert.doesNotMatch(extensionPreloadSource, /common-preload[\s\S]*@shared\/utils\/preload"/);

const themePreloadSource = read("src/shared/themepack/preload.ts");
assert.doesNotMatch(themePreloadSource, /fs|path|rimraf|unzipper|preload-runtime/);
assert.match(themePreloadSource, /ipcRenderer\.invoke/);
const themeRuntimeSource = read("src/shared/themepack/renderer-runtime.ts");
assert.match(themeRuntimeSource, /applyThemeCss/);
assert.match(themeRuntimeSource, /iframe\.setAttribute\("sandbox", "allow-scripts"\)/);
assert.match(themeRuntimeSource, /themeNode\.dataset\.runtimeMounted !== "true"/);
assert.match(themeRuntimeSource, /themeNode\.textContent !== nextCss/);
assert.match(themeRuntimeSource, /themeBackgroundIframe\?\.isConnected/);
assert.doesNotMatch(themeRuntimeSource, /from "(?:fs|path|rimraf|unzipper)/);
const themeRendererSource = read("src/shared/themepack/renderer.ts");
assert.match(themeRendererSource, /setupThemePacksPromise \?\?= setupThemePacksOnce\(\)/);

const rendererWebpackSource = read("config/webpack.renderer.config.ts");
assert.doesNotMatch(rendererWebpackSource, /rules\.push\(/);
assert.match(rendererWebpackSource, /\.\.\.sourceRules/);
assert.match(rendererWebpackSource, /namedExport:\s*false/);
assert.match(rendererWebpackSource, /BannerPlugin/);
assert.match(rendererWebpackSource, /const __dirname = \\"\/\\"/);
const webpackRulesSource = read("config/webpack.rules.ts");
assert.match(webpackRulesSource, /module:\s*"esnext"/);

const forgeSource = read("forge.config.ts");
assert.doesNotMatch(forgeSource, /db-worker|name:\s*"db"/);
assert.doesNotMatch(forgeSource, /worker_downloader|local_file_watcher/);
assert.doesNotMatch(forgeSource, /@timfish\/forge-externals-plugin/);
assert.match(forgeSource, /createExternalRuntimePlugin\(\[[^\]]*"sharp"/s);

const globalContextMainSource = read("src/shared/global-context/main.ts");
const globalContextTypeSource = read("src/shared/global-context/type.d.ts");
assert.doesNotMatch(globalContextMainSource, /DB_WEBPACK_ENTRY|\bdb:/);
assert.doesNotMatch(globalContextTypeSource, /\bdb:/);
assert.doesNotMatch(globalContextMainSource, /workersPath|WORKER_WEBPACK_ENTRY/);
assert.doesNotMatch(globalContextTypeSource, /workersPath/);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.dependencies?.["better-sqlite3"], undefined);
assert.equal(packageJson.devDependencies?.["@types/better-sqlite3"], undefined);
assert.equal(packageJson.dependencies?.comlink, undefined);
assert.match(packageJson.scripts.package, /cross-env NODE_ENV=production/);
assert.match(packageJson.scripts.make, /cross-env NODE_ENV=production/);
assert.match(packageJson.scripts.start, /cross-env NODE_ENV=development/);

const externalRuntimePluginSource = read("config/forge-external-runtime-plugin.ts");
assert.match(externalRuntimePluginSource, /isGetWindowsRuntimePath/);
assert.match(externalRuntimePluginSource, /isSharpRuntimePath/);
assert.match(externalRuntimePluginSource, /\/lib\//);
assert.match(externalRuntimePluginSource, /optionalDependencies/);

console.log("startup-performance: all assertions passed");
