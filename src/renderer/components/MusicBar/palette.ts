export type RGB = {
    r: number;
    g: number;
    b: number;
};

export type MusicBarPalette = Record<string, string>;

export type MusicBarPaletteTone = "light" | "dark";

export type MusicBarPaletteVariants = Record<
    MusicBarPaletteTone,
    MusicBarPalette
>;

type ColorBucket = {
    weight: number;
    totalR: number;
    totalG: number;
    totalB: number;
};

type OKLab = {
    l: number;
    a: number;
    b: number;
};

type OKLCH = {
    l: number;
    c: number;
    h: number;
};

type UnitRGB = {
    r: number;
    g: number;
    b: number;
};

type ResolvedColorBucket = ColorBucket & {
    color: RGB;
    lab: OKLab;
    chroma: number;
};

const DEFAULT_ACCENT: RGB = { r: 241, g: 125, b: 52 };
const DEFAULT_SURFACE_SEED: RGB = { r: 96, g: 106, b: 120 };
const LIGHT_GLASS_BACKDROP: RGB = { r: 247, g: 249, b: 252 };
const DARK_GLASS_BACKDROP: RGB = { r: 13, g: 16, b: 23 };
const LIGHT_TEXT: RGB = { r: 246, g: 248, b: 252 };
const DARK_TEXT: RGB = { r: 17, g: 21, b: 29 };
const MIN_ALPHA = 0.18;

