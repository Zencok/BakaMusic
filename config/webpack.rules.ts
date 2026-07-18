import type { ModuleOptions } from "webpack";

export const nativeRules: Required<ModuleOptions>["rules"] = [
    // Add support for native node modules
    {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
        test: /native_modules[/\\].+\.node$/,
        use: "node-loader",
    },
    {
        test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
        parser: { amd: false },
        use: {
            loader: "@vercel/webpack-asset-relocator-loader",
            options: {
                outputAssetBase: "native_modules",
            },
        },
    },
];

export const sourceRules: Required<ModuleOptions>["rules"] = [
    {
        test: /\.tsx?$/,
        include: /src[\\/]amll-core[\\/].+$/,
        use: {
            loader: "babel-loader",
            options: {
                presets: [
                    "@babel/preset-react",
                    "@babel/preset-typescript",
                ],
            },
        },
    },
    {
        test: /\.tsx?$/,
        exclude: /(node_modules|\.webpack|src[\\/]amll-core)/,
        use: {
            loader: "ts-loader",
            options: {
                transpileOnly: true,
                compilerOptions: {
                    module: "esnext",
                    outDir: undefined,
                },
            },
        },
    },
    {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
            loader: "babel-loader",
            options: {
                presets: ["@babel/preset-react"],
            },
        },
    },
];

export const baseRules: Required<ModuleOptions>["rules"] = [
    ...nativeRules,
    ...sourceRules,
];
