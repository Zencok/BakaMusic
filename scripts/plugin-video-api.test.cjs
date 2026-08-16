const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const { pluginMethodNames } = require("../src/shared/plugin-manager/rpc.ts");

assert.ok(pluginMethodNames.includes("getMvSource"));

const pluginTypes = read("src/types/plugin.d.ts");
assert.match(pluginTypes, /interface IVideoSourceResult/);
assert.match(pluginTypes, /getMvSource\?:/);
assert.match(pluginTypes, /supportedVideoQualities\?: string\[\]/);
assert.match(pluginTypes, /videoQuality\?: string/);
assert.match(pluginTypes, /expiresAt\?: number/);

const mediaTypes = read("src/types/media.d.ts");
assert.match(mediaTypes, /mv\?: string \| number/);

const pluginMethods = read("src/shared/plugin-manager/main/plugin-methods.ts");
assert.match(pluginMethods, /async getMvSource\(/);
assert.match(pluginMethods, /normalizeVideoSourceResult/);
assert.match(pluginMethods, /MAX_VIDEO_SOURCE_URL_LENGTH/);

const pluginHost = read("src/shared/plugin-manager/utility/plugin-host.ts");
assert.match(pluginHost, /\["getMediaSource", "getMvSource"\]/);

console.log("Plugin video API tests passed.");
