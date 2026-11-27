// Standalone ts-node regressions resolve the same source aliases as Webpack.
const Module = require("node:module");
const path = require("node:path");
const resolve = Module._resolveFilename;
const roots = [
    ["@/", "src"], ["@shared/", "src/shared"],
    ["@renderer/", "src/renderer"], ["@main/", "src/main"],
];
Module._resolveFilename = function resolveTestAlias(request, parent, isMain, options) {
    const match = roots.find(([prefix]) => request.startsWith(prefix));
    if (match) request = path.resolve(__dirname, "..", match[1], request.slice(match[0].length));
    return resolve.call(this, request, parent, isMain, options);
};
