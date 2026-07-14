import { RequestStateCode, themePackStoreBaseUrl } from "@/common/constant";
import useMounted from "@/hooks/useMounted";
import Themepack from "@/shared/themepack/renderer";
import axios from "axios";
import { useEffect, useState } from "react";

let themeStoreConfig: IThemeStoreItem[];

interface IThemeStoreItem {
    publishName: string;
    hash: string;
    packageName: string;
    config: ICommon.IThemePack;
    id?: string;
}

interface IThemeStoreSource {
    publishIndexUrl: string;
    packageBaseUrl: string;
}

/** BakaThemePacks v2 publish.json theme entry */
interface IBakaThemePublishEntry {
    id?: string;
    spec?: string;
    name?: string;
    packageName?: string;
    author?: string;
    description?: string;
    version?: string;
    scheme?: string;
    preview?: string;
    thumb?: string;
    themeUrl?: string;
    hash?: string;
    publishName?: string;
}

/** Legacy MusicFree array item */
interface ILegacyThemeStoreItem {
    publishName: string;
    hash: string;
    packageName: string;
    config: ICommon.IThemePack;
    id?: string;
}

function raceWithData<T>(promises: Array<Promise<T>>): Promise<T> {
    const promiseCount = promises.length;
    return new Promise((resolve, reject) => {
        let isResolved = false;
        let rejectedNum = 0;
        promises.forEach((promise) => {
            promise
                .then((data) => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve(data);
                    }
                })
                .catch((e) => {
                    ++rejectedNum;
                    if (rejectedNum === promiseCount) {
                        reject(e);
                    }
                });
        });
    });
}

function resolveThemeStoreSource(sourceUrl: string): IThemeStoreSource | null {
    if (!sourceUrl || sourceUrl.includes("dev.azure.com")) {
        return null;
    }

    const normalizedSourceUrl = sourceUrl.endsWith("/")
        ? sourceUrl
        : `${sourceUrl}/`;

    return {
        // BakaThemePacks v1/prod: publish.json at branch root
        publishIndexUrl: `${normalizedSourceUrl}publish.json`,
        packageBaseUrl: normalizedSourceUrl,
    };
}

const themeStoreSources = themePackStoreBaseUrl
    .map(resolveThemeStoreSource)
    .filter((it): it is IThemeStoreSource => Boolean(it));

function resolveAssetUrl(asset: string | undefined, packageBaseUrl: string, packageName: string): string {
    if (!asset) {
        return "";
    }
    if (asset.startsWith("#") || /^https?:\/\//i.test(asset) || asset.startsWith("data:")) {
        return asset;
    }
    if (asset.startsWith("@/")) {
        return Themepack.replaceAlias(asset, `${packageBaseUrl}${packageName}/`, false);
    }
    // Relative path under publish root (e.g. previews/foo.png, themes/foo.mftheme)
    return `${packageBaseUrl}${asset.replace(/^\//, "")}`;
}

function normalizePublishPayload(data: unknown, packageBaseUrl: string): IThemeStoreItem[] {
    // BakaThemePacks: { version, themes: [...] }
    if (data && typeof data === "object" && Array.isArray((data as { themes?: unknown }).themes)) {
        const themes = (data as { themes: IBakaThemePublishEntry[] }).themes;
        return themes
            .map((theme): IThemeStoreItem | null => {
                const packageName = theme.packageName || "";
                const publishName = theme.publishName || packageName;
                const hash = theme.hash || "";
                if (!packageName || !hash) {
                    return null;
                }

                const preview = resolveAssetUrl(theme.preview, packageBaseUrl, packageName);
                const thumb = theme.thumb
                    ? resolveAssetUrl(theme.thumb, packageBaseUrl, packageName)
                    : undefined;
                const srcUrl = theme.themeUrl
                    ? resolveAssetUrl(theme.themeUrl, packageBaseUrl, packageName)
                    : `${packageBaseUrl}themes/${publishName}.mftheme`;

                return {
                    publishName,
                    hash,
                    packageName,
                    id: theme.id,
                    config: {
                        id: theme.id,
                        spec: theme.spec || "bakamusic-theme@2",
                        name: theme.name || packageName,
                        author: theme.author,
                        description: theme.description,
                        version: theme.version,
                        scheme: theme.scheme,
                        preview,
                        thumb,
                        hash,
                        path: "",
                        srcUrl,
                    },
                };
            })
            .filter((it): it is IThemeStoreItem => Boolean(it));
    }

    // Legacy MusicFree: bare array + .publish/{name}.mftheme
    if (Array.isArray(data)) {
        return (data as ILegacyThemeStoreItem[]).map((theme) => {
            const next: IThemeStoreItem = {
                ...theme,
                config: {
                    ...theme.config,
                    srcUrl: `${packageBaseUrl}.publish/${theme.publishName}.mftheme`,
                },
            };
            if (theme.config.preview) {
                next.config.preview = Themepack.replaceAlias(
                    theme.config.preview,
                    `${packageBaseUrl}${theme.packageName}/`,
                    false,
                );
            }
            if (theme.config.thumb) {
                next.config.thumb = Themepack.replaceAlias(
                    theme.config.thumb,
                    `${packageBaseUrl}${theme.packageName}/`,
                    false,
                );
            }
            return next;
        });
    }

    throw new Error("Invalid theme store publish.json");
}

export default function () {
    const [themes, setThemes] = useState(themeStoreConfig || []);
    const [loadingState, setLoadingState] = useState(
        RequestStateCode.PENDING_FIRST_PAGE,
    );
    const isMounted = useMounted();

    useEffect(() => {
        if (themeStoreConfig) {
            setThemes(themeStoreConfig);
            setLoadingState(RequestStateCode.FINISHED);
            return;
        }

        if (!themeStoreSources.length) {
            setLoadingState(RequestStateCode.ERROR);
            return;
        }

        raceWithData(
            themeStoreSources.map(async (source, index) => {
                const res = await axios.get(source.publishIndexUrl).then((response) => {
                    if (typeof response.data !== "object" || response.data === null) {
                        throw new Error("Invalid data");
                    }

                    return response;
                });

                return [res, index] as const;
            }),
        )
            .then(([res, index]) => {
                const pickedSource = themeStoreSources[index];
                const data = normalizePublishPayload(res.data, pickedSource.packageBaseUrl);

                themeStoreConfig = data;

                if (isMounted.current) {
                    setLoadingState(RequestStateCode.FINISHED);
                    setThemes(data);
                }
            })
            .catch(() => {
                if (isMounted.current) {
                    setLoadingState(RequestStateCode.ERROR);
                }
            });
    }, []);

    return [themes, loadingState] as const;
}
