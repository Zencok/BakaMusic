import type { Configuration } from "webpack";
import path from "path";

import { baseRules } from "./webpack.rules";

export const mainConfig: Configuration = {
    /**
     * This is the main entry point for your application, it's the first file
     * that runs in the main process.
     */
    entry: {
        index: "./src/main/index.ts",
        plugin_host: "./src/shared/plugin-manager/utility/plugin-host.ts",
        node_runtime_host: "./src/shared/node-runtime/utility/node-runtime-host.ts",
    },
    // Put your normal webpack config below here
    module: {
        rules: [...baseRules],
    },
    resolve: {
        extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json", ".node"],
        alias: {
            "@": path.join(__dirname, "../src"),
            "@main": path.join(__dirname, "../src/main"),
            "@native": path.join(__dirname, "../src/main/native_modules"),
            "@shared": path.join(__dirname, "../src/shared"),
        },
    },
    output: {
        filename: "[name].js",
    },
    externals: {
        sharp: "commonjs2 sharp",
        "get-windows": "commonjs2 get-windows",
    },
};
