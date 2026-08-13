/**
 * Download transcode policy — pure decision logic shared by renderer and utility.
 *
 * Motivation: qishui (汽水音乐) serves everything inside an MP4 container —
 * `.m4a` holding AAC, and also `.m4a`/`.mp4` holding FLAC. Neither plays well
 * with players/car head units that expect plain `.mp3` / `.flac`.
 *
 * Rules:
 * 1. Only MP4-family containers are candidates. Real `.mp3` / `.flac` / `.ogg`
 *    downloads are already in their native container and stay untouched.
 * 2. The decision is made on the *actual* codec inside the container
 *    (libmpv `audio-codec-name`), never on the file extension.
 * 3. Dolby / surround codecs are never transcoded. QQ 音乐 dolby is AC-4 in
 *    MP4; downmixing it to stereo MP3 destroys exactly what the user paid for.
 * 4. Lossless in → FLAC (re-encode is still bit-exact). Lossy in → MP3.
 *    Lossy → FLAC is deliberately not offered: it quadruples file size and
 *    cannot recover the discarded audio.
 */

export type DownloadTranscodeMode = "off" | "auto";

export type DownloadMp3Bitrate = "192k" | "256k" | "320k" | "v0";

export const DOWNLOAD_MP3_BITRATES: readonly DownloadMp3Bitrate[] = [
    "192k",
    "256k",
    "320k",
    "v0",
];

/** Containers whose payload codec is ambiguous and worth unwrapping. */
const MP4_FAMILY_EXTENSIONS = new Set([
    ".mp4",
    ".m4a",
    ".m4b",
    ".m4r",
]);

/**
 * Surround / object-based codecs. Transcoding these to stereo MP3 or FLAC is a
 * downgrade no matter the target, so the original container is kept as-is.
 */
const PRESERVED_CODECS = new Set([
    "ac4",
    "ac3",
    "eac3",
    "eac3_core",
    "truehd",
    "mlp",
    "dts",
    "dtshd",
    "dts_hd",
]);

/** Lossless codecs that can be re-encoded to FLAC without losing a sample. */
const LOSSLESS_CODECS = new Set([
    "flac",
    "alac",
    "wavpack",
    "tta",
    "ape",
    "monkeys audio",
]);

export type AudioCodecClass = "lossless" | "lossy" | "preserve";

/**
 * Normalize the libmpv `audio-codec-name` value.
 * mpv reports plain decoder names (`aac`, `flac`, `ac4`), but some builds add
 * profile suffixes such as `aac_latm` or vendor prefixes.
 */
export function normalizeAudioCodecName(codecName: string | null | undefined) {
    return (codecName ?? "").trim().toLowerCase();
}

export function classifyAudioCodec(codecName: string | null | undefined): AudioCodecClass {
    const codec = normalizeAudioCodecName(codecName);
    if (!codec) {
        // Unknown codec: never touch the file.
        return "preserve";
    }
    if (PRESERVED_CODECS.has(codec)) {
        return "preserve";
    }
    if (LOSSLESS_CODECS.has(codec) || codec.startsWith("pcm_")) {
        return "lossless";
    }
    return "lossy";
}

export function isTranscodableContainer(filePath: string) {
    const lower = filePath.toLowerCase();
    const dotIndex = lower.lastIndexOf(".");
    if (dotIndex <= 0) {
        return false;
    }
    return MP4_FAMILY_EXTENSIONS.has(lower.slice(dotIndex));
}

export interface ITranscodeTarget {
    /** Output container + encoder pair. */
    format: "mp3" | "flac";
    extension: ".mp3" | ".flac";
    /** libmpv `oac` value. */
    encoder: "libmp3lame" | "flac";
    /** libmpv `oacopts` value, empty when the encoder needs no tuning. */
    encoderOptions: string;
    /** True when the conversion preserves every sample. */
    lossless: boolean;
}

function resolveMp3EncoderOptions(bitrate: DownloadMp3Bitrate) {
    // LAME V0 is VBR ~245kbps average and transparent for most material;
    // the fixed rates stay CBR so player/hardware seek tables behave.
    return bitrate === "v0" ? "q=0" : `b=${bitrate}`;
}

/**
 * Decide what a downloaded file should be converted into.
 * Returns null when the file must be left exactly as downloaded.
 */
export function resolveTranscodeTarget(options: {
    filePath: string;
    codecName: string | null | undefined;
    mode: DownloadTranscodeMode;
    mp3Bitrate: DownloadMp3Bitrate;
}): ITranscodeTarget | null {
    if (options.mode !== "auto") {
        return null;
    }
    if (!isTranscodableContainer(options.filePath)) {
        return null;
    }

    const codecClass = classifyAudioCodec(options.codecName);
    if (codecClass === "preserve") {
        return null;
    }
    if (codecClass === "lossless") {
        return {
            format: "flac",
            extension: ".flac",
            encoder: "flac",
            encoderOptions: "",
            lossless: true,
        };
    }
    return {
        format: "mp3",
        extension: ".mp3",
        encoder: "libmp3lame",
        encoderOptions: resolveMp3EncoderOptions(options.mp3Bitrate),
        lossless: false,
    };
}

export function isDownloadTranscodeMode(value: unknown): value is DownloadTranscodeMode {
    return value === "off" || value === "auto";
}

export function isDownloadMp3Bitrate(value: unknown): value is DownloadMp3Bitrate {
    return DOWNLOAD_MP3_BITRATES.includes(value as DownloadMp3Bitrate);
}

/** Request payload crossing renderer → main → utility. */
export interface IDownloadTranscodeOptions {
    mode: DownloadTranscodeMode;
    mp3Bitrate: DownloadMp3Bitrate;
    /** Remove the source container once the new file is on disk. */
    deleteSource: boolean;
}

export interface IDownloadTranscodeResult {
    /** Path the rest of the download pipeline should keep using. */
    filePath: string;
    transcoded: boolean;
    /** Codec found inside the container, when it was probed. */
    codecName?: string | null;
    format?: "mp3" | "flac";
    /** Present when transcoding was attempted and failed. */
    error?: string;
}
