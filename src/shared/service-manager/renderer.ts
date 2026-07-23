import { ServiceName } from "@shared/service-manager/common";

interface IMod {
    setup: () => Promise<void>;
    getServiceHost: (serviceName: ServiceName) => string | null;
    registerMflacStream: (src: string, ekey: string, headers?: Record<string, string>) => Promise<string | null>;
    registerLunaStream: (src: string, cek: string, headers?: Record<string, string>) => Promise<string | null>;
}

const mod = window["@shared/service-manager" as any] as unknown as IMod;

class MflacProxyService {
    static async registerStream(src: string, ekey: string, headers?: Record<string, string>): Promise<string | null> {
        return mod.registerMflacStream(src, ekey, headers);
    }
}

class LunaProxyService {
    static async registerStream(src: string, cek: string, headers?: Record<string, string>): Promise<string | null> {
        return mod.registerLunaStream(src, cek, headers);
    }
}


const ServiceManager = {
    setup: mod.setup,
    MflacProxyService,
    LunaProxyService,
};

export default ServiceManager;
