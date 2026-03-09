const artworkNormalizeCache = new Map<string, Promise<string> | string>();

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

    const cached = artworkNormalizeCache.get(src);
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

            const sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = width;
            sourceCanvas.height = height;
            const sourceContext = sourceCanvas.getContext("2d", {
                willReadFrequently: true,
            });

            if (!sourceContext) {
                return src;
            }

            sourceContext.drawImage(image, 0, 0, width, height);
            const imageData = sourceContext.getImageData(0, 0, width, height);

            let minX = width;
            let minY = height;
            let maxX = -1;
            let maxY = -1;

            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const alpha = imageData.data[(y * width + x) * 4 + 3];
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
                maxX === width - 1 &&
                maxY === height - 1
            ) {
                return src;
            }

            const trimmedWidth = maxX - minX + 1;
            const trimmedHeight = maxY - minY + 1;

            if (!trimmedWidth || !trimmedHeight) {
                return src;
            }

            const outputCanvas = document.createElement("canvas");
            outputCanvas.width = trimmedWidth;
            outputCanvas.height = trimmedHeight;
            const outputContext = outputCanvas.getContext("2d");

            if (!outputContext) {
                return src;
            }

            outputContext.drawImage(
                sourceCanvas,
                minX,
                minY,
                trimmedWidth,
                trimmedHeight,
                0,
                0,
                trimmedWidth,
                trimmedHeight,
            );

            return outputCanvas.toDataURL("image/png");
        } catch {
            return src;
        }
    })();

    artworkNormalizeCache.set(src, task);
    const result = await task;
    artworkNormalizeCache.set(src, result);
    return result;
}
