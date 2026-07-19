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

console.log("service-manager: all assertions passed");
