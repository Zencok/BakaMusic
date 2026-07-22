const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function count(source, pattern) {
    return [...source.matchAll(pattern)].length;
}

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

function testWindowIsolation() {
    const forgeSource = read("forge.config.ts");
    assert.equal(count(forgeSource, /\bnodeIntegration:\s*false/g), 3);
    assert.doesNotMatch(forgeSource, /\bnodeIntegration:\s*true/);

    const windowSource = read("src/main/window-manager/index.ts");
    assert.equal(count(windowSource, /new BrowserWindow\(/g), 3);
    for (const [property, value] of [
        ["nodeIntegration", "false"],
        ["nodeIntegrationInWorker", "false"],
        ["contextIsolation", "true"],
        ["webSecurity", "true"],
        ["allowRunningInsecureContent", "false"],
        ["sandbox", "true"],
        ["webviewTag", "false"],
        ["navigateOnDragDrop", "false"],
    ]) {
        assert.equal(
            count(windowSource, new RegExp(`\\b${property}:\\s*${value}`, "g")),
            3,
            `${property} must be explicit on all three windows`,
        );
    }
    assert.equal(count(windowSource, /hardenWindow\(/g), 3);
}

function testSessionAndNavigationPolicy() {
    const source = read("src/main/electron-security.ts");
    const productionPolicy = source.slice(
        source.indexOf("const productionCsp"),
        source.indexOf("const developmentCsp"),
    );
    assert.match(productionPolicy, /script-src 'self'/);
    assert.doesNotMatch(productionPolicy, /unsafe-eval/);
    assert.match(productionPolicy, /object-src 'none'/);
    assert.match(productionPolicy, /base-uri 'none'/);
    assert.match(source, /setPermissionCheckHandler\(\(\) => false\)/);
    assert.match(source, /setPermissionRequestHandler/);
    assert.match(source, /callback\(false\)/);
    assert.match(source, /onHeadersReceived/);
    assert.match(source, /setWindowOpenHandler/);
    assert.match(source, /action: "deny"/);
    assert.match(source, /will-navigate/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /will-attach-webview/);
    assert.match(source, /target\.hostname === entry\.hostname/);

    const mainSource = read("src/main/index.ts");
    const readySource = mainSource.slice(mainSource.indexOf("app.whenReady().then"));
    assert.ok(
        readySource.indexOf("setupSessionSecurity();")
            < readySource.indexOf("windowManager.showMainWindow();"),
        "session policy must be installed before the first window",
    );
    assert.ok(
        readySource.indexOf("setupIpcSecurity(windowManager);")
            < readySource.indexOf("windowManager.showMainWindow();"),
        "IPC role resolution must be installed before the first window",
    );
}

function testIpcAndPathBoundaries() {
    const securitySource = read("src/shared/ipc-security/main.ts");
    assert.match(securitySource, /event\.sender\.mainFrame/);
    assert.match(securitySource, /BrowserWindow\.fromWebContents/);
    assert.match(securitySource, /MAX_NESTING_DEPTH/);
    assert.match(securitySource, /IPC payload contains a cycle/);
    assert.match(securitySource, /fs\.realpathSync\.native/);
    assert.match(securitySource, /nearest existing ancestor/);
    assert.match(securitySource, /Path is outside the granted roots/);
    assert.match(securitySource, /allowCredentials/);

    const ipcFiles = walk(path.join(projectRoot, "src"))
        .filter((filePath) => /\.ts$/.test(filePath))
        .filter((filePath) => /ipcMain\.(?:handle|on)\(/.test(fs.readFileSync(filePath, "utf8")));
    assert.ok(ipcFiles.length > 0);
    for (const filePath of ipcFiles) {
        const source = fs.readFileSync(filePath, "utf8");
        assert.match(
            source,
            /@shared\/ipc-security\/main/,
            `${path.relative(projectRoot, filePath)} must use the common IPC boundary`,
        );
    }

    const utilsMain = read("src/shared/utils/main.ts");
    assert.match(utilsMain, /assertExternalUrl/);
    assert.match(utilsMain, /parsed\.protocol === "mailto:"/);
    assert.match(utilsMain, /assertPathAccess\(filePath/);
    assert.match(utilsMain, /sanitizeOpenDialogOptions/);
    assert.match(utilsMain, /sanitizeSaveDialogOptions/);
    assert.match(utilsMain, /sanitizeDialogDefaultPath/);
    assert.match(utilsMain, /Bare filename/);
    assert.match(
        utilsMain,
        /fs-remove-file[\s\S]{0,300}assertPathAccess\(filePath, \{ allowMissing: true \}\)/,
    );
    assert.match(utilsMain, /fs-remove-file[\s\S]{0,500}ENOENT/);
    assert.match(utilsMain, /Only files may be removed through this bridge/);
    assert.match(
        utilsMain,
        /fs-trash-file[\s\S]{0,300}assertPathAccess\(filePath, \{ allowMissing: true \}\)/,
    );
    assert.match(utilsMain, /fs-trash-file[\s\S]{0,1200}shell\.trashItem\(targetPath\)/);
    assert.match(utilsMain, /Only files may be moved to trash through this bridge/);

    const appConfigMain = read("src/shared/app-config/main.ts");
    assert.match(appConfigMain, /rendererWritableConfigKeys/);
    assert.match(appConfigMain, /validateRendererConfigValue/);
    assert.match(appConfigMain, /"time-rev"/);
    assert.match(appConfigMain, /"download.defaultQuality"/);
    assert.doesNotMatch(appConfigMain, /"duration", "time", "random"/);
}

function testPreloadCapabilitySurface() {
    const mainPreload = read("src/preload/index.ts");
    const extensionPreload = read("src/preload/extension.ts");
    const utilsPreload = read("src/shared/utils/preload.ts");
    const themePreload = read("src/shared/themepack/preload.ts");

    assert.match(mainPreload, /@shared\/node-runtime\/preload/);
    assert.match(mainPreload, /@shared\/backup\/preload/);
    assert.doesNotMatch(extensionPreload, /plugin-manager|node-runtime|themepack|backup/);
    assert.doesNotMatch(utilsPreload, /from "(?:fs|fs\/promises|path|rimraf|unzipper)/);
    assert.match(utilsPreload, /@shared\/utils\/fs-trash-file/);
    assert.doesNotMatch(themePreload, /from "(?:fs|fs\/promises|path|rimraf|unzipper)/);
    assert.match(themePreload, /ipcRenderer\.invoke/);
    assert.doesNotMatch(themePreload, /preload-runtime/);

    const rendererFiles = walk(path.join(projectRoot, "src"))
        .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath));
    for (const filePath of rendererFiles) {
        assert.doesNotMatch(
            fs.readFileSync(filePath, "utf8"),
            /window\.path\b/,
            `${path.relative(projectRoot, filePath)} retains the legacy path bridge`,
        );
    }
}

function testBackupBoundary() {
    const backupMain = read("src/shared/backup/main.ts");
    const backupPage = read(
        "src/renderer/pages/main-page/views/setting-view/routers/Backup/index.tsx",
    );
    const mainSource = read("src/main/index.ts");

    assert.equal(count(backupMain, /assertIpcSender\(event, \["main"\]\)/g), 2);
    assert.match(backupMain, /assertUrl\(value\.url, \["https:", "http:"\]/);
    assert.match(backupMain, /MAX_BACKUP_TRANSFER_BYTES/);
    assert.match(backupMain, /WEBDAV_REQUEST_TIMEOUT_MS/);
    assert.match(backupMain, /axios\.defaults\.httpAgent/);
    assert.match(backupMain, /axios\.defaults\.httpsAgent/);
    assert.match(backupMain, /await import\("webdav"\)/);
    assert.doesNotMatch(backupPage, /(?:import\("webdav"\)|from "webdav")/);
    assert.match(backupPage, /BackupBridge\.backupToWebdav/);
    assert.match(backupPage, /BackupBridge\.restoreFromWebdav/);
    assert.match(mainSource, /setupBackupMain\(\)/);
}

function testPluginIsolationAndIntegrity() {
    const managerSource = read("src/shared/plugin-manager/main/index.ts");
    const clientSource = read("src/shared/plugin-manager/main/plugin-host-client.ts");
    const hostSource = read("src/shared/plugin-manager/utility/plugin-host.ts");
    const deepLinkSource = read("src/main/deep-link/index.ts");

    assert.match(managerSource, /assertUrl\(source\.url, \["https:"\]/);
    assert.match(managerSource, /beforeRedirect: assertHttpsRedirect/);
    assert.match(managerSource, /createHash\("sha256"\)/);
    assert.match(managerSource, /verifyPluginSignature/);
    assert.match(managerSource, /\.integrity\.json/);
    assert.match(managerSource, /MAX_PLUGIN_CODE_BYTES/);
    assert.doesNotMatch(managerSource, /rejectUnauthorized\s*:\s*false/);

    assert.match(clientSource, /utilityProcess\.fork/);
    assert.match(clientSource, /--max-old-space-size=256/);
    assert.match(clientSource, /MAX_WORKING_SET_KB/);
    assert.match(clientSource, /MAX_PENDING_REQUESTS/);
    assert.match(clientSource, /Plugin RPC timed out/);
    assert.match(clientSource, /child\.kill\(\)/);
    assert.match(clientSource, /for \(const \[hash, registration\] of this\.registrations\)/);
    assert.match(clientSource, /createPluginHostEnvironment/);
    assert.doesNotMatch(clientSource, /env:\s*\{\s*\.\.\.process\.env/);
    assert.match(clientSource, /MAX_HOST_CALLBACK_BYTES/);
    assert.match(clientSource, /assertRpcRequestId/);

    assert.match(hostSource, /const packages: Record<string, unknown>/);
    assert.match(hostSource, /!\(packageName in packages\)/);
    assert.match(hostSource, /MAX_STORAGE_BYTES/);
    assert.match(hostSource, /HOST_CALLBACK_TIMEOUT_MS/);
    assert.match(hostSource, /applyNetworkEnvironment/);
    assert.match(hostSource, /new HttpsProxyAgent/);
    assert.match(hostSource, /requestId/);

    assert.match(deepLinkSource, /MAX_PLUGIN_URLS = 10/);
    assert.match(deepLinkSource, /pluginUrl\.protocol !== "https:"/);
    assert.match(deepLinkSource, /dialog\.showMessageBox/);
    assert.match(deepLinkSource, /defaultId: 1/);
    assert.match(deepLinkSource, /cancelId: 1/);
    assert.match(deepLinkSource, /result\.response !== 0/);
    assert.match(deepLinkSource, /PluginManager\.whenReady\(\)/);
}

function testThemeAndNodeRuntimeIsolation() {
    const themeMain = read("src/shared/themepack/main.ts");
    const themeRuntime = read("src/shared/themepack/renderer-runtime.ts");
    const nodeRuntime = read("src/shared/node-runtime/main.ts");
    const downloader = read("src/webworkers/downloader.ts");
    const packageJson = JSON.parse(read("package.json"));

    assert.match(themeMain, /registerSchemesAsPrivileged/);
    assert.match(themeMain, /secure: true/);
    assert.match(themeMain, /protocol\.handle/);
    assert.match(themeMain, /MAX_ARCHIVE_BYTES/);
    assert.match(themeMain, /MAX_EXTRACTED_BYTES/);
    assert.match(themeMain, /MAX_ARCHIVE_ENTRIES/);
    assert.match(themeMain, /resolveThemeFile/);
    assert.match(themeMain, /realpathSync\.native/);
    assert.match(themeMain, /beforeRedirect: assertHttpsRedirect/);
    assert.match(themeMain, /assertIpcSender\(event, \["main"\]\)/);
    assert.match(themeRuntime, /iframe\.setAttribute\("sandbox", "allow-scripts"\)/);

    assert.match(nodeRuntime, /utilityProcess\.fork/);
    assert.match(nodeRuntime, /--max-old-space-size=384/);
    assert.match(nodeRuntime, /MAX_RUNTIME_WORKING_SET_KB/);
    assert.match(nodeRuntime, /MAX_PENDING_REQUESTS/);
    assert.match(nodeRuntime, /validateMediaSource/);
    assert.match(nodeRuntime, /forbiddenMediaHeaders/);
    assert.match(nodeRuntime, /this\.rejectPending/);
    assert.match(nodeRuntime, /this\.watcherState/);

    assert.match(downloader, /coverDownloadSemaphore = new Semaphore\(3\)/);
    assert.match(downloader, /coverDownloadTimeoutMs = 15_000/);
    assert.match(downloader, /invalid cover file signature/);
    assert.doesNotMatch(downloader, /MAX_COVER|cover.*size.*limit/i);
    assert.equal(packageJson.dependencies?.comlink, undefined);
}

function testPackagedBoundarySmokeContract() {
    const smokeSource = read("scripts/package-smoke.cjs");
    for (const property of [
        "typeof window.process",
        "typeof window.require",
        "typeof window.__dirname",
        "typeof window.path",
    ]) {
        assert.match(smokeSource, new RegExp(property.replaceAll(".", "\\.")));
    }
    assert.match(smokeSource, /pluginResult: \{ isEnd: true, data: \[\] \}/);
    assert.match(smokeSource, /nodeRuntimeBridge: "function"/);
    assert.match(smokeSource, /backupWriteBridge: "function"/);
    assert.match(smokeSource, /backupReadBridge: "function"/);
    assert.match(smokeSource, /trashFileBridge: "function"/);
    assert.match(smokeSource, /WebDAV backup roundtrip/);
}

testWindowIsolation();
testSessionAndNavigationPolicy();
testIpcAndPathBoundaries();
testPreloadCapabilitySurface();
testBackupBoundary();
testPluginIsolationAndIntegrity();
testThemeAndNodeRuntimeIsolation();
testPackagedBoundarySmokeContract();

console.log("phase5-electron-security: all assertions passed");
