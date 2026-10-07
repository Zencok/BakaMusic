const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function testSongMoreMenu() {
    const ts = require("typescript");
    const source = ts.createSourceFile("index.tsx", fs.readFileSync(path.join(root,
        "src/renderer/components/MusicDetail/widgets/ClassicAmlLDetail/index.tsx"), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let button;
    const visit = (node) => {
        if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button"
            && node.attributes.getText(source).includes('t("music_detail.amll_more_actions")')) {
            button = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(button, "AMLL more button must exist");
    const attributes = button.attributes.properties;
    assert.equal(attributes.find((attribute) => attribute.name?.text === "aria-haspopup").initializer.text, "menu");
    const handler = attributes.find((attribute) => attribute.name?.text === "onClick").initializer.expression;
    const code = ts.transpileModule("(" + handler.getText(source) + ")", {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const currentMusic = { platform: "local", id: "song" };
    let menu;
    let stopped = false;
    const context = { currentMusic, showMusicContextMenu: (...args) => { menu = args; } };
    const click = require("node:vm").runInNewContext(code, context);
    const event = {
        stopPropagation() { stopped = true; },
        currentTarget: { getBoundingClientRect: () => ({ left: 120, bottom: 240 }) },
    };
    click(event);
    assert.equal(stopped, true, "opening click must not reach the global menu dismiss listener");
    assert.deepEqual(menu, [currentMusic, 120, 240], "more must open the existing menu for the current song");
    context.currentMusic = undefined;
    menu = undefined;
    click(event);
    assert.equal(menu, undefined, "no song must not open a menu");
    console.log("Song more menu passed: current song, button anchor, click propagation and empty playback");
}

function testFavoriteMotion() {
    const ts = require("typescript");
    const source = ts.createSourceFile("index.tsx", fs.readFileSync(path.join(root,
        "src/renderer/components/MusicDetail/widgets/ClassicAmlLDetail/index.tsx"), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = source.statements.find((statement) => statement.name?.text === "ClassicMusicInfo");
    const effect = component.body.statements.find((statement) =>
        ts.isExpressionStatement(statement) && statement.expression.expression?.text === "useEffect");
    const code = ts.transpileModule(effect.getText(source), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const animations = [];
    let reducedMotion = false;
    const context = {
        favoritePlatform: "local", favoriteMusicId: "first", favorited: false,
        previousFavoriteRef: { current: { platform: "local", id: "first", favorited: false } },
        favoriteIconRef: { current: { animate(keyframes, options) {
            const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
            animations.push(animation);
            return animation;
        } } },
        window: { matchMedia: () => ({ matches: reducedMotion }) },
        useEffect(callback) { context.cleanup = callback(); },
    };
    const runEffect = () => {
        context.cleanup?.();
        require("node:vm").runInNewContext(code, context);
    };
    runEffect();
    assert.equal(animations.length, 0, "mount must not animate");
    context.favorited = true;
    runEffect();
    assert.equal(animations[0].options.duration, 380);
    context.favorited = false;
    runEffect();
    assert.equal(animations[0].cancelled, true, "reversal must cancel the previous animation");
    assert.equal(animations[1].options.duration, 260);
    context.favoriteMusicId = "second";
    context.favorited = true;
    runEffect();
    assert.equal(animations[1].cancelled, true, "track change must cancel the animation");
    assert.equal(animations.length, 2, "track change must not animate");
    reducedMotion = true;
    context.favorited = false;
    runEffect();
    assert.equal(animations.length, 2, "reduced motion must skip animations");
    console.log("Favorite motion passed: mount, favorite, unfavorite, reversal, track change and reduced motion");
}

function testMotion() {
    require("ts-node/register/transpile-only");
    const Module = require("node:module");
    const originalLoad = Module._load;
    const originalWindow = global.window;
    let settled;
    let lastShown;
    let cleanup;
    let dirty = false;
    let nextTimer = 0;
    const timers = new Map();
    global.window = {
        setTimeout(callback, delay) {
            const timer = ++nextTimer;
            timers.set(timer, { callback, delay });
            return timer;
        },
        clearTimeout(timer) {
            timers.delete(timer);
        },
    };
    Module._load = function (request, parent, isMain) {
        if (request === "react" && parent?.filename.endsWith("usePageMotion.ts")) {
            return {
                useState(initial) {
                    settled ??= initial;
                    return [settled, (value) => {
                        dirty ||= settled !== value;
                        settled = value;
                    }];
                },
                useLayoutEffect(effect, dependencies) {
                    if (lastShown !== dependencies[0]) {
                        lastShown = dependencies[0];
                        cleanup?.();
                        cleanup = effect();
                    }
                },
                useCallback(callback) { return callback; },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const usePageMotion = require("../src/renderer/components/MusicDetail/usePageMotion.ts").default;
        const render = (shown) => {
            let result;
            do {
                dirty = false;
                result = usePageMotion(shown);
            } while (dirty);
            return result;
        };
        assert.equal(render(false).phase, "exit");
        assert.equal(render(true).phase, "enter");
        assert.equal(timers.size, 1);
        render(true).finish();
        assert.equal(render(true).phase, "visible");
        assert.equal(render(false).phase, "exit");
        assert.equal(timers.size, 1);
        timers.values().next().value.callback();
        assert.equal(render(false).phase, "hidden");
        assert.equal(render(true).phase, "enter");
        assert.equal(render(false).phase, "exit");
        assert.equal(render(true).phase, "enter");
        assert.equal(timers.size, 1);
        assert.equal(timers.values().next().value.delay, 520);
        timers.values().next().value.callback();
        assert.equal(render(true).phase, "visible");
    } finally {
        cleanup?.();
        Module._load = originalLoad;
        if (originalWindow === undefined) delete global.window;
        else global.window = originalWindow;
    }
    assert.equal(timers.size, 0);
    const component = fs.readFileSync(path.join(root, "src/renderer/components/MusicDetail/index.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(root, "src/renderer/components/MusicDetail/index.scss"), "utf8");
    assert.match(component, /data-page-motion=\{pageMotion.phase\}/);
    assert.match(component, /onMountAnimationEnd=\{pageMotion.finish\}/);
    assert.match(component, /onUnmountAnimationEnd=\{pageMotion.finish\}/);
    assert.match(styles, /data-page-motion="visible"\]\s*\{\s*animation: none;\s*transform: none;/);
    assert.match(styles, /data-page-motion="hidden"\]\s*\{\s*display: none;/);
    assert.match(styles, /data-page-motion="enter"[\s\S]*?app-region: no-drag !important/);
    console.log("Music detail motion lifecycle passed");
}

async function nativeRegression() {
    const { app, BrowserWindow } = require("electron");
    const sass = require("sass");
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const sendMessage = user32.func("intptr_t __stdcall SendMessageW(uintptr_t window, uint32_t message, uintptr_t parameter, intptr_t coordinates)");
    koffi.struct("MusicDetailHitPoint", { x: "int32_t", y: "int32_t" });
    const clientToScreen = user32.func("bool __stdcall ClientToScreen(uintptr_t window, _Inout_ MusicDetailHitPoint *point)");
    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const watchdog = setTimeout(() => app.exit(1), 25_000);
    app.setPath("userData", process.env.BAKAMUSIC_DRAG_TEST_DATA);
    await app.whenReady();
    const css = ["src/renderer/components/MusicDetail/index.scss", "src/renderer/components/MusicDetail/widgets/ClassicAmlLDetail/index.scss", "src/renderer/components/Header/index.scss"]
        .map((file) => sass.compile(path.join(root, file), { logger: sass.Logger.silent }).css).join("\n");
    const window = new BrowserWindow({ width: 900, height: 640, frame: false, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    try {
        await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<!doctype html><style>body{margin:0}' + css + '</style><header class="header-container">Home</header><button id="home-control">Home control</button>'));
        window.showInactive();
        const handle = window.getNativeWindowHandle().readBigUInt64LE();
        const scale = await window.webContents.executeJavaScript("devicePixelRatio");
        const hitTest = (x, y) => {
            const point = { x: Math.round(x * scale), y: Math.round(y * scale) };
            assert.equal(clientToScreen(handle, point), true);
            return Number(sendMessage(handle, 0x84, 0, (point.x & 0xffff) | ((point.y & 0xffff) << 16)));
        };
        await delay(100);
        assert.equal(hitTest(120, 18), 2);
        const page = '<div class="music-detail--container" data-playback-detail="classic-amll"><div class="classic-amll-layout"><div class="classic-amll-window-controls"></div><div class="classic-amll-controls"><button id="detail-control">Control</button></div></div></div>';
        await window.webContents.executeJavaScript('document.body.insertAdjacentHTML("beforeend", ' + JSON.stringify(page) + '); (() => { const page = document.querySelector(".music-detail--container"); let timer; const finish = () => { page.dataset.pageMotion = page.inert ? "hidden" : "visible"; }; page.addEventListener("animationend", (event) => { if (event.target === page) finish(); }); window.setDetailShown = (shown) => { clearTimeout(timer); page.classList.toggle("music-detail--enter", shown); page.classList.toggle("music-detail--exit", !shown); page.inert = !shown; page.dataset.pageMotion = shown ? "enter" : "exit"; timer = setTimeout(finish, shown ? 520 : 440); }; })();');
        for (let cycle = 0; cycle < 3; cycle++) {
            await window.webContents.executeJavaScript("window.setDetailShown(true)");
            await delay(650);
            const state = await window.webContents.executeJavaScript('(() => { const page = document.querySelector(".music-detail--container"); const button = document.querySelector("#detail-control").getBoundingClientRect(); return { phase: page.dataset.pageMotion, transform: getComputedStyle(page).transform, x: button.left + button.width / 2, y: button.top + button.height / 2 }; })()');
            assert.equal(state.phase, "visible");
            assert.equal(state.transform, "none");
            assert.equal(hitTest(820, 300), 2, "detail drag region must replace the home header region");
            assert.equal(hitTest(state.x, state.y), 1, "detail controls must remain clickable");
            await window.webContents.executeJavaScript("window.setDetailShown(false)");
            await delay(550);
            assert.equal(hitTest(120, 18), 2, "closing must restore home header dragging");
            assert.equal(hitTest(820, 300), 1, "closed detail must withdraw its drag region");
            assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".music-detail--container")).display'), "none");
        }
        await window.webContents.executeJavaScript("window.setDetailShown(true); window.setDetailShown(false); window.setDetailShown(true);");
        await delay(650);
        assert.equal(hitTest(820, 300), 2, "rapid reversal must settle to the current page");
        console.log("Music detail native drag regions passed: open, close, reopen, controls and rapid reversal");
    } finally {
        clearTimeout(watchdog);
        window.destroy();
        app.quit();
    }
}

if (process.argv.includes("--electron-child")) {
    nativeRegression().catch((error) => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    testSongMoreMenu();
    testFavoriteMotion();
    testMotion();
    if (process.argv.includes("--native") && process.platform === "win32") {
        const os = require("node:os");
        const { spawnSync } = require("node:child_process");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bakamusic-drag-test-"));
        try {
            const result = spawnSync(require("electron"), [__filename, "--electron-child"], {
                cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
                env: { ...process.env, BAKAMUSIC_DRAG_TEST_DATA: directory, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
            });
            process.stdout.write(result.stdout ?? "");
            process.stderr.write(result.stderr ?? "");
            assert.ifError(result.error);
            assert.equal(result.status, 0);
        } finally {
            assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith("bakamusic-drag-test-"));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }
}
