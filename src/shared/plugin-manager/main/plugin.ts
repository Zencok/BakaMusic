import { createHash } from "crypto";
import PluginMethods from "./plugin-methods";
import { replaceLxMusicQualities } from "../lx-adapter";
import {
    isReservedObjectKey,
    PluginExecutionEnvironment,
    PluginHostDescriptor,
    PluginMethodName,
} from "../rpc";

export enum PluginStateCode {
    VersionNotMatch = "VERSION NOT MATCH",
    CannotParse = "CANNOT PARSE",
}

type RemoteInvoker = (
    hash: string,
    method: PluginMethodName,
    args: unknown[],
    environment: PluginExecutionEnvironment,
) => Promise<unknown>;

type EnvironmentProvider = () => PluginExecutionEnvironment;

type MediaSourceOverride = (
    musicItem: IMusic.IMusicItemPartial,
    quality: IMusic.IQualityKey,
) => Promise<IPlugin.IMediaSourceResult | null>;

type MediaQualityOverride = () => IMusic.IQualityKey[] | null;

export class Plugin {
    public name: string;
    public hash: string;
    public stateCode?: PluginStateCode;
    public instance: IPlugin.IPluginInstance;
    public path: string;
    public methods: PluginMethods;
    public mediaSourceOverride?: MediaSourceOverride;
    public mediaQualityOverride?: MediaQualityOverride;

    constructor(
        source: (() => IPlugin.IPluginInstance) | PluginHostDescriptor,
        pluginPath: string,
        invokeRemote?: RemoteInvoker,
        getEnvironment?: EnvironmentProvider,
        mediaSourceOverride?: MediaSourceOverride,
        mediaQualityOverride?: MediaQualityOverride,
    ) {
        this.path = pluginPath;
        this.mediaSourceOverride = mediaSourceOverride;
        this.mediaQualityOverride = mediaQualityOverride;
        if (typeof source === "function") {
            try {
                this.instance = source();
            } catch {
                this.stateCode = PluginStateCode.CannotParse;
                this.instance = {
                    platform: "",
                    _path: pluginPath,
                };
            }
            this.hash = this.instance.platform
                ? createHash("sha256").update(source.toString()).digest("hex")
                : "";
        } else {
            if (!invokeRemote || !getEnvironment) {
                throw new Error("Remote plugin RPC is not configured");
            }
            this.hash = source.hash;
            this.instance = {
                ...(source.metadata as unknown as IPlugin.IPluginInstance),
                _path: pluginPath,
            };
            for (const method of source.supportedMethods) {
                (this.instance as unknown as Record<string, unknown>)[method] = (
                    ...args: unknown[]
                ) => invokeRemote(this.hash, method, args, getEnvironment());
            }
        }
        // utility host 可能被插件代码攻破，platform / 变量 key 在主进程侧必须复核：
        // 它们会被用作 pluginMeta 等普通对象的属性名，保留键会污染原型链。
        if (
            typeof this.instance.platform !== "string"
            || isReservedObjectKey(this.instance.platform)
        ) {
            this.instance.platform = "";
        }
        if (Array.isArray(this.instance.userVariables)) {
            this.instance.userVariables = this.instance.userVariables.filter((item) =>
                item?.key
                && typeof item.key === "string"
                && !isReservedObjectKey(item.key),
            );
        }
        this.name = this.instance.platform ?? "";
        this.methods = new PluginMethods(this);
    }

    applyMediaQualityOverride<T extends IMusic.IMusicItemPartial>(musicItem: T) {
        const qualities = this.mediaQualityOverride?.();
        return qualities ? replaceLxMusicQualities(musicItem, qualities) : musicItem;
    }
}
