import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import { ServiceName } from "@shared/service-manager/common";

const serviceHostMap = new Map<ServiceName, string>();

ipcRenderer.on("@shared/service-manager/host-changed", (_evt, serviceName: ServiceName, host: string | null) => {
    if (host) {
        serviceHostMap.set(serviceName, host);
    } else {
        serviceHostMap.delete(serviceName);
    }
});



async function setup() {
    const hosts = (await ipcRenderer.invoke("@shared/service-manager/get-service-hosts")) || {};
    const serviceNames = Object.keys(hosts);
    for (const serviceName of serviceNames) {
        serviceHostMap.set(serviceName as any, hosts[serviceName]);
    }
}

function getServiceHost(serviceName: ServiceName) {
    return serviceHostMap.get(serviceName);
}

async function registerMflacStream(src: string, ekey: string, headers?: Record<string, string>): Promise<string | null> {
    return ipcRenderer.invoke("@shared/service-manager/mflac-proxy/register-stream", src, ekey, headers);
}

const mod = {
    setup,
    getServiceHost,
    registerMflacStream,
};

exposeInMainWorld("@shared/service-manager", mod);

