const MIN_ARTWORK_BYTES_TO_OPTIMIZE = 24 * 1024;
const MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE = 160;
export const MAX_LOCAL_ARTWORK_BYTES = 64 * 1024;

interface IEmbeddedArtwork {
    format: string;
    data: Uint8Array;
}

function toDataUrl(format: string, data: Buffer) {
    return `data:${format};base64,${data.toString("base64")}`;
}

export async function createLocalArtworkDataUrl(
    picture: IEmbeddedArtwork,
): Promise<string | undefined> {
    const input = Buffer.from(picture.data);
    if (input.length <= MIN_ARTWORK_BYTES_TO_OPTIMIZE) {
        return toDataUrl(picture.format, input);
    }

    try {
        const sharp = (await import("sharp")).default;
        const output = await sharp(input, { failOn: "none" })
            .rotate()
            .resize({
                width: MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE,
                height: MAX_LOCAL_ARTWORK_THUMBNAIL_SIZE,
                fit: "inside",
                withoutEnlargement: true,
            })
            .webp({ quality: 82 })
            .toBuffer();

        if (
            output.length < input.length
            && output.length <= MAX_LOCAL_ARTWORK_BYTES
        ) {
            return toDataUrl("image/webp", output);
        }
    } catch {
        // Keep a bounded original below; corrupt artwork must not fail the track.
    }

    return input.length <= MAX_LOCAL_ARTWORK_BYTES
        ? toDataUrl(picture.format, input)
        : undefined;
}
