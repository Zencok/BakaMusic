import type { PluginCapability, PluginHostDescriptor } from "../rpc";
import PluginMethods from "./plugin-methods";

export type PluginInvoker = (capability: PluginCapability, request: unknown) => Promise<unknown>;

/** One immutable inspected manifest, with application-owned routing metadata. */
export class Plugin {
    public readonly id: string;
    public readonly name: string;
    public readonly hash: string;
    public readonly manifest: IPlugin.Manifest;
    public readonly methods: PluginMethods;

    constructor(descriptor: PluginHostDescriptor, public readonly path: string, private readonly invoker: PluginInvoker,
        public readonly sourceUrl?: string) {
        this.manifest = JSON.parse(JSON.stringify(descriptor.manifest)) as IPlugin.Manifest;
        Object.freeze(this.manifest.capabilities);
        Object.freeze(this.manifest);
        this.id = descriptor.id;
        this.hash = descriptor.id;
        this.name = this.manifest.name;
        this.methods = new PluginMethods(this);
    }

    get delegate(): IPlugin.IPluginDelegate {
        return JSON.parse(JSON.stringify({ ...this.manifest, id: this.id, platform: this.id, hash: this.id,
            path: this.path, ...(this.sourceUrl ? { srcUrl: this.sourceUrl } : {}) })) as IPlugin.IPluginDelegate;
    }

    invokeRaw(capability: PluginCapability, request: unknown) {
        if (!this.manifest.capabilities.includes(capability)) {
            return Promise.reject(new Error(`The plugin does not support ${capability}`));
        }
        return this.invoker(capability, request);
    }

    invoke<T extends PluginCapability>(capability: T, request: IPlugin.Requests[T]): Promise<IPlugin.Results[T]> {
        return this.methods.invoke(capability, request);
    }
}
