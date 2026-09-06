//! # rustywings-wasm
//!
//! The browser's view of [`rustywings_core`]. One `Sim` wraps one `World`;
//! the frontend keeps it on a Web Worker and talks to it through the methods
//! below. Nothing here simulates anything: it converts JavaScript values at
//! the boundary, packs render frames and hands back numbers.
//!
//! Conventions at the boundary:
//!
//! * Seeds cross as hex strings (`"7f3a2c11"`, optional `0x`), never as
//!   `BigInt`; ids and ticks cross as `f64`, which is exact below 2^53.
//! * Configuration crosses as a plain object matching [`rustywings_core::Config`]
//!   and unknown or invalid fields come back as a thrown `Error` whose message
//!   names the dotted path.
//! * Render state crosses as one `Float32Array`, see [`frame`].

#![forbid(unsafe_code)]
#![warn(missing_docs, clippy::all)]

pub mod frame;

/// Parse a seed the way the UI writes it: hex digits, optional `0x` prefix,
/// surrounding whitespace ignored.
pub fn parse_seed(text: &str) -> Result<u64, String> {
    let t = text.trim();
    let t = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    if t.is_empty() {
        return Err("seed is empty".into());
    }
    u64::from_str_radix(t, 16).map_err(|_| format!("seed {text:?} is not hexadecimal"))
}

/// Format a seed for display and URLs: lowercase hex, no prefix.
pub fn format_seed(seed: u64) -> String {
    format!("{seed:x}")
}

#[cfg(target_arch = "wasm32")]
mod bindings {
    use js_sys::Float32Array;
    use rustywings_core::{AgentView, Config, Species, Stats, World};
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    use crate::frame;

    fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
        let s = serde_wasm_bindgen::Serializer::json_compatible();
        v.serialize(&s).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Config arrives as JSON text, not as an object: `serde_wasm_bindgen`
    /// silently drops unknown keys, and a typo in a shared link should be an
    /// error, not a default. `serde_json` honours `deny_unknown_fields`.
    fn config_from_json(text: Option<String>) -> Result<Config, JsError> {
        match text {
            None => Ok(Config::default()),
            Some(t) => serde_json::from_str(&t).map_err(|e| JsError::new(&format!("config: {e}"))),
        }
    }

