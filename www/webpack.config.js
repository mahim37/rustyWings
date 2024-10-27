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
        new CopyWebpackPlugin(['index.html', "index.css"]),
        new CopyWebpackPlugin([
            { from: '../pkg/lib_simulation_wasm_bg.wasm', to: './' }
        ])
    ],
    experiments: {
        asyncWebAssembly: true,
    },
    resolve: {
        alias: {
            'lib-simulation-wasm': path.resolve(__dirname, '../pkg')
        }
    }
};
