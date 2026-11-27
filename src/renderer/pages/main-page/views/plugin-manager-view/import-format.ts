export const pluginImportKinds = ["auto", "v2", "lx"] as const satisfies readonly IPlugin.ImportKind[];

export function isLxPlugin(plugin: IPlugin.Manifest): boolean {
    const conversion = plugin.conversion;
    return Boolean(conversion && typeof conversion === "object" &&
        "format" in conversion && conversion.format === "lx-to-v2");
}

export function getPluginDisplayVersion(plugin: IPlugin.Manifest): string {
    const conversion = plugin.conversion;
    if (isLxPlugin(plugin) && conversion && typeof conversion === "object" &&
        "originalVersion" in conversion && typeof conversion.originalVersion === "string" &&
        conversion.originalVersion.trim()) {
        return conversion.originalVersion;
    }
    return plugin.version;
}

export function getPluginUpdateOptions(plugin: IPlugin.Manifest): IPlugin.ImportOptions {
    return { kind: isLxPlugin(plugin) ? "lx" : "auto" };
}

export function getSubscriptionUpdateOptions(
    plugins: IPlugin.Manifest[],
    url: string,
): IPlugin.ImportOptions {
    const matching = plugins.filter((plugin) => plugin.srcUrl?.trim() === url.trim());
    return { kind: matching.length && matching.every(isLxPlugin) ? "lx" : "auto" };
}
