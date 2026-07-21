import { nativeTheme } from "electron";

/** Windows 11 22H2+ (build 22621) is the floor for Electron Acrylic. */
const WINDOWS_ACRYLIC_MIN_BUILD = 22621;

/**
 * LyciaMusic acrylic tints (Tauri Effect.Acrylic color):
 * dark  [18, 18, 18, 140]  ≈ 55% cover
 * light [248, 248, 248, 125] ≈ 49% cover
 *
 * Electron has no acrylic color channel, so the same density is applied as
 * a CSS canvas wash. These values stay available if a future runtime exposes
 * a tinted material API.
 */
export const ACRYLIC_TINT_DARK = "rgba(18, 18, 18, 0.55)";
export const ACRYLIC_TINT_LIGHT = "rgba(248, 248, 248, 0.49)";

export type ThemeScheme = "light" | "dark";

export function supportsNativeAcrylic(): boolean {
    if (process.platform !== "win32") {
        return false;
    }
    const build = Number.parseInt(process.getSystemVersion().split(".")[2] ?? "0", 10);
    return Number.isFinite(build) && build >= WINDOWS_ACRYLIC_MIN_BUILD;
}

export function resolveThemeScheme(
    scheme?: ThemeScheme | null,
): ThemeScheme {
    if (scheme === "dark" || scheme === "light") {
        return scheme;
    }
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

export function getOpaqueWindowBackground(scheme?: ThemeScheme | null): string {
    return resolveThemeScheme(scheme) === "dark" ? "#12182a" : "#f4f7ff";
}

/** Soft base fill used while Acrylic is active (matches Lycia density). */
export function getAcrylicWindowTint(scheme?: ThemeScheme | null): string {
    return resolveThemeScheme(scheme) === "dark"
        ? ACRYLIC_TINT_DARK
        : ACRYLIC_TINT_LIGHT;
}

export function getInitialWindowSurfaceOptions(): {
    transparent: boolean;
    backgroundColor: string;
    backgroundMaterial: "none" | undefined;
} {
    if (supportsNativeAcrylic()) {
        // Do not combine Electron's transparent-window path with a DWM backdrop.
        // setBackgroundMaterial("acrylic") makes the web contents transparent
        // itself; transparent: true would additionally create a layered window.
        // That unsupported resizable-window combination flickers on Win11 24H2.
        return {
            transparent: false,
            backgroundColor: getOpaqueWindowBackground(),
            backgroundMaterial: "none",
        };
    }
    return {
        transparent: false,
        backgroundColor: getOpaqueWindowBackground(),
        backgroundMaterial: undefined,
    };
}