// Keep this aligned with --liquidGlassSurface in MusicBar/index.scss.
export const MUSIC_BAR_GLASS_TINT_ALPHA = 0.52;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function toCssColor(rgb: RGB) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function normalizeChannel(value: number) {
    const channel = value / 255;
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

function encodeChannel(value: number) {
    return value <= 0.0031308
        ? value * 12.92
        : 1.055 * value ** (1 / 2.4) - 0.055;
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

export function compositeRgb(
    foreground: RGB,
    backdrop: RGB,
    alpha: number,
): RGB {
    const ratio = clamp(alpha, 0, 1);
    return {
        r: Math.round(foreground.r * ratio + backdrop.r * (1 - ratio)),
        g: Math.round(foreground.g * ratio + backdrop.g * (1 - ratio)),
        b: Math.round(foreground.b * ratio + backdrop.b * (1 - ratio)),
    };
}

function rgbToOklab(rgb: RGB): OKLab {
    const red = normalizeChannel(rgb.r);
    const green = normalizeChannel(rgb.g);
    const blue = normalizeChannel(rgb.b);
    const l = Math.cbrt(
        0.4122214708 * red
        + 0.5363325363 * green
        + 0.0514459929 * blue,
    );
    const m = Math.cbrt(
        0.2119034982 * red
        + 0.6806995451 * green
        + 0.1073969566 * blue,
    );
    const s = Math.cbrt(
        0.0883024619 * red
        + 0.2817188376 * green
        + 0.6299787005 * blue,
    );

    return {
        l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
}

function oklabToUnitRgb(lab: OKLab): UnitRGB {
    const l = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
    const l3 = l ** 3;
    const m3 = m ** 3;
    const s3 = s ** 3;

    return {
        r: encodeChannel(
            4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        ),
        g: encodeChannel(
            -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        ),
        b: encodeChannel(
            -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
        ),
    };
}

function unitRgbToRgb(rgb: UnitRGB): RGB {
    return {
        r: Math.round(clamp(rgb.r, 0, 1) * 255),
        g: Math.round(clamp(rgb.g, 0, 1) * 255),
        b: Math.round(clamp(rgb.b, 0, 1) * 255),
    };
}

function isInSrgbGamut(rgb: UnitRGB) {
    return rgb.r >= 0 && rgb.r <= 1
        && rgb.g >= 0 && rgb.g <= 1
        && rgb.b >= 0 && rgb.b <= 1;
}

function rgbToOklch(rgb: RGB): OKLCH {
    const lab = rgbToOklab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);
    return {
        l: lab.l,
        c: chroma,
        h: chroma < 0.0001
            ? 0
            : (Math.atan2(lab.b, lab.a) * 180 / Math.PI + 360) % 360,
    };
}

function oklchToOklab(color: OKLCH): OKLab {
    const hue = color.h * Math.PI / 180;
    return {
        l: clamp(color.l, 0, 1),
        a: Math.cos(hue) * Math.max(0, color.c),
        b: Math.sin(hue) * Math.max(0, color.c),
    };
}

function oklchToRgb(color: OKLCH): RGB {
    const direct = oklabToUnitRgb(oklchToOklab(color));
    if (isInSrgbGamut(direct)) {
        return unitRgbToRgb(direct);
    }

    let minimumChroma = 0;
    let maximumChroma = Math.max(0, color.c);
    let best = oklabToUnitRgb(oklchToOklab({ ...color, c: 0 }));

    for (let step = 0; step < 18; step += 1) {
        const chroma = (minimumChroma + maximumChroma) / 2;
        const candidate = oklabToUnitRgb(oklchToOklab({ ...color, c: chroma }));
        if (isInSrgbGamut(candidate)) {
            minimumChroma = chroma;
            best = candidate;
        } else {
            maximumChroma = chroma;
        }
    }

    return unitRgbToRgb(best);
}

function mixOklab(from: RGB, to: RGB, amount: number): RGB {
    const ratio = clamp(amount, 0, 1);
    const first = rgbToOklab(from);
    const second = rgbToOklab(to);
    return unitRgbToRgb(oklabToUnitRgb({
        l: first.l + (second.l - first.l) * ratio,
        a: first.a + (second.a - first.a) * ratio,
        b: first.b + (second.b - first.b) * ratio,
    }));
}

function getColorDistance(first: RGB, second: RGB) {
    const firstLab = rgbToOklab(first);
    const secondLab = rgbToOklab(second);
    return Math.hypot(
        firstLab.l - secondLab.l,
        firstLab.a - secondLab.a,
        firstLab.b - secondLab.b,
    );
}

function resolveBucket(bucket: ColorBucket): ResolvedColorBucket {
    const color = {
        r: Math.round(bucket.totalR / bucket.weight),
        g: Math.round(bucket.totalG / bucket.weight),
        b: Math.round(bucket.totalB / bucket.weight),
    };
    const lab = rgbToOklab(color);
    return {
        ...bucket,
        color,
        lab,
        chroma: Math.hypot(lab.a, lab.b),
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

function chooseReadableText(surfaces: RGB | RGB[]) {
    const backgrounds = Array.isArray(surfaces) ? surfaces : [surfaces];
    const darkContrast = Math.min(
        ...backgrounds.map((surface) => getContrastRatio(DARK_TEXT, surface)),
    );
    const lightContrast = Math.min(
        ...backgrounds.map((surface) => getContrastRatio(LIGHT_TEXT, surface)),
    );
    return darkContrast >= lightContrast ? DARK_TEXT : LIGHT_TEXT;
}

function createSurface(baseColor: RGB, tone: MusicBarPaletteTone) {
    const seed = rgbToOklch(baseColor);
    return oklchToRgb({
        l: tone === "light" ? 0.92 : 0.32,
        c: Math.min(seed.c * 0.38, tone === "light" ? 0.045 : 0.065),
        h: seed.h,
    });
}

function createSurfaceAlt(
    surface: RGB,
    rawAccent: RGB,
    tone: MusicBarPaletteTone,
) {
    const surfaceSeed = rgbToOklch(surface);
    const accentSeed = rgbToOklch(rawAccent);
    const useAccentHue = accentSeed.c >= 0.025;
    return oklchToRgb({
        l: tone === "light" ? 0.89 : 0.36,
        c: Math.min(
            surfaceSeed.c * 0.65 + accentSeed.c * 0.18,
            tone === "light" ? 0.055 : 0.075,
        ),
        h: useAccentHue ? accentSeed.h : surfaceSeed.h,
    });
}

function normalizeAccent(
    rawAccent: RGB,
    effectiveSurfaces: RGB[],
    tone: MusicBarPaletteTone,
) {
    const seed = rgbToOklch(rawAccent);
    const chroma = clamp(seed.c * 1.06, 0.11, 0.23);
    const initialLightness = tone === "light" ? 0.58 : 0.72;
    const direction = tone === "light" ? -1 : 1;
    let bestAccent = oklchToRgb({
        l: initialLightness,
        c: chroma,
        h: seed.h,
    });
    let bestPrimaryText = chooseReadableText(bestAccent);
    let bestScore = 0;

    for (let step = 0; step <= 16; step += 1) {
        const accent = oklchToRgb({
            l: clamp(initialLightness + direction * step * 0.025, 0.2, 0.86),
            c: chroma,
            h: seed.h,
        });
        const primaryText = chooseReadableText(accent);
        const surfaceContrast = Math.min(
            ...effectiveSurfaces.map((surface) => getContrastRatio(accent, surface)),
        );
        const primaryContrast = getContrastRatio(primaryText, accent);
        const score = Math.min(surfaceContrast / 3, primaryContrast / 4.5);

        if (score > bestScore) {
            bestScore = score;
            bestAccent = accent;
            bestPrimaryText = primaryText;
        }
        if (surfaceContrast >= 3 && primaryContrast >= 4.5) {
            return { accent, primaryText };
        }
    }

    return { accent: bestAccent, primaryText: bestPrimaryText };
}

function buildTonePalette(
    baseColor: RGB,
    rawAccent: RGB,
    tone: MusicBarPaletteTone,
): MusicBarPalette {
    const backdrop = tone === "light"
        ? LIGHT_GLASS_BACKDROP
        : DARK_GLASS_BACKDROP;
    const surface = createSurface(baseColor, tone);
    const surfaceAlt = createSurfaceAlt(surface, rawAccent, tone);
    const effectiveSurfaces = [surface, surfaceAlt].map((color) => compositeRgb(
        color,
        backdrop,
        MUSIC_BAR_GLASS_TINT_ALPHA,
    ));
    const text = chooseReadableText(effectiveSurfaces);
    const textSecondary = mixOklab(
        text,
        effectiveSurfaces[0],
        tone === "light" ? 0.4 : 0.32,
    );
    const { accent, primaryText } = normalizeAccent(
        rawAccent,
        effectiveSurfaces,
        tone,
    );

    return {
        "--musicBarSurface": toCssColor(surface),
        "--musicBarSurfaceAlt": toCssColor(surfaceAlt),
        "--musicBarText": toCssColor(text),
        "--musicBarTextSecondary": toCssColor(textSecondary),
        "--musicBarAccent": toCssColor(accent),
        "--musicBarPrimaryText": toCssColor(primaryText),
        "--musicBarBackdropOpacity": tone === "light" ? "0.5" : "0.42",
    };
}

export const DEFAULT_MUSIC_BAR_PALETTES: MusicBarPaletteVariants = {
    light: buildTonePalette(DEFAULT_SURFACE_SEED, DEFAULT_ACCENT, "light"),
    dark: buildTonePalette(DEFAULT_SURFACE_SEED, DEFAULT_ACCENT, "dark"),
};

export function buildMusicBarPalette(
    imageData: Uint8ClampedArray,
    width = Math.max(1, Math.round(Math.sqrt(imageData.length / 4))),
    height = Math.max(1, Math.ceil(imageData.length / 4 / width)),
): MusicBarPaletteVariants | null {
    const buckets = new Map<number, ColorBucket>();
    let totalWeight = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;

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
        const tonePenalty = bucket.lab.l < 0.08 || bucket.lab.l > 0.97 ? 0.72 : 1;
        const colorfulness = clamp(bucket.chroma / 0.24, 0, 1);
        const score = bucket.weight * (0.86 + colorfulness * 0.14) * tonePenalty;
        const bestTonePenalty = best.lab.l < 0.08 || best.lab.l > 0.97 ? 0.72 : 1;
        const bestColorfulness = clamp(best.chroma / 0.24, 0, 1);
        const bestScore = best.weight
            * (0.86 + bestColorfulness * 0.14)
            * bestTonePenalty;
        return score > bestScore ? bucket : best;
    });
    const dominantColor = mergeNearbyColors(dominantBucket, resolvedBuckets, 0.18);
    const baseColor = mixOklab(dominantColor, globalAverage, 0.2);

    let accentBucket: ResolvedColorBucket | null = null;
    let accentScore = 0;
    for (const bucket of resolvedBuckets) {
        const share = bucket.weight / totalWeight;
        if (share < 0.002 || bucket.chroma < 0.025) {
            continue;
        }

        const colorfulness = clamp(bucket.chroma / 0.24, 0, 1);
        const population = Math.pow(Math.min(1, share * 8), 0.42);
        const tone = 0.45 + 0.55 * (
            1 - Math.min(1, Math.abs(bucket.lab.l - 0.62) / 0.54)
        );
        const distance = Math.min(1, getColorDistance(bucket.color, baseColor) / 0.32);
        const score = colorfulness ** 1.2
            * population
            * tone
            * (0.68 + distance * 0.32);
        if (score > accentScore) {
            accentScore = score;
            accentBucket = bucket;
        }
    }

    const rawAccent = accentBucket && accentScore >= 0.035
        ? mergeNearbyColors(accentBucket, resolvedBuckets, 0.14)
        : DEFAULT_ACCENT;

    return {
        light: buildTonePalette(baseColor, rawAccent, "light"),
        dark: buildTonePalette(baseColor, rawAccent, "dark"),
    };
}
