export type RGB = {
    r: number;
    g: number;
    b: number;
};

export type MusicBarPalette = Record<string, string>;

type ColorBucket = {
    weight: number;
    totalR: number;
    totalG: number;
    totalB: number;
};

type ResolvedColorBucket = ColorBucket & {
    color: RGB;
    luminance: number;
    saturation: number;
};

type HSL = {
    h: number;
    s: number;
    l: number;
};

const DEFAULT_ACCENT: RGB = { r: 241, g: 125, b: 52 };
const LIGHT_SURFACE_BASE: RGB = { r: 247, g: 249, b: 252 };
const DARK_SURFACE_BASE: RGB = { r: 18, g: 22, b: 30 };
const LIGHT_TEXT: RGB = { r: 246, g: 248, b: 252 };
const DARK_TEXT: RGB = { r: 17, g: 21, b: 29 };
const MIN_ALPHA = 0.18;
const LUMINANCE_BUCKETS = 64;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function toCssColor(rgb: RGB) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function mixRgb(from: RGB, to: RGB, amount: number): RGB {
    const ratio = clamp(amount, 0, 1);
    return {
        r: Math.round(from.r + (to.r - from.r) * ratio),
        g: Math.round(from.g + (to.g - from.g) * ratio),
        b: Math.round(from.b + (to.b - from.b) * ratio),
    };
}

