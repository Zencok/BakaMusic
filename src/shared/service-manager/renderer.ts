import { ServiceName } from "@shared/service-manager/common";

interface IMod {
    setup: () => Promise<void>;
    getServiceHost: (serviceName: ServiceName) => string | null;
    registerMflacStream: (src: string, ekey: string, headers?: Record<string, string>) => Promise<string | null>;
}

const mod = window["@shared/service-manager" as any] as unknown as IMod;


class RequestForwarderService {

    static forwardRequest(url: string, method?: string, headers?: Record<any, any>): string | null {
        const host = mod.getServiceHost(ServiceName.RequestForwarder);
        if (!host) {
            return null;
        }

        const fUrl = new URL(host);
        fUrl.searchParams.set("url", url);
        if (method) {
            fUrl.searchParams.set("method", method);
        }
        if (headers) {
            fUrl.searchParams.set("headers", JSON.stringify(headers));
        }
        return fUrl.toString();
    }
}

class MflacProxyService {
    static async registerStream(src: string, ekey: string, headers?: Record<string, string>): Promise<string | null> {
        return mod.registerMflacStream(src, ekey, headers);
    }
}


const ServiceManager = {
    setup: mod.setup,
    RequestForwarderService,
    MflacProxyService,
};

export default ServiceManager;
