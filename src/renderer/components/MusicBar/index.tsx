import { CSSProperties, useEffect, useState } from "react";
import Slider from "./widgets/Slider";
import MusicInfo from "./widgets/MusicInfo";
import Controller from "./widgets/Controller";
import Extra from "./widgets/Extra";
import { useCurrentMusic } from "@renderer/core/track-player/hooks";
import normalizeArtworkDisplaySrc from "@/renderer/utils/normalize-artwork-display-src";

import "./index.scss";

type RGB = {
    r: number;
    g: number;
    b: number;
};

type MusicBarPaletteStyle = CSSProperties & Record<string, string>;

const DEFAULT_MUSIC_BAR_STYLE: MusicBarPaletteStyle = {
    "--musicBarSurface": "color-mix(in srgb, var(--backgroundColor) 92%, var(--textColor) 8%)",
    "--musicBarSurfaceAlt": "color-mix(in srgb, var(--backgroundColor) 84%, var(--primaryColor) 16%)",
    "--musicBarText": "color-mix(in srgb, var(--textColor) 94%, black)",
    "--musicBarTextSecondary": "color-mix(in srgb, var(--textColor) 68%, transparent)",
    "--musicBarAccent": "color-mix(in srgb, var(--primaryColor) 82%, white)",
    "--musicBarPrimaryText": "#0b0b0f",
    "--musicBarBackdropOpacity": "0.38",
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function toCssColor(rgb: RGB) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function mixRgb(from: RGB, to: RGB, amount: number) {
    const ratio = clamp(amount, 0, 1);
    return {
        r: Math.round(from.r + (to.r - from.r) * ratio),
        g: Math.round(from.g + (to.g - from.g) * ratio),
        b: Math.round(from.b + (to.b - from.b) * ratio),
    };
}

function getLuminance(rgb: RGB) {
    const normalize = (value: number) => {
        const channel = value / 255;
        return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * normalize(rgb.r) + 0.7152 * normalize(rgb.g) + 0.0722 * normalize(rgb.b);
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

function buildMusicBarPalette(imageData: Uint8ClampedArray) {
    let totalWeight = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let accent: RGB = { r: 241, g: 125, b: 52 };
    let accentScore = -1;

    for (let index = 0; index < imageData.length; index += 4) {
        const alpha = imageData[index + 3] / 255;
        if (alpha < 0.18) {
            continue;
        }

        const rgb = {
            r: imageData[index],
            g: imageData[index + 1],
            b: imageData[index + 2],
        };

        const saturation = getSaturation(rgb);
        const luminance = getLuminance(rgb);
        const weight = alpha * (0.45 + saturation * 0.85);

        totalWeight += weight;
        totalR += rgb.r * weight;
        totalG += rgb.g * weight;
        totalB += rgb.b * weight;

        const accentWeight = saturation * (1 - Math.abs(luminance - 0.52));
        if (accentWeight > accentScore) {
            accent = rgb;
            accentScore = accentWeight;
        }
    }

    if (!totalWeight) {
        return DEFAULT_MUSIC_BAR_STYLE;
    }

    const average = {
        r: Math.round(totalR / totalWeight),
        g: Math.round(totalG / totalWeight),
        b: Math.round(totalB / totalWeight),
    };

    const isLightSurface = getLuminance(average) > 0.42;
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 10, g: 12, b: 18 };
    const darkBase = { r: 18, g: 22, b: 30 };

    const surface = isLightSurface
        ? mixRgb(average, white, 0.78)
        : mixRgb(average, darkBase, 0.54);
    const surfaceAlt = isLightSurface
        ? mixRgb(accent, white, 0.84)
        : mixRgb(accent, darkBase, 0.6);
    const accentColor = isLightSurface
        ? mixRgb(accent, black, 0.18)
        : mixRgb(accent, white, 0.08);
    const text = isLightSurface
        ? mixRgb(average, black, 0.88)
        : { r: 244, g: 247, b: 252 };
    const textSecondary = isLightSurface
        ? mixRgb(text, surface, 0.32)
        : mixRgb(text, surface, 0.28);
    const primaryText = getLuminance(accentColor) > 0.56 ? black : white;

    return {
        "--musicBarSurface": toCssColor(surface),
        "--musicBarSurfaceAlt": toCssColor(surfaceAlt),
        "--musicBarText": toCssColor(text),
        "--musicBarTextSecondary": toCssColor(textSecondary),
        "--musicBarAccent": toCssColor(accentColor),
        "--musicBarPrimaryText": toCssColor(primaryText),
        "--musicBarBackdropOpacity": isLightSurface ? "0.52" : "0.42",
    };
}

async function extractMusicBarStyle(artwork?: string | null) {
    if (!artwork) {
        return DEFAULT_MUSIC_BAR_STYLE;
    }

    try {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.referrerPolicy = "no-referrer";

        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("image load failed"));
            image.src = artwork;
        });

        const canvas = document.createElement("canvas");
        const width = 32;
        const height = 32;
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return DEFAULT_MUSIC_BAR_STYLE;
        }

        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        return buildMusicBarPalette(data);
    } catch {
        return DEFAULT_MUSIC_BAR_STYLE;
    }
}

export default function MusicBar() {
    const currentMusic = useCurrentMusic();
    const artwork = currentMusic?.artwork ?? currentMusic?.coverImg;
    const [musicBarStyle, setMusicBarStyle] = useState<MusicBarPaletteStyle>(DEFAULT_MUSIC_BAR_STYLE);
    const [artworkDisplaySrc, setArtworkDisplaySrc] = useState<string | undefined>(artwork);

    useEffect(() => {
        let aborted = false;

        setArtworkDisplaySrc(artwork);

        const syncMusicBarArtwork = async () => {
            const nextArtwork = await normalizeArtworkDisplaySrc(artwork);
            if (aborted) {
                return;
            }

            const resolvedArtwork = nextArtwork ?? artwork;
            setArtworkDisplaySrc(resolvedArtwork);

            const nextStyle = await extractMusicBarStyle(resolvedArtwork);
            if (!aborted) {
                setMusicBarStyle(nextStyle);
            }
        };

        void syncMusicBarArtwork();

        return () => {
            aborted = true;
        };
    }, [artwork]);

    return (
        <div className="music-bar-container" style={musicBarStyle}>
            <div
                className="music-bar-backdrop"
                style={{
                    backgroundImage: artworkDisplaySrc
                        ? `url(${artworkDisplaySrc})`
                        : undefined,
                }}
            ></div>
            <div className="music-bar-overlay"></div>
            <div className="music-bar-shell">
                <Slider></Slider>
                <MusicInfo></MusicInfo>
                <Controller></Controller>
                <Extra></Extra>
            </div>
        </div>
    );
}
