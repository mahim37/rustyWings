# web

The browser frontend. Vite, TypeScript, no framework.

```bash
pnpm install
pnpm build:wasm   # wasm-pack → src/wasm/ (gitignored); rerun after Rust changes
pnpm dev
pnpm check        # tsc
pnpm test         # vitest; loads the wasm in Node and checks the golden checksum
pnpm build        # build:wasm + check + vite build → dist/
```

```
src/main.ts            bootstrap
src/app.ts             wiring: worker client, renderer, charts, inspector, keys, URL
src/sim/worker.ts      the simulation thread: owns the wasm Sim, paces it, posts frames
src/sim/client.ts      typed handle on the worker
src/sim/protocol.ts    message contract; frame layout constants mirror frame.rs
src/sim/types.ts       TS mirrors of the Rust types (serde field names)
src/sim/config.ts      config clone / diff / merge
src/render/renderer.ts WebGL2: five instanced passes
src/render/sprites.ts  illustrated birds drawn into a texture atlas
src/render/camera.ts   centre + zoom on the torus
src/ui/charts.ts       SVG line charts with linked crosshair and table view
src/ui/history.ts      sampled stats, windowed and bucket-averaged
src/ui/inspector.ts    "Meet a bird"
src/ui/settings.ts     the four sliders → config
src/url.ts             ?seed=&cfg= share links
scripts/vercel-*.sh    Vercel install/build (installs rustup + wasm-pack)
```

The deploy is configured by `vercel.json` at the repository root; the Vercel
project's root directory must be the repository root.
