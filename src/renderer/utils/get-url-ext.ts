const extAliasMap: Record<string, string> = {
    ".mflac": ".flac",
    ".mgg": ".ogg",
    ".mmp4": ".mp4",
};

const validExtSet = new Set([
    ".mp3",
    ".flac",
    ".ogg",
    ".mp4",
    ".m4a",
    ".aac",
    ".wav",
    ".opus",
    ".m4s",
    ".m3u8",
    ".mflac",
    ".mgg",
    ".mmp4",
]);

function normalizeExt(ext?: string | null) {
    if (!ext) {
        return;
    }

    const normalizedExt = (extAliasMap[ext.toLowerCase()] ?? ext.toLowerCase()).trim();
    if (!validExtSet.has(normalizedExt)) {
        return;
    }

    return normalizedExt;
}

function getPathExt(value: string) {
    const sanitizedValue = decodeURIComponent(value.split(/[?#]/)[0] ?? "");
    return normalizeExt(window.path.extname(sanitizedValue));
}

function getUrlExtImpl(url: string, visited = new Set<string>()): string | undefined {
    if (!url || visited.has(url)) {
        return;
    }
    visited.add(url);

    try {
        const urlObj = new URL(url);
        const directExt = getPathExt(urlObj.pathname);
        if (directExt) {
            return directExt;
        }

        for (const paramKey of ["url", "src", "file", "filename", "path"]) {
            const nestedUrl = urlObj.searchParams.get(paramKey);
            if (!nestedUrl) {
                continue;
            }

            const nestedExt = getUrlExtImpl(decodeURIComponent(nestedUrl), visited);
            if (nestedExt) {
                return nestedExt;
            }
        }
    } catch {
        return getPathExt(url);
    }
}

export default function getUrlExt(url?: string) {
    if (!url) {
        return;
    }

    return getUrlExtImpl(url);
}
