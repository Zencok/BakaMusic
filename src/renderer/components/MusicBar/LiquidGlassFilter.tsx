import { RefObject, useEffect, useState } from "react";

const FILTER_ID = "bakamusic-music-bar-liquid-glass";

/**
 * Edge-only lens map, aligned with AndroidLiquidGlass default `lens()` path:
 * refraction without chromatic aberration. Center stays neutral; only the
 * rim pulls the backdrop inward for a soft liquid edge.
 */
function supportsSvgBackdropFilter() {
    const probe = document.createElement("div");
    probe.style.setProperty("backdrop-filter", `url(#${FILTER_ID})`);
    return probe.style.getPropertyValue("backdrop-filter") !== "";
}

function createDisplacementMap(width: number, height: number, radius: number) {
    const safeWidth = Math.max(240, Math.round(width || 400));
    const safeHeight = Math.max(48, Math.round(height || 80));
    const safeRadius = Math.max(12, Math.round(radius || safeHeight / 2));
    // Thin refraction band (~refractionHeight in the Android lens demos).
    const edge = Math.min(safeWidth, safeHeight) * 0.09;
    const innerWidth = Math.max(1, safeWidth - edge * 2);
    const innerHeight = Math.max(1, safeHeight - edge * 2);
    const blur = Math.max(4, Math.round(edge * 0.55));
    const svg = [
        `<svg viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">`,
        "<defs>",
        // Horizontal pull (R) and vertical pull (B) — same magnitude, no RGB split.
        "<linearGradient id=\"glass-r\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"0%\">",
        "<stop offset=\"0%\" stop-color=\"#ff0000\" stop-opacity=\"0.55\"/>",
        "<stop offset=\"50%\" stop-color=\"#808080\" stop-opacity=\"0\"/>",
        "<stop offset=\"100%\" stop-color=\"#0000ff\" stop-opacity=\"0.55\"/>",
        "</linearGradient>",
        "<linearGradient id=\"glass-b\" x1=\"0%\" y1=\"0%\" x2=\"0%\" y2=\"100%\">",
        "<stop offset=\"0%\" stop-color=\"#0000ff\" stop-opacity=\"0.45\"/>",
        "<stop offset=\"50%\" stop-color=\"#808080\" stop-opacity=\"0\"/>",
        "<stop offset=\"100%\" stop-color=\"#ff0000\" stop-opacity=\"0.45\"/>",
        "</linearGradient>",
        "</defs>",
        // Neutral mid-gray = no displacement in the panel body.
        `<rect width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" fill="#808080"/>`,
        // Soft edge gradients only; center plate cancels interior pull.
        `<rect width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" fill="url(#glass-r)"/>`,
        `<rect width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" fill="url(#glass-b)" style="mix-blend-mode:screen"/>`,
        `<rect x="${edge.toFixed(2)}" y="${edge.toFixed(2)}" width="${innerWidth.toFixed(2)}" height="${innerHeight.toFixed(2)}" rx="${Math.max(0, safeRadius - edge * 0.35).toFixed(2)}" fill="#808080" style="filter:blur(${blur}px)"/>`,
        "</svg>",
    ].join("");
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function useMusicBarLiquidGlass(
    targetRef: RefObject<HTMLDivElement | null>,
) {
    const [mapHref, setMapHref] = useState("");
    const [supported, setSupported] = useState(false);

    useEffect(() => {
        const target = targetRef.current;
        if (!target || !supportsSvgBackdropFilter()) {
            setSupported(false);
            return;
        }

        setSupported(true);
        let mapKey = "";
        let frame = 0;
        const updateMap = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const rect = target.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) {
                    return;
                }
                const radius = Number.parseFloat(getComputedStyle(target).borderRadius)
                    || rect.height / 2;
                const nextKey = `${Math.round(rect.width)}x${Math.round(rect.height)}:${Math.round(radius)}`;
                if (mapKey === nextKey) {
                    return;
                }
                mapKey = nextKey;
                setMapHref(createDisplacementMap(rect.width, rect.height, radius));
            });
        };

        updateMap();
        const observer = new ResizeObserver(updateMap);
        observer.observe(target);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [targetRef]);

    return { mapHref, supported };
}

export default function LiquidGlassFilter(props: { mapHref: string }) {
    // React 19 warns on href=""; wait until the displacement map is ready.
    if (!props.mapHref) {
        return null;
    }

    return (
        <svg
            className="music-bar-liquid-filter"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <filter
                    id={FILTER_ID}
                    colorInterpolationFilters="sRGB"
                    x="-5%"
                    y="-12%"
                    width="110%"
                    height="124%"
                >
                    <feImage
                        href={props.mapHref}
                        x="0"
                        y="0"
                        width="100%"
                        height="100%"
                        preserveAspectRatio="none"
                        result="map"
                    ></feImage>
                    {/* Single-channel edge lens — no RGB chromatic fringing. */}
                    <feDisplacementMap
                        in="SourceGraphic"
                        in2="map"
                        scale="28"
                        xChannelSelector="R"
                        yChannelSelector="B"
                        result="refracted"
                    ></feDisplacementMap>
                    <feGaussianBlur in="refracted" stdDeviation="0.35"></feGaussianBlur>
                </filter>
            </defs>
        </svg>
    );
}
