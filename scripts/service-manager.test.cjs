const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const managerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/service-manager/main.ts",
), "utf8");
assert.match(managerSource, /private restartTimer: NodeJS\.Timeout \| null = null/);
assert.match(managerSource, /utilityProcess\.fork\(servicePath/);
assert.match(managerSource, /execArgv: \["--max-old-space-size=128"\]/);
assert.match(managerSource, /stdio: "pipe"/);
assert.match(managerSource, /allowLoadingUnsignedLibraries: false/);
assert.match(managerSource, /private createServiceEnvironment\(\)/);
assert.match(managerSource, /metric\.memory\.workingSetSize > 256 \* 1024/);
assert.match(managerSource, /this\.serviceProcess !== childProcess/);
assert.match(managerSource, /this\.hostChangeCallback\(null\)/);
assert.match(managerSource, /clearTimeout\(this\.restartTimer\)/);
assert.match(managerSource, /const requestId = `mflac-\$\{\+\+this\.serviceRequestId\}`/);
assert.match(managerSource, /const requestId = `luna-\$\{\+\+this\.serviceRequestId\}`/);
assert.match(managerSource, /msg\?\.requestId !== requestId/);

const mflacSource = fs.readFileSync(path.join(
    __dirname,
    "../res/.service/mflac-proxy.cjs",
), "utf8");
assert.match(mflacSource, /serviceIpc\.onMessage/);
assert.match(mflacSource, /serviceIpc\.send\(\{ \.\.\.payload, requestId \}\)/);

const lunaSource = fs.readFileSync(path.join(
    __dirname,
    "../res/.service/luna-proxy.cjs",
), "utf8");
assert.match(lunaSource, /serviceIpc\.onMessage/);
assert.match(lunaSource, /serviceIpc\.send\(\{ \.\.\.payload, requestId \}\)/);

const serviceIpcSource = fs.readFileSync(path.join(
    __dirname,
    "../res/.service/service-ipc.cjs",
), "utf8");
assert.match(serviceIpcSource, /const parentPort = process\.parentPort/);
assert.match(serviceIpcSource, /parentPort\.postMessage\(message\)/);
assert.match(serviceIpcSource, /process\.send\?\.\(message\)/);

const utilityMainSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/utils/main.ts",
), "utf8");
const trayManagerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/main/tray-manager/index.ts",
), "utf8");
assert.doesNotMatch(utilityMainSource, /app\.exit\(/);
assert.doesNotMatch(trayManagerSource, /app\.exit\(/);

// 退出流程：主窗口 close 不得在 quit 期间 preventDefault，
// 否则 before-quit 已销毁子系统而 app.quit() 被取消，留下僵尸进程。
const windowManagerSource = fs.readFileSync(path.join(
    __dirname,
    "../src/main/window-manager/index.ts",
), "utf8");
assert.match(windowManagerSource, /app\.on\("before-quit", \(\) => \{\s*this\.quitting = true;/);
assert.match(windowManagerSource, /!this\.quitting\s*&&\s*process\.platform === "win32"/);
// 托盘退出不再需要 removeAllListeners 绕过 close 处理器
assert.doesNotMatch(trayManagerSource, /removeAllListeners/);

// 主窗口可能在应用存活时被销毁（macOS Cmd+W、exit_app 下 Alt+F4 而歌词窗口仍开着）：
// 必须清空引用，并且所有跨窗口调用点都要挡住已销毁对象。
assert.match(windowManagerSource, /mainWindow\.on\("closed", \(\) => \{/);
assert.match(windowManagerSource, /WindowManager\.mainWindow = null;/);

const messageBusSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/message-bus/main.ts",
), "utf8");
assert.match(messageBusSource, /if \(mainWindow && !mainWindow\.isDestroyed\(\)\) \{/);
// 主窗口重建后要为已存在的扩展窗口重新建端口，否则歌词/迷你窗口永久失联。
assert.match(messageBusSource, /for \(const bWindow of this\.windowManager\.getExtensionWindows\(\)\) \{/);
assert.match(messageBusSource, /private unmountBoundWindows = new WeakSet<BrowserWindow>\(\)/);
assert.match(messageBusSource, /const currentMainWindow = this\.windowManager\.mainWindow;/);

const extensionPreloadSource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/message-bus/preload/extension.ts",
), "utf8");
assert.match(extensionPreloadSource, /extPort\.close\(\);/);
assert.match(extensionPreloadSource, /let subscribedKeys/);

const ipcSecuritySource = fs.readFileSync(path.join(
    __dirname,
    "../src/shared/ipc-security/main.ts",
), "utf8");
assert.match(ipcSecuritySource, /function webContentsIdOf/);
assert.match(ipcSecuritySource, /browserWindow\.isDestroyed\(\)/);
assert.doesNotMatch(ipcSecuritySource, /windowManager\.mainWindow\?\.webContents\.id/);

// V2 plugin transport has a terminal shutdown and restores only registered snapshots.
const pluginHostClientSource = fs.readFileSync(path.join(
    __dirname, "../src/shared/plugin-manager/main/plugin-host-client.ts",
), "utf8");
assert.match(pluginHostClientSource, /this\.rejectAll\(new Error\(`Plugin runtime exited/);
assert.match(pluginHostClientSource, /for \(const registration of this\.registrations\.values\(\)\)/);
assert.match(pluginHostClientSource, /this\.registrations\.delete\(pluginId\)/);
assert.match(pluginHostClientSource, /this\.shuttingDown = true/);
assert.match(pluginHostClientSource, /this\.registrations\.clear\(\)/);
assert.match(pluginHostClientSource, /this\.failChild\(this\.child/);
assert.equal(fs.existsSync(path.join(__dirname, "../src/shared/plugin-manager/utility/plugin-host.ts")), false);
console.log("service-manager: all assertions passed");
