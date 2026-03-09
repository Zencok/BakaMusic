import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const relocateLoader = require("@vercel/webpack-asset-relocator-loader");

export const plugins = [
    new ForkTsCheckerWebpackPlugin({
        logger: "webpack-infrastructure",
        issue: {
            exclude: [
                {
                    file: "**/applemusic-like-lyrics/**",
                },
            ],
        },
    }),
    {
        apply(compiler: any) {
            compiler.hooks.compilation.tap(
                "webpack-asset-relocator-loader",
                (compilation: any) => {
                    relocateLoader.initAssetCache(compilation, "native_modules");
                },
            );
        },
    },
];
