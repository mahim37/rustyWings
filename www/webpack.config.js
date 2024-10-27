const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require('path');

module.exports = {
    entry: "./bootstrap.js",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "bootstrap.js",
    },
    mode: "development",
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: "index.html" },
                { from: "index.css" }
            ]
        })
    ],
    devServer: {
        host: '0.0.0.0',
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
    },
    experiments: {
        asyncWebAssembly: true,
    },
};
