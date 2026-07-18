import * as pako from "pako";
import type { InflateOptions } from "pako";

type InflateInput = Parameters<typeof pako.inflate>[0];
type PluginInflateOptions = InflateOptions & {
    /** pako 2 option retained by existing MusicFree/BakaMusic plugins. */
    to?: "string";
    /** pako 3 native text-output option. */
    toText?: boolean;
};

export function inflateForPlugin(
    input: InflateInput,
    options: PluginInflateOptions = {},
): Uint8Array | string {
    const { to, ...modernOptions } = options;
    return pako.inflate(input, {
        ...modernOptions,
        toText: modernOptions.toText === true || to === "string",
    });
}

const pakoForPlugins = {
    ...pako,
    inflate: inflateForPlugin,
    ungzip: inflateForPlugin,
};

// Several compiled plugins read the CommonJS interop default explicitly.
Object.defineProperty(pakoForPlugins, "default", {
    configurable: false,
    enumerable: false,
    value: pakoForPlugins,
});

export default pakoForPlugins;