    /// Everything the inspector shows about one bird.
    #[derive(Serialize)]
    struct Inspection<'a> {
        #[serde(flatten)]
        view: AgentView,
        weights: &'a [f32],
        retina: &'a [f32],
    }

    /// Brain shape, so the inspector can lay out the weight heatmap.
    #[derive(Serialize)]
    struct Shape {
        inputs: usize,
        hidden: usize,
        outputs: usize,
        retina_cells: usize,
        channels: usize,
    }

    /// One world, as seen from JavaScript.
    #[wasm_bindgen]
    pub struct Sim {
        world: World,
        frame: Vec<f32>,
    }

    #[wasm_bindgen]
    impl Sim {
        /// Build a world from a hex seed and an optional config as JSON
        /// text. Throws on an invalid seed, unknown fields or out-of-range
        /// values; the message names the offending dotted path.
        #[wasm_bindgen(constructor)]
        pub fn new(seed: &str, config_json: Option<String>) -> Result<Sim, JsError> {
            console_error_panic_hook::set_once();
            let seed = crate::parse_seed(seed).map_err(|e| JsError::new(&e))?;
            let config = config_from_json(config_json)?;
            let world = World::new(config, seed).map_err(|e| JsError::new(&e.to_string()))?;
            Ok(Sim {
                world,
                frame: Vec::new(),
            })
        }

        /// Rebuild a world from `snapshot()` output.
        pub fn restore(bytes: &[u8]) -> Result<Sim, JsError> {
            console_error_panic_hook::set_once();
            let world = World::from_snapshot(bytes).map_err(|e| JsError::new(&e.to_string()))?;
            Ok(Sim {
                world,
                frame: Vec::new(),
            })
        }

        /// The default configuration as a plain object.
        #[wasm_bindgen(js_name = defaultConfig)]
        pub fn default_config() -> Result<JsValue, JsError> {
            to_js(&Config::default())
        }

        /// Core crate version.
        pub fn version() -> String {
            rustywings_core::VERSION.to_string()
        }

        /// The configuration this world is running with.
        pub fn config(&self) -> Result<JsValue, JsError> {
            to_js(self.world.config())
        }

        /// Replace the configuration (JSON text). Throws, leaving the world
        /// untouched, if the new one is invalid or changes the brain shape.
        #[wasm_bindgen(js_name = setConfig)]
        pub fn set_config(&mut self, config_json: String) -> Result<(), JsError> {
            let config = config_from_json(Some(config_json))?;
            self.world
                .set_config(config)
                .map_err(|e| JsError::new(&e.to_string()))
        }

        /// Seed as lowercase hex.
        pub fn seed(&self) -> String {
            crate::format_seed(self.world.seed())
        }

        /// Ticks simulated so far.
        pub fn tick(&self) -> f64 {
            self.world.tick() as f64
        }

        /// Advance `n` ticks.
        pub fn step(&mut self, n: u32) {
            self.world.run(u64::from(n));
        }

        /// Living birds.
        #[wasm_bindgen(js_name = agentCount)]
        pub fn agent_count(&self) -> u32 {
            self.world.agents().len() as u32
        }

        /// Living seeds.
        #[wasm_bindgen(js_name = plantCount)]
        pub fn plant_count(&self) -> u32 {
            self.world.plants().len() as u32
        }

        /// Brain shape.
        pub fn shape(&self) -> Result<JsValue, JsError> {
            let t = self.world.topology();
            to_js(&Shape {
                inputs: t.inputs,
                hidden: t.hidden,
                outputs: t.outputs,
                retina_cells: self.world.config().brain.retina_cells as usize,
                channels: rustywings_core::CHANNELS,
            })
        }

        /// Aggregate numbers, see [`Stats`].
        pub fn stats(&self) -> Result<JsValue, JsError> {
            let s: Stats = self.world.stats();
            to_js(&s)
        }

        /// Order-sensitive digest of all state as 16 hex digits. Equal to
        /// what `rustywings verify` prints natively for the same seed and tick.
        pub fn checksum(&self) -> String {
            format!("{:016x}", self.world.checksum())
        }

        /// Row of the bird nearest `(x, y)` within `radius`, or `-1`.
        #[wasm_bindgen(js_name = agentAt)]
        pub fn agent_at(&self, x: f32, y: f32, radius: f32) -> i32 {
            self.world.agent_at(x, y, radius).map_or(-1, |i| i as i32)
        }

        /// Id of the bird in row `i`, or `-1` if the row is out of range.
        #[wasm_bindgen(js_name = idAt)]
        pub fn id_at(&self, i: u32) -> f64 {
            self.world
                .agents()
                .id
                .get(i as usize)
                .map_or(-1.0, |&id| id as f64)
        }

        /// Everything about the bird with `id`, or `undefined` if it is dead.
        pub fn inspect(&self, id: f64) -> Result<JsValue, JsError> {
            let agents = self.world.agents();
            let Some(i) = agents.index_of(id as u64) else {
                return Ok(JsValue::UNDEFINED);
            };
            to_js(&Inspection {
                view: agents.view(i),
                weights: &agents.genome[i].weights,
                retina: agents.retina_of(i),
            })
        }

        /// Remove every bird and seed within `radius` of `(x, y)`; returns
        /// birds removed.
        pub fn strike(&mut self, x: f32, y: f32, radius: f32) -> u32 {
            self.world.strike(x, y, radius)
        }

        /// Sprout up to `n` seeds; returns how many appeared.
        #[wasm_bindgen(js_name = scatterPlants)]
        pub fn scatter_plants(&mut self, n: u32) -> u32 {
            self.world.scatter_plants(n)
        }

        /// Add `n` birds of `species` (`0` sparrow, `1` hawk) with fresh
        /// random genomes; returns how many were added.
        pub fn spawn(&mut self, species: u8, n: u32) -> u32 {
            self.world.spawn_founders(Species::from_u8(species), n)
        }

        /// Pack the render frame for `selected_id` (`-1` for none) and return
        /// its length in floats. Follow with `copyFrame`.
        #[wasm_bindgen(js_name = packFrame)]
        pub fn pack_frame(&mut self, selected_id: f64) -> u32 {
            let selected = (selected_id >= 0.0).then_some(selected_id as u64);
            frame::pack(&self.world, selected, &mut self.frame);
            self.frame.len() as u32
        }

        /// Copy the packed frame into `out`, which must be at least
        /// `packFrame`'s return value long.
        #[wasm_bindgen(js_name = copyFrame)]
        pub fn copy_frame(&self, out: &Float32Array) {
            out.subarray(0, self.frame.len() as u32)
                .copy_from(&self.frame);
        }

        /// Serialise the world.
        pub fn snapshot(&self) -> Vec<u8> {
            self.world.to_snapshot()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_round_trip_through_hex() {
        for seed in [0u64, 1, 0x7f3a_2c11, u64::MAX] {
            assert_eq!(parse_seed(&format_seed(seed)).unwrap(), seed);
        }
        assert_eq!(parse_seed(" 0x1F ").unwrap(), 31);
        assert_eq!(parse_seed("0X1f").unwrap(), 31);
        assert!(parse_seed("").is_err());
        assert!(parse_seed("0x").is_err());
        assert!(parse_seed("zz").is_err());
        assert!(
            parse_seed("1234567890abcdef0").is_err(),
            "17 digits overflow"
        );
    }
}
