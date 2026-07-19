/**
 * Download filename template formatter (inspired by MusicFree).
 * Supports preset and custom templates with variables such as {title}, {artist}.
 */

export type FileNamingType = "preset" | "custom";

export type FileNamingPreset =
    | "title-artist"
    | "artist-title"
    | "title"
    | "title-artist-album"
    | "artist-album-title"
    | "title-artist-quality";

export interface IFileNamingTemplateVariables {
    title: string;
    artist: string;
    album: string;
    quality?: string;
    platform: string;
    id: string;
}

export interface IFileNamingConfig {
    type: FileNamingType;
    preset?: FileNamingPreset;
    custom?: string;
    maxLength: number;
    keepExtension: boolean;
}

export interface IFormatFilenameOptions {
    template: string;
    variables: IFileNamingTemplateVariables;
    maxLength?: number;
    keepExtension?: boolean;
}

export interface IFormatFilenameResult {
    filename: string;
    truncated: boolean;
    originalLength: number;
}

/** Preset template map */
export const PRESET_TEMPLATES: Record<FileNamingPreset, string> = {
    "title-artist": "{title}-{artist}",
    "artist-title": "{artist}-{title}",
    title: "{title}",
    "title-artist-album": "{title}-{artist}-{album}",
    "artist-album-title": "{artist}-{album}-{title}",
    "title-artist-quality": "{title}-{artist}-{quality}",
};

export const FILE_NAMING_PRESETS = Object.keys(PRESET_TEMPLATES) as FileNamingPreset[];

/** Supported template variables and i18n description keys (suffix after settings.download.) */
export const TEMPLATE_VARIABLES = {
    "{title}": "var_title",
    "{artist}": "var_artist",
    "{album}": "var_album",
    "{quality}": "var_quality",
    "{platform}": "var_platform",
    "{id}": "var_id",
} as const;

export const DEFAULT_FILE_NAMING_CONFIG: IFileNamingConfig = {
    type: "preset",
    preset: "title-artist",
    custom: "{title}-{artist}",
    maxLength: 200,
    keepExtension: true,
};

