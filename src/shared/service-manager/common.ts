export enum ServiceName {
    RequestForwarder = "request-forwarder",
    MflacProxy = "mflac-proxy",
    LunaProxy = "luna-proxy",
}

type ManagedMediaProxyServiceName = ServiceName.MflacProxy | ServiceName.LunaProxy;

const managedMediaProxyRoutes: ReadonlyArray<[
    ManagedMediaProxyServiceName,
    RegExp,
]> = [
    [ServiceName.MflacProxy, /^\/m\/[a-f0-9]{32}(?:\.[a-z0-9]{1,16})?$/],
    [ServiceName.LunaProxy, /^\/l\/[a-f0-9]{32}(?:\.[a-z0-9]{1,16})?$/],
];

export function getManagedMediaProxyServiceName(value: string) {
    let mediaUrl: URL;
    try {
        mediaUrl = new URL(value);
    } catch {
        return null;
    }
    if (
        mediaUrl.protocol !== "http:"
        || mediaUrl.hostname !== "127.0.0.1"
        || mediaUrl.username
        || mediaUrl.password
        || mediaUrl.search
        || mediaUrl.hash
    ) {
        return null;
    }
    return managedMediaProxyRoutes.find(([, route]) => route.test(mediaUrl.pathname))?.[0]
        ?? null;
}

export function resolveManagedMediaProxyUrl(
    value: string,
    hosts: Partial<Record<ServiceName, string | null>>,
) {
    const serviceName = getManagedMediaProxyServiceName(value);
    const serviceHost = serviceName ? hosts[serviceName] : null;
    if (!serviceName || !serviceHost) {
        return null;
    }
    try {
        const mediaUrl = new URL(value);
        const hostUrl = new URL(serviceHost);
        return mediaUrl.origin === hostUrl.origin ? mediaUrl.toString() : null;
    } catch {
        return null;
    }
}
