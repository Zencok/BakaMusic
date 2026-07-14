import Store from "@/common/store";
import type { IMod } from "./type";
import { toast } from "react-toastify";
import { useEffect } from "react";
import {
    BUILTIN_DEFAULT_THEME_HASH,
    BUILTIN_DEFAULT_THEME_PATH,
    THEME_SPEC_V2,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
} from "./default-theme";

const mod = window["@shared/themepack" as any] as unknown as IMod;

const localThemePacksStore = new Store<Array<ICommon.IThemePack | null>>([]);
const currentThemePackStore = new Store<ICommon.IThemePack | null>(
    createBuiltinDefaultThemePack(),
);

function mergeThemePacks(
    prevThemePacks: Array<ICommon.IThemePack | null>,
    nextThemePacks: Array<ICommon.IThemePack | null>,
) {
    const themePackMap = new Map<string, ICommon.IThemePack>();

    prevThemePacks.concat(nextThemePacks).forEach((themePack) => {
        if (!themePack) {
            return;
        }

        const themeKey = themePack.id || themePack.hash || themePack.path;
        themePackMap.set(themeKey, themePack);
    });

    return Array.from(themePackMap.values());
}

function resolveThemeSelection(
    themePack: ICommon.IThemePack | null,
): ICommon.IThemePack {
    // null / empty / built-in → official V2 default pack
    if (
        !themePack
        || isBuiltinDefaultTheme(themePack)
        || (!themePack.path && !themePack.hash)
        || themePack.path === BUILTIN_DEFAULT_THEME_PATH
    ) {
        return createBuiltinDefaultThemePack(themePack?.name);
    }
    return themePack;
}

async function selectTheme(themePack: ICommon.IThemePack | null) {
    const resolved = resolveThemeSelection(themePack);

    if (!isBuiltinDefaultTheme(resolved) && resolved.spec !== THEME_SPEC_V2) {
        throw new Error(
            `Unsupported theme spec (need ${THEME_SPEC_V2}, got ${resolved.spec || "missing"})`,
        );
    }

    await mod.selectTheme(resolved);
    // Always keep a concrete pack in store (never null) so UI selection works
    currentThemePackStore.setValue(
        isBuiltinDefaultTheme(resolved)
            ? createBuiltinDefaultThemePack(resolved.name)
            : resolved,
    );
}

async function selectThemeByHash(hash: string) {
    if (hash === BUILTIN_DEFAULT_THEME_HASH) {
        await selectTheme(createBuiltinDefaultThemePack());
        return;
    }

    const targetTheme = localThemePacksStore
        .getValue()
        .find((it) => it?.hash === hash);

    if (targetTheme) {
        await selectTheme(targetTheme);
    }
}

let themePacksLoaded = false;
async function setupThemePacks(): Promise<void> {
    try {
        const currentTheme = await mod.initCurrentTheme();
        if (currentTheme && (isBuiltinDefaultTheme(currentTheme) || currentTheme.spec === THEME_SPEC_V2)) {
            await selectTheme(currentTheme);
        } else {
            // Incompatible pack → fall back to built-in V2 default
            await selectTheme(createBuiltinDefaultThemePack());
        }

        requestIdleCallback(() => {
            if (!themePacksLoaded) {
                loadThemePacks().catch((): undefined => undefined);
            }
        });
    } catch {
        try {
            await selectTheme(createBuiltinDefaultThemePack());
        } catch {
            return;
        }
    }
}

async function loadThemePacks(): Promise<void> {
    themePacksLoaded = true;

    const themePacks = await mod.loadThemePacks();
    localThemePacksStore.setValue((prev) => mergeThemePacks(prev, themePacks));
}

async function installThemePack(themePackPath: string) {
    const themePackConfig = await mod.installThemePack(themePackPath);
    if (!themePackConfig) {
        throw new Error("Not Valid Theme Pack");
    }

    localThemePacksStore.setValue((prev) =>
        mergeThemePacks(prev, [themePackConfig]),
    );
    return themePackConfig;
}

async function installRemoteThemePack(
    remoteUrl: string,
    id?: string,
): Promise<ICommon.IThemePack> {
    const themePackConfig = await mod.installRemoteThemePack(remoteUrl);
    if (!themePackConfig) {
        throw new Error("Not Valid Theme Pack");
    }

    let oldThemeConfig: ICommon.IThemePack | null = null;
    if (id) {
        oldThemeConfig = localThemePacksStore.getValue().find((it) => it?.id === id) ?? null;
        if (oldThemeConfig) {
            mod.uninstallThemePack(oldThemeConfig);
        }
    }

    localThemePacksStore.setValue((prev) =>
        mergeThemePacks(
            oldThemeConfig
                ? prev.filter(
                    (it) =>
                        it?.id !== oldThemeConfig?.id &&
                        it?.hash !== oldThemeConfig?.hash,
                )
                : prev,
            [themePackConfig],
        ),
    );
    return themePackConfig;
}

async function uninstallThemePack(themePack: ICommon.IThemePack) {
    try {
        if (isBuiltinDefaultTheme(themePack)) {
            return;
        }
        await mod.uninstallThemePack(themePack);
        localThemePacksStore.setValue((prev) =>
            prev.filter((it) => it?.path !== themePack.path),
        );
        if (
            currentThemePackStore.getValue()?.path === themePack.path
            || currentThemePackStore.getValue()?.hash === themePack.hash
        ) {
            await selectTheme(createBuiltinDefaultThemePack());
        }
    } catch {
        toast.error("卸载失败");
    }
}

function useLocalThemePacks() {
    const val = localThemePacksStore.useValue();

    useEffect(() => {
        if (!themePacksLoaded) {
            loadThemePacks().catch((): undefined => undefined);
        }
    }, []);

    return val;
}

const ThemePack = {
    selectTheme,
    selectThemeByHash,
    setupThemePacks,
    loadThemePacks,
    installThemePack,
    installRemoteThemePack,
    uninstallThemePack,
    replaceAlias: mod.replaceAlias,
    useLocalThemePacks,
    useCurrentThemePack: currentThemePackStore.useValue,
    THEME_SPEC_V2,
    BUILTIN_DEFAULT_THEME_PATH,
    BUILTIN_DEFAULT_THEME_HASH,
    createBuiltinDefaultThemePack,
    isBuiltinDefaultTheme,
    isThemeSpecV2: (themePack: ICommon.IThemePack | null | undefined) =>
        themePack?.spec === THEME_SPEC_V2 || isBuiltinDefaultTheme(themePack),
};

export default ThemePack;
