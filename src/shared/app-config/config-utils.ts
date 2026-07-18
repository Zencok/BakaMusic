import type { IAppConfig } from "../../types/app-config";

export interface IAppConfigUpdate {
    config?: IAppConfig;
    patch: IAppConfig;
    replace?: boolean;
}

export function createChangedConfigPatch(
    currentConfig: IAppConfig | null,
    incomingPatch: IAppConfig,
): IAppConfig {
    const current = currentConfig as Record<string, unknown> | null;
    const incoming = incomingPatch as Record<string, unknown>;
    const changedPatch: Record<string, unknown> = {};

    for (const key of Object.keys(incoming)) {
        if (!Object.is(current?.[key], incoming[key])) {
            changedPatch[key] = incoming[key];
        }
    }
    return changedPatch as IAppConfig;
}

export function createResetConfigUpdate(
    currentConfig: IAppConfig | null,
    defaultConfig: IAppConfig,
): Required<Pick<IAppConfigUpdate, "config" | "patch">> {
    const config = { ...defaultConfig };
    const patch = createChangedConfigPatch(currentConfig, config);
    const current = currentConfig as Record<string, unknown> | null;
    const next = config as Record<string, unknown>;
    const changedPatch = patch as Record<string, unknown>;

    for (const key of Object.keys(current ?? {})) {
        if (!(key in next)) {
            changedPatch[key] = null;
        }
    }
    return { config, patch };
}
