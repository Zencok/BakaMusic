const MIN_ARTWORK_DATA_URL_LENGTH_TO_OPTIMIZE = 24 * 1024;
const MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE = 160;
const MAX_OPTIMIZED_ARTWORK_CACHE_SIZE = 120;

const optimizedArtworkCache = new Map<string, Promise<string> | string>();

function getCachedArtwork(src: string) {
    const cached = optimizedArtworkCache.get(src);
    if (!cached) {
        return null;
    }

    optimizedArtworkCache.delete(src);
    optimizedArtworkCache.set(src, cached);
    return cached;
}

function setCachedArtwork(src: string, value: Promise<string> | string) {
    if (optimizedArtworkCache.has(src)) {
        optimizedArtworkCache.delete(src);
    }

    optimizedArtworkCache.set(src, value);

    if (optimizedArtworkCache.size <= MAX_OPTIMIZED_ARTWORK_CACHE_SIZE) {
        return;
    }

    const oldestKey = optimizedArtworkCache.keys().next().value;
    if (oldestKey) {
        optimizedArtworkCache.delete(oldestKey);
    }
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

export function shouldOptimizeArtworkDataUrl(src?: string | null) {
    return !!src &&
        src.startsWith("data:image/") &&
        !src.startsWith("data:image/svg+xml") &&
        src.length > MIN_ARTWORK_DATA_URL_LENGTH_TO_OPTIMIZE;
}

export default async function optimizeArtworkDataUrl(src?: string | null) {
    if (!shouldOptimizeArtworkDataUrl(src)) {
        return src;
    }

    const cached = getCachedArtwork(src);
    if (typeof cached === "string") {
        return cached;
    }
    if (cached) {
        return cached;
    }

    const task = (async () => {
        try {
            const image = await loadImage(src);
            const width = image.naturalWidth;
            const height = image.naturalHeight;

            if (!width || !height) {
                return src;
            }

            const scale = Math.min(
                1,
                MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE / Math.max(width, height),
            );
            const outputWidth = Math.max(1, Math.round(width * scale));
            const outputHeight = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;

            const context = canvas.getContext("2d", {
                alpha: true,
            });

            if (!context) {
                return src;
            }

            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.clearRect(0, 0, outputWidth, outputHeight);
            context.drawImage(image, 0, 0, outputWidth, outputHeight);

            const optimizedSrc = canvas.toDataURL("image/webp", 0.82);

            if (!optimizedSrc || optimizedSrc.length >= src.length) {
                return src;
            }

            return optimizedSrc;
        } catch {
            return src;
        }
    })();

    setCachedArtwork(src, task);
    const result = await task;
    setCachedArtwork(src, result);
    return result;
}
