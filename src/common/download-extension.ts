import { supportLocalMediaType } from "@/common/constant";

/**
 * Download file extension resolution — aligned with MusicFree
 * (`MusicFree/src/core/downloader.ts` prepareDownloadSource).
 *
 * Rules (order matters):
 * 1. Luna / CENC (`cek`): always `m4a` (flac 音质也是 MP4/M4A 封装，不是 .flac)
 * 2. QMC 加密源看**原始** URL 后缀 → 解密后后缀：
 *    - `.mgg` → `ogg`
 *    - `.mmp4` → `mp4`
 *    - `.mflac` / `.mflac0` → `flac`
 * 3. 其它平台：优先信任返回 URL 的**真实**后缀（须在 supportLocalMediaType 内）
 * 4. URL 无可用后缀时才用音质兜底：128k/192k/320k → mp3，其余 → flac
 *
 * Note: MusicFree `getExtensionName` defaults to "mp3" when missing, which
 * makes the quality fallback dead. We only treat a suffix as present when the
 * path actually contains one (then still require supportLocalMediaType).
 */

const supportLocalExtSet = new Set(
    supportLocalMediaType.map((ext) => ext.toLowerCase()),
);

/**
 * Extract file extension from URL path last segment, or null if absent.
 * Unlike MusicFree getExtensionName, does NOT invent "mp3".
 */
export function tryGetExtensionNameFromUrl(url: string): string | null {
    try {
        const pathname = url.split(/[?#]/)[0];
        const lastSegment = decodeURIComponent(pathname.split("/").pop() ?? "");
        const dotIndex = lastSegment.lastIndexOf(".");
        if (dotIndex > 0 && dotIndex < lastSegment.length - 1) {
            const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
            if (/^[a-z0-9]{1,5}$/.test(extension)) {
                return extension;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * @param url Final media URL after plugin/proxy (mflac/luna already rewrite + append ext).
 * @param quality Actual resolved quality (last-resort only).
 * @param options.hasCencCek Plugin returned CENC `cek` (luna stream).
 */
export function resolveDownloadExtension(
    url: string,
    quality: IMusic.IQualityKey,
    options?: {
        hasCencCek?: boolean;
    },
): string {
    const urlLower = (url || "").toLowerCase().split(/[?#]/)[0];

    // 1. Luna / CENC — always MP4 family (MusicFree: extension = "m4a")
    if (options?.hasCencCek) {
        return "m4a";
    }
    // Local luna-proxy path without a file suffix (defensive)
    if (/\/l\/[a-f0-9]+$/i.test(urlLower)) {
        return "m4a";
    }

    // 2. QMC encrypted originals (MusicFree maps before generic URL parse)
    if (urlLower.endsWith(".mgg")) {
        return "ogg";
    }
    if (urlLower.endsWith(".mmp4")) {
        return "mp4";
    }
    if (urlLower.endsWith(".mflac") || urlLower.endsWith(".mflac0")) {
        return "flac";
    }

    // 3. Prefer real URL extension when it is a known audio container
    //    (covers mflac-proxy rewritten `.../token.flac` and plain CDN `.../a.ape`)
    const urlExtension = tryGetExtensionNameFromUrl(url);
    if (urlExtension && supportLocalExtSet.has(`.${urlExtension}`)) {
        return urlExtension;
    }

    // 4. Quality fallback only when URL has no usable extension (MusicFree)
    if (
        quality === "128k"
        || quality === "192k"
        || quality === "320k"
        || (quality as string) === "96k"
    ) {
        return "mp3";
    }
    return "flac";
}
