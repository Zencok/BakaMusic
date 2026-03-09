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
        publishIndexUrl: `${normalizedSourceUrl}.publish/publish.json`,
        packageBaseUrl: normalizedSourceUrl,
    };
}

const themeStoreSources = themePackStoreBaseUrl
    .map(resolveThemeStoreSource)
    .filter((it): it is IThemeStoreSource => Boolean(it));

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
                    if (typeof response.data !== "object") {
                        throw new Error("Invalid data");
                    }

                    return response;
                });

                return [res, index] as const;
            }),
        )
            .then(([res, index]) => {
                const data: IThemeStoreItem[] = res.data;
                const pickedSource = themeStoreSources[index];

                data.forEach((theme) => {
                    theme.config.srcUrl = `${pickedSource.packageBaseUrl}.publish/${theme.publishName}.mftheme`;
                    if (theme.config.preview) {
                        theme.config.preview = Themepack.replaceAlias(
                            theme.config.preview,
                            `${pickedSource.packageBaseUrl}${theme.packageName}/`,
                            false,
                        );
                    }
                    if (theme.config.thumb) {
                        theme.config.thumb = Themepack.replaceAlias(
                            theme.config.thumb,
                            `${pickedSource.packageBaseUrl}${theme.packageName}/`,
                            false,
                        );
                    }
                });

                themeStoreConfig = data;

                if (isMounted.current) {
                    setLoadingState(RequestStateCode.FINISHED);
                    setThemes(data);
                }
            })
            .catch(() => {
                setLoadingState(RequestStateCode.ERROR);
            });
    }, []);

    return [themes, loadingState] as const;
}
