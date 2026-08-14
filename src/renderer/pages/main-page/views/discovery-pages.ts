export function getDiscoveryMetaText(item: IMusic.IMusicSheetItem) {
    const value = item.artist ?? item.description ?? "";

    if (!value.includes("<") && !value.includes("&")) {
        return value;
    }

    const parsed = new DOMParser().parseFromString(value, "text/html");
    parsed.body.querySelectorAll("br").forEach((breakElement) => {
        breakElement.replaceWith(" ");
    });
    return parsed.body.textContent?.replace(/\s+/g, " ").trim() ?? value;
}
