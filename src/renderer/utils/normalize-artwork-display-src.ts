const MAX_ARTWORK_NORMALIZE_CACHE_SIZE = 80;
const MAX_ARTWORK_ANALYSIS_SIZE = 256;
const MAX_ARTWORK_OUTPUT_SIZE = 256;
const artworkNormalizeCache = new Map<string, Promise<string> | string>();

export function getArtworkCacheKey(src?: string | null) {
    if (!src) {
        return "";
    }

    if (!src.startsWith("data:image/")) {
        return src;
    }

    return `${src.slice(0, 48)}:${src.length}:${src.slice(-48)}`;
}

function getCachedArtwork(cacheKey: string) {
    const cached = artworkNormalizeCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    artworkNormalizeCache.delete(cacheKey);
    artworkNormalizeCache.set(cacheKey, cached);
    return cached;
}

function setCachedArtwork(cacheKey: string, value: Promise<string> | string) {
    if (artworkNormalizeCache.has(cacheKey)) {
        artworkNormalizeCache.delete(cacheKey);
    }
    artworkNormalizeCache.set(cacheKey, value);

    if (artworkNormalizeCache.size <= MAX_ARTWORK_NORMALIZE_CACHE_SIZE) {
        return;
    }

    const oldestKey = artworkNormalizeCache.keys().next().value;
    if (oldestKey) {
        artworkNormalizeCache.delete(oldestKey);
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

export default async function normalizeArtworkDisplaySrc(src?: string) {
    if (
        !src ||
        !src.startsWith("data:image/") ||
        src.startsWith("data:image/svg+xml")
    ) {
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
        let analysisCanvas: HTMLCanvasElement | null = null;
        let outputCanvas: HTMLCanvasElement | null = null;
        let image: HTMLImageElement | null = null;
        try {
            image = await loadImage(src);
            const width = image.naturalWidth;
            const height = image.naturalHeight;

            if (!width || !height) {
                return src;
            }

            const analysisScale = Math.min(
                1,
                MAX_ARTWORK_ANALYSIS_SIZE / Math.max(width, height),
            );
            const analysisWidth = Math.max(1, Math.round(width * analysisScale));
            const analysisHeight = Math.max(1, Math.round(height * analysisScale));

            analysisCanvas = document.createElement("canvas");
            analysisCanvas.width = analysisWidth;
            analysisCanvas.height = analysisHeight;
            const analysisContext = analysisCanvas.getContext("2d", {
                willReadFrequently: true,
            });

            if (!analysisContext) {
                return src;
            }

            analysisContext.drawImage(image, 0, 0, analysisWidth, analysisHeight);
            const imageData = analysisContext.getImageData(
                0,
                0,
                analysisWidth,
                analysisHeight,
            );

            // Release analysis canvas native memory immediately
            analysisCanvas.width = 0;
            analysisCanvas.height = 0;
            analysisCanvas = null;

            let minX = analysisWidth;
            let minY = analysisHeight;
            let maxX = -1;
            let maxY = -1;

            for (let y = 0; y < analysisHeight; y += 1) {
                for (let x = 0; x < analysisWidth; x += 1) {
                    const alpha = imageData.data[(y * analysisWidth + x) * 4 + 3];
                    if (alpha <= 12) {
                        continue;
                    }

                    if (x < minX) {
                        minX = x;
                    }
                    if (y < minY) {
                        minY = y;
                    }
                    if (x > maxX) {
                        maxX = x;
                    }
                    if (y > maxY) {
                        maxY = y;
                    }
                }
            }

            if (maxX < 0 || maxY < 0) {
                return src;
            }

            if (
                minX === 0 &&
                minY === 0 &&
                maxX === analysisWidth - 1 &&
                maxY === analysisHeight - 1
            ) {
                return src;
            }

            const sourceMinX = Math.max(
                0,
                Math.floor(minX / analysisScale),
            );
            const sourceMinY = Math.max(
                0,
                Math.floor(minY / analysisScale),
            );
            const sourceMaxX = Math.min(
                width - 1,
                Math.ceil((maxX + 1) / analysisScale) - 1,
            );
            const sourceMaxY = Math.min(
                height - 1,
                Math.ceil((maxY + 1) / analysisScale) - 1,
            );

            const trimmedWidth = sourceMaxX - sourceMinX + 1;
            const trimmedHeight = sourceMaxY - sourceMinY + 1;

            if (!trimmedWidth || !trimmedHeight) {
                return src;
            }

            const outputScale = Math.min(
                1,
                MAX_ARTWORK_OUTPUT_SIZE / Math.max(trimmedWidth, trimmedHeight),
            );
            const outputWidth = Math.max(1, Math.round(trimmedWidth * outputScale));
            const outputHeight = Math.max(
                1,
                Math.round(trimmedHeight * outputScale),
            );
            outputCanvas = document.createElement("canvas");
            outputCanvas.width = outputWidth;
            outputCanvas.height = outputHeight;
            const outputContext = outputCanvas.getContext("2d");

            if (!outputContext) {
                return src;
            }

            outputContext.drawImage(
                image,
                sourceMinX,
                sourceMinY,
                trimmedWidth,
                trimmedHeight,
                0,
                0,
                outputWidth,
                outputHeight,
            );

            const result = outputCanvas.toDataURL("image/png");

            // Release output canvas native memory
            outputCanvas.width = 0;
            outputCanvas.height = 0;
            outputCanvas = null;

            return result;
        } catch {
            return src;
        } finally {
            // Ensure canvas buffers are released even on error paths
            if (analysisCanvas) {
                analysisCanvas.width = 0;
                analysisCanvas.height = 0;
            }
            if (outputCanvas) {
                outputCanvas.width = 0;
                outputCanvas.height = 0;
            }
            // Release decoded image bitmap from native memory
            if (image) {
                image.src = "";
                image.onload = null;
                image.onerror = null;
            }
        }
    })();

    setCachedArtwork(cacheKey, task);
    const result = await task;
    setCachedArtwork(cacheKey, result);
    return result;
}
