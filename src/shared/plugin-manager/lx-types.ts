export const lxSources = ["kw", "kg", "tx", "wy", "mg"] as const;

export type LxSource = (typeof lxSources)[number];

export const lxSourcePlatformNames: Record<LxSource, readonly string[]> = {
    kw: ["酷我音乐", "酷我", "Kuwo"],
    kg: ["酷狗音乐", "酷狗", "Kugou"],
    tx: ["QQ音乐", "QQ Music", "Tencent"],
    wy: ["网易云音乐", "网易云", "NetEase Cloud Music", "Netease"],
    mg: ["咪咕音乐", "咪咕", "Migu"],
};

export interface LxSourceDescriptor {
    actions: ["musicUrl"];
    qualities: IMusic.IQualityKey[];
}

export interface LxPluginDescriptor {
    hash: string;
    path: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    homepage?: string;
    sourceUrl?: string;
    sources: Partial<Record<LxSource, LxSourceDescriptor>>;
    active: boolean;
}

export interface LxScriptInfo {
    name: string;
    description: string;
    version: string;
    author: string;
    homepage: string;
}

export function getLxSourceForPlatform(platform: string): LxSource | null {
    const normalized = platform.trim().toLocaleLowerCase();
    for (const source of lxSources) {
        if (lxSourcePlatformNames[source].some((name) =>
            name.toLocaleLowerCase() === normalized,
        )) {
            return source;
        }
    }
    return null;
}

export function getLxPlatformName(source: LxSource) {
    return lxSourcePlatformNames[source][0];
}