function normalizeChannel(value: number) {
    const channel = value / 255;
    return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(rgb: RGB) {
    return 0.2126 * normalizeChannel(rgb.r)
        + 0.7152 * normalizeChannel(rgb.g)
        + 0.0722 * normalizeChannel(rgb.b);
}

export function getContrastRatio(first: RGB, second: RGB) {
    const firstLuminance = getRelativeLuminance(first);
    const secondLuminance = getRelativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function getSaturation(rgb: RGB) {
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    if (max === min) {
        return 0;
    }

    const lightness = (max + min) / 510;
    const delta = (max - min) / 255;
    return delta / (1 - Math.abs(2 * lightness - 1));
}

function rgbToHsl(rgb: RGB): HSL {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;

    if (!delta) {
        return { h: 0, s: 0, l: lightness };
    }

    let hue = 0;
    if (max === r) {
        hue = ((g - b) / delta) % 6;
    } else if (max === g) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }

    hue = (hue * 60 + 360) % 360;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    return { h: hue, s: saturation, l: lightness };
}

function hslToRgb(hsl: HSL): RGB {
    const hue = ((hsl.h % 360) + 360) % 360;
    const saturation = clamp(hsl.s, 0, 1);
    const lightness = clamp(hsl.l, 0, 1);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue / 60;
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;

    if (segment < 1) {
        r = chroma;
        g = intermediate;
    } else if (segment < 2) {
        r = intermediate;
        g = chroma;
    } else if (segment < 3) {
        g = chroma;
        b = intermediate;
    } else if (segment < 4) {
        g = intermediate;
        b = chroma;
    } else if (segment < 5) {
        r = intermediate;
        b = chroma;
    } else {
        r = chroma;
        b = intermediate;
    }

    const offset = lightness - chroma / 2;
    return {
        r: Math.round((r + offset) * 255),
        g: Math.round((g + offset) * 255),
        b: Math.round((b + offset) * 255),
    };
}

function getColorDistance(first: RGB, second: RGB) {
    const redMean = (first.r + second.r) / 2;
    const red = first.r - second.r;
    const green = first.g - second.g;
    const blue = first.b - second.b;
    return Math.sqrt(
        (2 + redMean / 256) * red * red
        + 4 * green * green
        + (2 + (255 - redMean) / 256) * blue * blue,
    );
}

function resolveBucket(bucket: ColorBucket): ResolvedColorBucket {
    const color = {
        r: Math.round(bucket.totalR / bucket.weight),
        g: Math.round(bucket.totalG / bucket.weight),
        b: Math.round(bucket.totalB / bucket.weight),
    };
    return {
        ...bucket,
        color,
        luminance: getRelativeLuminance(color),
        saturation: getSaturation(color),
    };
}

function mergeNearbyColors(
    seed: ResolvedColorBucket,
    buckets: ResolvedColorBucket[],
    maxDistance: number,
) {
    let totalWeight = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;

    for (const bucket of buckets) {
        const distance = getColorDistance(seed.color, bucket.color);
        if (distance > maxDistance) {
            continue;
        }

        const proximity = 1 - distance / maxDistance;
        const weight = bucket.weight * (0.72 + proximity * 0.28);
        totalWeight += weight;
        totalR += bucket.color.r * weight;
        totalG += bucket.color.g * weight;
        totalB += bucket.color.b * weight;
    }

    if (!totalWeight) {
        return seed.color;
    }

    return {
        r: Math.round(totalR / totalWeight),
        g: Math.round(totalG / totalWeight),
        b: Math.round(totalB / totalWeight),
    };
}

function getWeightedMedianLuminance(histogram: number[], totalWeight: number) {
    const midpoint = totalWeight / 2;
    let accumulated = 0;

    for (let index = 0; index < histogram.length; index += 1) {
        accumulated += histogram[index];
        if (accumulated >= midpoint) {
            return (index + 0.5) / histogram.length;
        }
    }

    return 0.5;
}

function normalizeAccent(accent: RGB, surface: RGB, isLightSurface: boolean) {
    const hsl = rgbToHsl(accent);
    const normalized = {
        h: hsl.h,
        s: clamp(hsl.s * 1.08, 0.42, 0.82),
        l: isLightSurface
            ? clamp(hsl.l, 0.34, 0.56)
            : clamp(hsl.l, 0.58, 0.72),
    };
    const direction = isLightSurface ? -1 : 1;
    let best = hslToRgb(normalized);
    let bestContrast = getContrastRatio(best, surface);

    for (let step = 1; step <= 12 && bestContrast < 3; step += 1) {
        const candidate = hslToRgb({
            ...normalized,
            l: clamp(normalized.l + direction * step * 0.025, 0.18, 0.84),
        });
        const contrast = getContrastRatio(candidate, surface);
        if (contrast > bestContrast) {
            best = candidate;
            bestContrast = contrast;
        }
    }

    return best;
}

function chooseReadableText(surface: RGB) {
    return getContrastRatio(DARK_TEXT, surface) >= getContrastRatio(LIGHT_TEXT, surface)
        ? DARK_TEXT
        : LIGHT_TEXT;
}

export function buildMusicBarPalette(
    imageData: Uint8ClampedArray,
    width = Math.max(1, Math.round(Math.sqrt(imageData.length / 4))),
    height = Math.max(1, Math.ceil(imageData.length / 4 / width)),
): MusicBarPalette | null {
    const buckets = new Map<number, ColorBucket>();
    const luminanceHistogram = Array<number>(LUMINANCE_BUCKETS).fill(0);
    let totalWeight = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let totalLuminance = 0;

    for (let index = 0; index < imageData.length; index += 4) {
        const alpha = imageData[index + 3] / 255;
        if (alpha < MIN_ALPHA) {
            continue;
        }

        const pixelIndex = index / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const normalizedX = width > 1 ? x / (width - 1) - 0.5 : 0;
        const normalizedY = height > 1 ? y / (height - 1) - 0.5 : 0;
        const distanceFromCenter = Math.min(
            1,
            Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY) / 0.707,
        );
        const weight = alpha * (0.9 + (1 - distanceFromCenter) * 0.2);
        const color = {
            r: imageData[index],
            g: imageData[index + 1],
            b: imageData[index + 2],
        };
        const luminance = getRelativeLuminance(color);
        const luminanceIndex = Math.min(
            LUMINANCE_BUCKETS - 1,
            Math.floor(luminance * LUMINANCE_BUCKETS),
        );
        const key = (color.r >> 4) << 8 | (color.g >> 4) << 4 | (color.b >> 4);
        const bucket = buckets.get(key) ?? {
            weight: 0,
            totalR: 0,
            totalG: 0,
            totalB: 0,
        };

        bucket.weight += weight;
        bucket.totalR += color.r * weight;
        bucket.totalG += color.g * weight;
        bucket.totalB += color.b * weight;
        buckets.set(key, bucket);

        totalWeight += weight;
        totalR += color.r * weight;
        totalG += color.g * weight;
        totalB += color.b * weight;
        totalLuminance += luminance * weight;
        luminanceHistogram[luminanceIndex] += weight;
    }

    if (!totalWeight || !buckets.size) {
        return null;
    }

    const resolvedBuckets = [...buckets.values()].map(resolveBucket);
    const globalAverage = {
        r: Math.round(totalR / totalWeight),
        g: Math.round(totalG / totalWeight),
        b: Math.round(totalB / totalWeight),
    };
    const dominantBucket = resolvedBuckets.reduce((best, bucket) => {
        const tonePenalty = bucket.luminance < 0.025 || bucket.luminance > 0.975
            ? 0.72
            : 1;
        const score = bucket.weight * (0.86 + bucket.saturation * 0.14) * tonePenalty;
        const bestTonePenalty = best.luminance < 0.025 || best.luminance > 0.975
            ? 0.72
            : 1;
        const bestScore = best.weight
            * (0.86 + best.saturation * 0.14)
            * bestTonePenalty;
        return score > bestScore ? bucket : best;
    });
    const dominantColor = mergeNearbyColors(dominantBucket, resolvedBuckets, 72);
    const baseColor = mixRgb(dominantColor, globalAverage, 0.2);
    const meanLuminance = totalLuminance / totalWeight;
    const medianLuminance = getWeightedMedianLuminance(
        luminanceHistogram,
        totalWeight,
    );
    const isLightSurface = meanLuminance * 0.58 + medianLuminance * 0.42 >= 0.48;
    const surface = isLightSurface
        ? mixRgb(baseColor, LIGHT_SURFACE_BASE, 0.68)
        : mixRgb(baseColor, DARK_SURFACE_BASE, 0.55);

    let accentBucket: ResolvedColorBucket | null = null;
    let accentScore = 0;
    for (const bucket of resolvedBuckets) {
        const share = bucket.weight / totalWeight;
        if (share < 0.002 || bucket.saturation < 0.1) {
            continue;
        }

        const population = Math.pow(Math.min(1, share * 8), 0.42);
        const tone = 0.45 + 0.55 * (
            1 - Math.min(1, Math.abs(bucket.luminance - 0.48) / 0.48)
        );
        const distance = Math.min(1, getColorDistance(bucket.color, baseColor) / 220);
        const score = bucket.saturation ** 1.2
            * population
            * tone
            * (0.68 + distance * 0.32);
        if (score > accentScore) {
            accentScore = score;
            accentBucket = bucket;
        }
    }

    const rawAccent = accentBucket && accentScore >= 0.035
        ? mergeNearbyColors(accentBucket, resolvedBuckets, 64)
        : DEFAULT_ACCENT;
    const accent = normalizeAccent(rawAccent, surface, isLightSurface);
    const surfaceAlt = mixRgb(accent, surface, isLightSurface ? 0.78 : 0.66);
    const text = chooseReadableText(surface);
    const textSecondary = mixRgb(text, surface, isLightSurface ? 0.38 : 0.32);
    const primaryText = chooseReadableText(accent);

    return {
        "--musicBarSurface": toCssColor(surface),
        "--musicBarSurfaceAlt": toCssColor(surfaceAlt),
        "--musicBarText": toCssColor(text),
        "--musicBarTextSecondary": toCssColor(textSecondary),
        "--musicBarAccent": toCssColor(accent),
        "--musicBarPrimaryText": toCssColor(primaryText),
        "--musicBarBackdropOpacity": isLightSurface ? "0.5" : "0.42",
    };
}
