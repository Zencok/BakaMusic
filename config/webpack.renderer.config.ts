import type { Configuration } from "webpack";
import path from "path";
import webpack from "webpack";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const postcssNestingModule = require("postcss-nesting");
const postcssNesting = postcssNestingModule.default ?? postcssNestingModule;

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

rules.push(
    {
        test: /\.module\.css$/,
        use: [
            { loader: "style-loader" },
            {
                loader: "css-loader",
                options: {
                    modules: {
                        localIdentName: "[name]__[local]--[hash:base64:5]",
                    },
                },
            },
            {
                loader: "postcss-loader",
                options: {
                    postcssOptions: {
                        plugins: [postcssNesting],
                    },
                },
            },
        ],
    },
    {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        use: [
            { loader: "style-loader" },
            { loader: "css-loader" },
            {
                loader: "postcss-loader",
                options: {
                    postcssOptions: {
                        plugins: [postcssNesting],
                    },
                },
            },
        ],
    },
    {
        test: /\.scss$/,
        use: [
            { loader: "style-loader" },
            { loader: "css-loader" },
            { loader: "sass-loader" },
        ],
    },
    {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: "asset/resource",
    },
    {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: "asset/resource",
    },
    {
        test: /\.svg$/,
        use: [
            {
                loader: "@svgr/webpack",
                options: {
                    prettier: false,
                    svgo: false,
                    svgoConfig: {
                        plugins: [{ removeViewBox: false }],
                    },
                    titleProp: true,
                    ref: true,
                },
            },
        ],
    },
);

export const rendererConfig: Configuration = {
    devtool: process.env.NODE_ENV === "production"
        ? false
        : "inline-source-map",
    module: {
        rules,
    },
    plugins: [
        ...plugins,
        new webpack.DefinePlugin({
            "import.meta.env.DEV": JSON.stringify(process.env.NODE_ENV !== "production"),
        }),
    ],
    resolve: {
        extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".scss"],
        modules: [path.resolve(__dirname, "../node_modules"), "node_modules"],
        alias: {
            "@": path.join(__dirname, "../src"),
            "@renderer": path.join(__dirname, "../src/renderer"),
            "@renderer-lrc": path.join(__dirname, "../src/renderer-lrc"),
            "@shared": path.join(__dirname, "../src/shared"),
            "@amll-core": path.resolve(__dirname, "../vendor/applemusic-like-lyrics/packages/core/src"),
        },
    },
    externals: process.platform !== "darwin" ? ["fsevents"] : undefined,
};