const INVALID_FILENAME_CHARS = /[/|\\?*"<>:]+/g;
const INVALID_FILENAME_CHARS_TEST = /[/|\\?*"<>:]/;
const MAX_FILENAME_BYTES = 200;

export function getPresetTemplate(preset: FileNamingPreset): string {
    return PRESET_TEMPLATES[preset] ?? PRESET_TEMPLATES["title-artist"];
}

export function escapeFilenameCharacter(value?: string | null): string {
    return value !== undefined && value !== null
        ? `${value}`.replace(INVALID_FILENAME_CHARS, "_")
        : "";
}

export function createTemplateVariables(
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist" | "album" | "platform" | "id">,
    quality?: string,
): IFileNamingTemplateVariables {
    return {
        title: musicItem.title?.trim() || "Unknown",
        artist: musicItem.artist?.trim() || "Unknown",
        album: musicItem.album?.trim() || "Unknown",
        // Omit quality when not provided (e.g. lyric-only export) so {quality} is stripped
        quality: quality === undefined ? "" : (quality.trim() || "Unknown"),
        platform: musicItem.platform?.trim() || "Unknown",
        id: musicItem.id != null ? String(musicItem.id) : "",
    };
}

function replaceTemplateVariables(
    template: string,
    variables: IFileNamingTemplateVariables,
): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{${key}}`;
        result = result.split(placeholder).join(value ? String(value) : "");
    }

    // Drop any remaining unknown placeholders
    result = result.replace(/\{[a-zA-Z]+\}/g, "");

    // Collapse separators produced by empty variables while preserving style
    result = result
        .replace(/(\s*-\s*){2,}/g, (match) => (/\s/.test(match) ? " - " : "-"))
        .replace(/(\s*_\s*){2,}/g, "_")
        .replace(/ {2,}/g, " ")
        .replace(/^[-_\s]+|[-_\s]+$/g, "")
        .trim();

    return result;
}

function codePointUtf8Bytes(code: number): number {
    if (code <= 0x7f) {
        return 1;
    }
    if (code <= 0x7ff) {
        return 2;
    }
    if (code <= 0xffff) {
        return 3;
    }
    return 4;
}

function utf8ByteLength(str: string): number {
    let bytes = 0;
    for (const ch of str) {
        const code = ch.codePointAt(0);
        if (code === undefined) {
            continue;
        }
        bytes += codePointUtf8Bytes(code);
    }
    return bytes;
}

function truncateToByteLength(str: string, maxBytes: number): string {
    let bytes = 0;
    let result = "";
    for (const ch of str) {
        const code = ch.codePointAt(0);
        if (code === undefined) {
            continue;
        }
        const next = codePointUtf8Bytes(code);
        if (bytes + next > maxBytes) {
            break;
        }
        bytes += next;
        result += ch;
    }
    return result;
}

function truncateFilename(
    filename: string,
    maxLength: number,
    keepExtension: boolean,
): { filename: string; truncated: boolean } {
    if (filename.length <= maxLength && utf8ByteLength(filename) <= MAX_FILENAME_BYTES) {
        return { filename, truncated: false };
    }

    if (keepExtension) {
        const lastDotIndex = filename.lastIndexOf(".");
        if (lastDotIndex > 0) {
            const name = filename.slice(0, lastDotIndex);
            const ext = filename.slice(lastDotIndex);
            const availableLength = maxLength - ext.length;
            const availableBytes = MAX_FILENAME_BYTES - utf8ByteLength(ext);
            if (availableLength > 0 && availableBytes > 0) {
                return {
                    filename:
                        truncateToByteLength(
                            name.slice(0, availableLength),
                            availableBytes,
                        ) + ext,
                    truncated: true,
                };
            }
        }
    }

    return {
        filename: truncateToByteLength(filename.slice(0, maxLength), MAX_FILENAME_BYTES),
        truncated: true,
    };
}

export function validateTemplate(template: string): { valid: boolean; error?: string } {
    if (!template || typeof template !== "string" || !template.trim()) {
        return { valid: false, error: "empty" };
    }

    const hasValidVariable = Object.keys(TEMPLATE_VARIABLES).some((variable) =>
        template.includes(variable),
    );
    if (!hasValidVariable) {
        return { valid: false, error: "missing_variable" };
    }

    // Illegal filename characters outside of placeholders
    const withoutPlaceholders = template.replace(/\{[a-zA-Z]+\}/g, "");
    if (INVALID_FILENAME_CHARS_TEST.test(withoutPlaceholders)) {
        return { valid: false, error: "invalid_chars" };
    }

    return { valid: true };
}

export function formatFilename(options: IFormatFilenameOptions): IFormatFilenameResult {
    const {
        template,
        variables,
        maxLength = 200,
        keepExtension = true,
    } = options;
    const originalLength = template.length;

    let filename = replaceTemplateVariables(template, variables);
    filename = escapeFilenameCharacter(filename);

    const { filename: finalFilename, truncated } = truncateFilename(
        filename,
        maxLength,
        keepExtension,
    );

    return {
        filename: finalFilename,
        truncated,
        originalLength,
    };
}

export function resolveFileNamingTemplate(config: IFileNamingConfig): string {
    if (config.type === "custom" && config.custom?.trim()) {
        return config.custom.trim();
    }
    if (config.preset && PRESET_TEMPLATES[config.preset]) {
        return getPresetTemplate(config.preset);
    }
    return getPresetTemplate("title-artist");
}

export function generateFileNameFromConfig(
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist" | "album" | "platform" | "id">,
    config: IFileNamingConfig,
    quality?: string,
): IFormatFilenameResult {
    const template = resolveFileNamingTemplate(config);
    const variables = createTemplateVariables(musicItem, quality);

    return formatFilename({
        template,
        variables,
        maxLength: config.maxLength,
        keepExtension: config.keepExtension,
    });
}

/** Sample preview for settings UI */
export function previewFilename(
    template: string,
    options?: Pick<IFormatFilenameOptions, "maxLength">,
): string {
    const sampleVariables: IFileNamingTemplateVariables = {
        title: "烟火里的尘埃",
        artist: "郁欢",
        album: "烟火里的尘埃",
        quality: "320k",
        platform: "QQ音乐",
        id: "204422126",
    };

    return formatFilename({
        template,
        variables: sampleVariables,
        maxLength: options?.maxLength ?? 200,
        keepExtension: true,
    }).filename;
}

/**
 * Build a safe download base name from app config + music item.
 * Falls back to title-artist if the template yields an empty name.
 */
export function buildDownloadFileBaseName(
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist" | "album" | "platform" | "id">,
    config: Partial<IFileNamingConfig> | null | undefined,
    quality?: string,
): string {
    const resolved: IFileNamingConfig = {
        type: config?.type === "custom" ? "custom" : "preset",
        preset: config?.preset && PRESET_TEMPLATES[config.preset]
            ? config.preset
            : DEFAULT_FILE_NAMING_CONFIG.preset,
        custom: config?.custom?.trim() || DEFAULT_FILE_NAMING_CONFIG.custom,
        maxLength:
            typeof config?.maxLength === "number" && config.maxLength > 0
                ? config.maxLength
                : DEFAULT_FILE_NAMING_CONFIG.maxLength,
        keepExtension: config?.keepExtension ?? DEFAULT_FILE_NAMING_CONFIG.keepExtension,
    };

    const result = generateFileNameFromConfig(musicItem, resolved, quality);
    if (result.filename) {
        return result.filename;
    }

    return escapeFilenameCharacter(
        `${musicItem.title || "Unknown"}-${musicItem.artist || "Unknown"}`,
    ).slice(0, 200);
}
