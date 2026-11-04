/** Resolve a saved preference or system locale to an installed translation. */
export function resolveLanguage(
    preference: string | null | undefined,
    systemLocale: string,
    availableLanguages: readonly string[],
): string {
    if (preference && availableLanguages.includes(preference)) {
        return preference;
    }

    const locale = systemLocale.trim().split(/[.@]/)[0].replace(/_/g, "-").toLowerCase();
    const exactMatch = availableLanguages.find((language) => language.toLowerCase() === locale);
    if (exactMatch) {
        return exactMatch;
    }

    if (locale === "zh" || locale.startsWith("zh-")) {
        const parts = locale.split("-");
        const traditional = parts.includes("hant")
            || (!parts.includes("hans") && parts.some((part) => ["tw", "hk", "mo"].includes(part)));
        const chineseLanguage = traditional ? "zh-TW" : "zh-CN";
        if (availableLanguages.includes(chineseLanguage)) {
            return chineseLanguage;
        }
    }

    return availableLanguages.includes("en-US") ? "en-US" : availableLanguages[0];
}
