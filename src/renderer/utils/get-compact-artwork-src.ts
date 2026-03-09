const DEFAULT_COMPACT_ARTWORK_SIZE = 240;

function clampArtworkSize(size?: number) {
    if (!Number.isFinite(size)) {
        return DEFAULT_COMPACT_ARTWORK_SIZE;
    }

    return Math.min(960, Math.max(48, Math.round(size as number)));
}

export function getCompactRemoteArtworkSrc(src?: string | null, size?: number) {
    if (!src || typeof src !== "string") {
        return undefined;
    }

    clampArtworkSize(size);

    if (
        src.startsWith("data:image/") ||
        src.startsWith("blob:") ||
        src.startsWith("file:")
    ) {
        return src;
    }

    return src;
}

export default function getCompactArtworkSrc(
    artworkLike?:
        | {
            coverImg?: string | null;
            artwork?: string | null;
        }
        | string
        | null,
    size?: number,
) {
    if (!artworkLike) {
        return undefined;
    }

    if (typeof artworkLike === "string") {
        return getCompactRemoteArtworkSrc(artworkLike, size);
    }

    return getCompactRemoteArtworkSrc(
        artworkLike.coverImg ?? artworkLike.artwork,
        size,
    );
}
