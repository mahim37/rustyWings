import * as wasm from "./lib_simulation_wasm_bg.wasm";
export * from "./lib_simulation_wasm_bg.js";
import { __wbg_set_wasm } from "./lib_simulation_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
