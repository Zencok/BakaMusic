import { ipcRenderer } from "electron";
import exposeInMainWorld from "@/preload/expose-in-main-world";
import type { IVideoProxySession, IVideoProxySource } from "./common";

async function register(source: IVideoProxySource): Promise<IVideoProxySession> {
    return ipcRenderer.invoke("@shared/video-proxy/register", source) as Promise<IVideoProxySession>;
}

async function release(id: string) {
    await ipcRenderer.invoke("@shared/video-proxy/release", id);
}

export const mod = { register, release };

exposeInMainWorld("@shared/video-proxy", mod);
