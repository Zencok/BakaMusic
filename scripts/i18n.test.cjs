const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { resolveLanguage } = require("../src/shared/i18n/language");

const languages = ["en-US", "zh-CN", "zh-TW"];
for (const [locale, expected] of [
    ["en-GB", "en-US"], ["de-DE", "en-US"], ["ja-JP", "en-US"],
    ["C", "en-US"], ["POSIX", "en-US"], ["", "en-US"],
    ["zh", "zh-CN"], ["zh_CN.UTF-8", "zh-CN"], ["zh-SG", "zh-CN"],
    ["zh-TW", "zh-TW"], ["zh_HK.UTF-8", "zh-TW"], ["zh-MO", "zh-TW"],
    ["zh-Hant", "zh-TW"], ["zh-Hant-CN", "zh-TW"], ["zh-Hans-TW", "zh-CN"],
]) {
    for (const preference of ["system", undefined, "unsupported"]) {
        assert.equal(resolveLanguage(preference, locale, languages), expected, locale);
    }
    assert.equal(resolveLanguage("zh-CN", locale, languages), "zh-CN");
    assert.equal(resolveLanguage("en-US", locale, languages), "en-US");
}

const root = path.resolve(__dirname, "..");
const source = ts.transpileModule(fs.readFileSync(path.join(root, "src/shared/i18n/main.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

async function createSession({ preference = "system", locale = "en-US", env = {}, platform = "linux" } = {}) {
    const handlers = new Map();
    const bundles = new Map();
    const saved = [];
    const notifications = [];
    const i18n = {
        language: "",
        async init() {},
        addResourceBundle(lang, ns, content) { bundles.set(lang, content); },
        hasResourceBundle(lang) { return bundles.has(lang); },
        getResourceBundle(lang) { return bundles.get(lang); },
        async changeLanguage(lang) { this.language = lang; },
        t(key) { return key; },
    };
    const dependencies = {
        electron: {
            app: { isPackaged: false, getLocale: () => locale },
            ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
            BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => notifications.push(args) } }] },
        },
        path,
        "fs/promises": {
            readdir: async () => languages.map((lang) => ({ name: `${lang}.json`, isFile: () => true })),
            readFile: async (file) => fs.readFileSync(path.join(root, "res/lang", path.basename(file)), "utf8"),
        },
        i18next: i18n,
        "@shared/logger/main": { logError: (message, error) => { throw error; } },
        "@shared/ipc-security/main": { assertIpcSender() {}, assertString: (value) => assert.equal(typeof value, "string") },
        "./language": { resolveLanguage },
    };
    const context = {
        exports: {}, __dirname: path.join(root, "src/shared/i18n"),
        process: { platform, env },
        require: (name) => {
            assert.ok(name in dependencies, name);
            return dependencies[name];
        },
    };
    vm.runInNewContext(source, context);
    await context.exports.setupI18n({ getDefaultLang: () => preference, onLanguageChanged: (lang) => saved.push(lang) });
    return { i18n, handlers, saved, notifications };
}

(async () => {
    for (const [options, expected] of [
        [{ locale: "zh-CN" }, "zh-CN"],
        [{ locale: "zh-Hant" }, "zh-TW"],
        [{ locale: "fr-FR" }, "en-US"],
        [{ locale: "en-US", env: { LANG: "zh_TW.UTF-8" } }, "zh-TW"],
        [{ env: { LANG: "zh_CN.UTF-8", LC_MESSAGES: "de_DE.UTF-8" } }, "en-US"],
        [{ env: { LANG: "en_US.UTF-8", LC_MESSAGES: "zh_CN.UTF-8", LC_ALL: "zh_HK.UTF-8" } }, "zh-TW"],
        [{ locale: "zh-CN", env: { LC_ALL: "C" } }, "en-US"],
        [{ locale: "zh-TW", platform: "darwin", env: { LANG: "en_US.UTF-8" } }, "zh-TW"],
        [{ preference: "en-US", locale: "zh-CN" }, "en-US"],
        [{ preference: "zh-CN", locale: "en-US" }, "zh-CN"],
        [{ preference: "invalid", locale: "de-DE" }, "en-US"],
    ]) {
        const session = await createSession(options);
        assert.equal(session.i18n.language, expected);
        assert.equal(session.saved.length, 0, "Automatic detection must not persist a concrete language");
        const data = await session.handlers.get("shared/i18n/setup")({});
        assert.equal(data.lang, expected);
        assert.ok(data.content.common.cancel);
    }

    const session = await createSession({ locale: "zh-TW" });
    const change = session.handlers.get("shared/i18n/changeLang");
    const event = { sender: {} };
    assert.equal((await change(event, "en-US")).lang, "en-US");
    assert.equal((await change(event, "system")).lang, "zh-TW");
    assert.deepEqual(session.saved, ["en-US", "system"]);
    assert.equal(session.notifications.at(-1)[1].lang, "zh-TW");
    assert.equal(await change(event, "../../invalid"), null);
    assert.equal(session.i18n.language, "zh-TW");
    console.log("i18n locale selection and language switching passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
