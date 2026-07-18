import { createHash } from "crypto";
import PluginMethods from "./plugin-methods";
import {
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

export class Plugin {
    public name: string;
    public hash: string;
    public stateCode?: PluginStateCode;
    public instance: IPlugin.IPluginInstance;
    public path: string;
    public methods: PluginMethods;

    constructor(
        source: (() => IPlugin.IPluginInstance) | PluginHostDescriptor,
        pluginPath: string,
        invokeRemote?: RemoteInvoker,
        getEnvironment?: EnvironmentProvider,
    ) {
        this.path = pluginPath;
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
        if (Array.isArray(this.instance.userVariables)) {
            this.instance.userVariables = this.instance.userVariables.filter((item) => item?.key);
        }
        this.name = this.instance.platform ?? "";
        this.methods = new PluginMethods(this);
    }
}
