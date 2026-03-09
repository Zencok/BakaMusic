import Store from "@/common/store";
import type { IMod } from "./type";
import { toast } from "react-toastify";
import { useEffect } from "react";
import debounce from "@/common/debounce";

const mod = window["@shared/themepack" as any] as unknown as IMod;

const localThemePacksStore = new Store<Array<ICommon.IThemePack | null>>([]);
const currentThemePackStore = new Store<ICommon.IThemePack | null>(null);

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

async function selectTheme(themePack: ICommon.IThemePack | null) {
    if (!themePack?.hash) {
        themePack = null;
    }
    await mod.selectTheme(themePack);
    currentThemePackStore.setValue(themePack);
}

async function selectThemeByHash(hash: string) {
    const targetTheme = localThemePacksStore
        .getValue()
        .find((it) => it?.hash === hash);

    if (targetTheme) {
        await mod.selectTheme(targetTheme);
        currentThemePackStore.setValue(targetTheme);
    }
}

let themePacksLoaded = false;
async function setupThemePacks() {
    try {
        const currentTheme = await mod.initCurrentTheme();
        await selectTheme(currentTheme);

        requestIdleCallback(() => {
            if (!themePacksLoaded) {
                loadThemePacks().catch(() => undefined);
            }
        });

        window.onresize = debounce(() => {
            mod.selectTheme(currentThemePackStore.getValue());
        }, 150, {
            leading: false,
            trailing: true,
        });
    } catch {
        return;
    }
}

async function loadThemePacks() {
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

async function installRemoteThemePack(remoteUrl: string, id?: string) {
    const themePackConfig = await mod.installRemoteThemePack(remoteUrl);
    if (!themePackConfig) {
        throw new Error("Not Valid Theme Pack");
    }

    let oldThemeConfig: ICommon.IThemePack | null = null;
    if (id) {
        oldThemeConfig = localThemePacksStore.getValue().find((it) => it?.id === id);
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
        await mod.uninstallThemePack(themePack);
        localThemePacksStore.setValue((prev) =>
            prev.filter((it) => it?.path !== themePack.path),
        );
        if (currentThemePackStore.getValue()?.path === themePack.path) {
            selectTheme(null);
        }
    } catch {
        toast.error("卸载失败");
    }
}

function useLocalThemePacks() {
    const val = localThemePacksStore.useValue();

    useEffect(() => {
        if (!themePacksLoaded) {
            loadThemePacks().catch(() => undefined);
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
};

export default ThemePack;
