export interface DlnaDevice {
    id: string;
    name: string;
    address: string;
    volumeSupported: boolean;
}

export interface DlnaLoadRequest {
    deviceId: string;
    sourceId: string;
    url: string;
    title: string;
    artist: string;
    album: string;
    headers?: Record<string, string>;
    userAgent?: string;
}

export type DlnaCommand =
    | { operation: "load"; request: DlnaLoadRequest }
    | { operation: "play" | "pause" | "stop" | "status"; sourceId: string }
    | { operation: "seek" | "volume"; sourceId: string; value: number };

export interface DlnaSnapshot {
    state: string;
    currentTime: number;
    duration: number;
}

export interface DlnaBridge {
    discover(): Promise<DlnaDevice[]>;
    command(command: DlnaCommand): Promise<DlnaSnapshot | null>;
}

export function escapeXml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
    })[character] ?? character);
}

export function formatDlnaTime(seconds: number) {
    const total = Math.floor(Math.max(0, seconds));
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
        .map((part) => String(part).padStart(2, "0")).join(":");
}

export function parseDlnaTime(value: string) {
    const match = /^(\d{1,6}):([0-5]\d):([0-5]\d)(?:\.\d+)?$/.exec(value);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

export function isLanAddress(value: string) {
    const parts = value.split(".").map(Number);
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
        || parts.some((part) => part > 255)
        || parts.map(String).join(".") !== value) {
        return false;
    }
    return parts[0] === 10
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 169 && parts[1] === 254);
}

export function validateDeviceUrl(value: string, address: string, origin?: string) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== address
        || !isLanAddress(address) || url.username || url.password || url.hash
        || (origin && url.origin !== origin)) {
        throw new Error("DLNA device endpoint is not on the discovered LAN host");
    }
    return url;
}

export function buildMetadata(request: DlnaLoadRequest, url: string, mime: string) {
    return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"0\" restricted=\"1\"><dc:title>"
        + escapeXml(request.title) + "</dc:title><upnp:artist>" + escapeXml(request.artist)
        + "</upnp:artist><upnp:album>" + escapeXml(request.album)
        + "</upnp:album><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo=\"http-get:*:"
        + escapeXml(mime) + ":*\">" + escapeXml(url) + "</res></item></DIDL-Lite>";
}

export function audioMime(url: string) {
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
    return ({ mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
