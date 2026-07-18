const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));

assert.equal(packageJson["lint-staged"]["src/**/*.{ts,tsx,js}"], "eslint --fix");
assert.doesNotMatch(JSON.stringify(packageJson["lint-staged"]), /git add/);
assert.equal(packageJson.devDependencies["eslint-plugin-react-hooks"], "^7.1.1");
assert.equal(packageJson.devDependencies["eslint-plugin-jsx-a11y-x"], "^0.2.0");
assert.equal(packageJson.devDependencies["@electron/fuses"], "^2.1.3");
assert.equal(packageJson.devDependencies["@electron-forge/plugin-fuses"], undefined);
assert.ok(packageJson.scripts["smoke:native"]);
assert.ok(packageJson.scripts.sbom);

const eslintSource = read("eslint.config.mjs");
assert.match(eslintSource, /react-hooks\/rules-of-hooks/);
assert.match(eslintSource, /react-hooks\/exhaustive-deps/);
assert.match(eslintSource, /jsxA11y\.configs\.recommended\.rules/);
assert.doesNotMatch(eslintSource, /"\*\*\/\*\.d\.ts"/);
assert.match(eslintSource, /files: \["src\/\*\*\/\*\.d\.ts"\]/);

const forgeSource = read("forge.config.ts");
assert.match(forgeSource, /asar: true/);
assert.match(forgeSource, /new AutoUnpackNativesPlugin/);
assert.match(forgeSource, /createFusesPlugin/);
assert.match(forgeSource, /strictlyRequireAllFuses: true/);
assert.match(forgeSource, /FuseV1Options\.RunAsNode\]: false/);
assert.match(forgeSource, /FuseV1Options\.EnableEmbeddedAsarIntegrityValidation\]: true/);
assert.match(forgeSource, /FuseV1Options\.OnlyLoadAppFromAsar\]: true/);
assert.match(forgeSource, /FuseV1Options\.GrantFileProtocolExtraPrivileges\]: true/);
assert.match(forgeSource, /FuseV1Options\.WasmTrapHandlers\]: true/);
assert.match(forgeSource, /windowsSign:/);
assert.match(forgeSource, /osxSign:/);
assert.match(forgeSource, /osxNotarize:/);

const serviceManagerSource = read("src/shared/service-manager/main.ts");
assert.match(serviceManagerSource, /utilityProcess\.fork/);
assert.doesNotMatch(serviceManagerSource, /child_process|ELECTRON_RUN_AS_NODE/);
assert.match(read("res/.service/service-ipc.cjs"), /process\.parentPort/);

for (const workflowPath of [
    ".github/workflows/build.yml",
    ".github/workflows/release.yml",
]) {
    const source = read(workflowPath);
    assert.doesNotThrow(() => YAML.parse(source));
    const actions = [...source.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
    assert.ok(actions.length > 0, `${workflowPath} has no actions`);
    for (const [, action, ref] of actions) {
        assert.match(ref, /^[0-9a-f]{40}$/, `${action} is not pinned to a commit`);
    }
    assert.doesNotMatch(source, /softprops\//);
}

const buildWorkflow = read(".github/workflows/build.yml");
assert.match(buildWorkflow, /permissions: \{\}/);
assert.match(buildWorkflow, /cache: npm/);
assert.match(buildWorkflow, /matrix:\s*\n\s+include:/);
assert.doesNotMatch(buildWorkflow, /build-windows:|build-macos-x64:|build-macos-arm64:/);
assert.match(buildWorkflow, /NATIVE_SOURCE_REF: "[0-9a-f]{40}"/);
assert.match(buildWorkflow, /ref: \$\{\{ env\.NATIVE_SOURCE_REF \}\}/);
assert.match(buildWorkflow, /WINDOWS_CERTIFICATE_BASE64/);
assert.match(buildWorkflow, /notarytool submit/);
assert.match(buildWorkflow, /Generate reproducible CycloneDX SBOM/);
assert.match(buildWorkflow, /generate-release-metadata\.cjs/);
assert.match(buildWorkflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);

const nativeSmoke = read("scripts/native-smoke.cjs");
assert.match(nativeSmoke, /process\.versions\.electron/);
assert.match(nativeSmoke, /runtime arch mismatch/);
assert.match(nativeSmoke, /require\(modulePath\)/);
assert.match(read("scripts/build-native.js"), /native-smoke\.cjs/);

const accessibilitySource = read("src/renderer/utils/accessibility.ts");
assert.match(accessibilitySource, /event\.key === "Enter"/);
assert.match(accessibilitySource, /event\.key === " "/);
assert.match(accessibilitySource, /MutationObserver/);
assert.match(accessibilitySource, /a11yManagedDisabled/);
assert.match(accessibilitySource, /getAttribute\("aria-disabled"\) !== "true"/);
const modalSource = read("src/renderer/components/Modal/templates/Base/index.tsx");
assert.match(modalSource, /role="dialog"/);
assert.match(modalSource, /aria-modal="true"/);
assert.match(modalSource, /event\.code === "Tab"/);
assert.match(modalSource, /previousFocus\?\.focus/);
assert.match(read("src/renderer/document/styles/accessibility.scss"), /prefers-reduced-motion: reduce/);
assert.match(read("src/renderer/components/ContextMenu/index.tsx"), /role="menuitem"/);
assert.match(read("src/renderer/components/A/index.tsx"), /href=\{href\}/);
assert.doesNotMatch(read("src/renderer/document/index.tsx"), /启动失败|正在启动|重新加载/);

const languageFiles = ["zh-CN", "zh-TW", "en-US"].map((language) =>
    JSON.parse(read(`res/lang/${language}.json`)));
const collectKeys = (value, prefix = "") => Object.entries(value).flatMap(([key, entry]) => {
    const nextKey = `${prefix}${key}`;
    return entry && typeof entry === "object" && !Array.isArray(entry)
        ? collectKeys(entry, `${nextKey}.`)
        : [nextKey];
}).sort();
const expectedLanguageKeys = collectKeys(languageFiles[0]);
for (const language of languageFiles.slice(1)) {
    assert.deepEqual(collectKeys(language), expectedLanguageKeys);
}
assert.match(read("src/shared/i18n/main.ts"), /shared\/i18n\/languageChanged/);
assert.match(read("src/main/tray-manager/index.ts"), /t\("common\.paste"\)/);
assert.match(read("src/main/index.ts"), /TrayManager\.refreshLocalization\(\)/);
assert.match(read("src/shared/short-cut/main.ts"), /shortCut\.enableGlobal/);

console.log("phase6-governance: all assertions passed");
