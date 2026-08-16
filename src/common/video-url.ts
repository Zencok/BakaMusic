/**
 * Kugou signs these MV paths for its HTTP CDN endpoint. The plugin can still
 * return an HTTPS URL, but the edge serves a certificate for a different host,
 * so libmpv and Node correctly reject the TLS handshake. Keep the established
 * endpoint normalization in one process-neutral helper so playback, probing,
 * fallback sources, and downloads all use the same working URL.
 */
export function normalizeVideoUpstreamUrl(value: string): string {
    try {
        const parsed = new URL(value);
        if (
            parsed.protocol === "https:"
            && /(?:^|\.)fsmvpc(?:\.tx)?\.kugou\.com$/i.test(parsed.hostname)
        ) {
            parsed.protocol = "http:";
        }
        return parsed.toString();
    } catch {
        return value;
    }
}
