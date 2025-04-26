const path = require('path');
const CopyWebpackPlugin     = require('copy-webpack-plugin');

module.exports = {
    entry: "./bootstrap.js",

    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "bootstrap.js",
    },

    mode: "development",

    module: {
        rules: [
            {
                // tell Webpack how to handle your .wasm files
                test: /\.wasm$/i,
                type: "webassembly/async",
            },
        ],
    },

    experiments: {
        asyncWebAssembly: true,
    },

    resolve: {
        alias: {
            // point at the actual pkg folder
            'lib-simulation-wasm': path.resolve(
                __dirname,
                './pkg'
            )
        },
        extensions: ['.js', '.wasm', '.json'],
    },

    plugins: [

        new CopyWebpackPlugin({
            patterns: [
                // copy your HTML & CSS
                { from: 'index.html', to: './' },
                { from: 'index.css',  to: './' },
                {
                    from: path.resolve(
                        __dirname,
                        './pkg/lib_simulation_wasm_bg.wasm'
                    ),
                    to: './'
                },
            ]
        }),
    ],

    devServer: {
        static: path.join(__dirname, 'dist'),
        compress: true,
        port: 8080,
    },
};
