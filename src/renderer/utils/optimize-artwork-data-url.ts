const MIN_ARTWORK_DATA_URL_LENGTH_TO_OPTIMIZE = 24 * 1024;
const MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE = 160;
const MAX_OPTIMIZED_ARTWORK_CACHE_SIZE = 120;

const optimizedArtworkCache = new Map<string, Promise<string> | string>();

function getArtworkCacheKey(src: string) {
    if (!src.startsWith("data:image/")) {
        return src;
    }
    return `${src.slice(0, 48)}:${src.length}:${src.slice(-48)}`;
}

function getCachedArtwork(cacheKey: string) {
    const cached = optimizedArtworkCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    optimizedArtworkCache.delete(cacheKey);
    optimizedArtworkCache.set(cacheKey, cached);
    return cached;
}

function setCachedArtwork(cacheKey: string, value: Promise<string> | string) {
    if (optimizedArtworkCache.has(cacheKey)) {
        optimizedArtworkCache.delete(cacheKey);
    }

    optimizedArtworkCache.set(cacheKey, value);

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

    const cacheKey = getArtworkCacheKey(src);
    const cached = getCachedArtwork(cacheKey);
    if (typeof cached === "string") {
        return cached;
    }
    if (cached) {
        return cached;
    }

    const task = (async () => {
        let canvas: HTMLCanvasElement | null = null;
        try {
            const image = await loadImage(src);
            const width = image.naturalWidth;
            const height = image.naturalHeight;

            if (!width || !height) {
                image.src = "";
                return src;
            }

            const scale = Math.min(
                1,
                MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE / Math.max(width, height),
            );
            const outputWidth = Math.max(1, Math.round(width * scale));
            const outputHeight = Math.max(1, Math.round(height * scale));

            canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;

            const context = canvas.getContext("2d", {
                alpha: true,
            });

            if (!context) {
                image.src = "";
                return src;
            }

            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.clearRect(0, 0, outputWidth, outputHeight);
            context.drawImage(image, 0, 0, outputWidth, outputHeight);

            // Release decoded image bitmap
            image.src = "";

            const optimizedSrc = canvas.toDataURL("image/webp", 0.82);

            // Release canvas native memory
            canvas.width = 0;
            canvas.height = 0;
            canvas = null;

            if (!optimizedSrc || optimizedSrc.length >= src.length) {
                return src;
            }

            return optimizedSrc;
        } catch {
            return src;
        } finally {
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        }
    })();

    setCachedArtwork(cacheKey, task);
    const result = await task;
    setCachedArtwork(cacheKey, result);
    return result;
}
