import type { IVideoProxySession, IVideoProxySource } from "./common";

interface IMod {
    register: (source: IVideoProxySource) => Promise<IVideoProxySession>;
    release: (id: string) => Promise<void>;
}

const bridge = window["@shared/video-proxy" as never] as unknown as IMod | undefined;

const videoProxy = {
    register: (source: IVideoProxySource) => bridge?.register(source)
        ?? Promise.reject(new Error("Video proxy bridge unavailable")),
    release: (id: string) => bridge?.release(id) ?? Promise.resolve(),
};

export default videoProxy;
