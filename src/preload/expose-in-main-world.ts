import { contextBridge } from "electron";

export default function exposeInMainWorld<T>(key: string, api: T) {
    if (process.contextIsolated) {
        contextBridge.exposeInMainWorld(key, api);
        return;
    }

    (globalThis as typeof globalThis & Record<string, unknown>)[key] = api;
}
