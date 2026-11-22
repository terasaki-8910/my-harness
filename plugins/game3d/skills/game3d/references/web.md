# Web engine notes (three.js)

## Loading

- GLTFLoader for GLB. For KTX2/Basis textures add KTX2Loader with the transcoder files served by the app itself, not from a CDN at runtime.
- Colour management: `renderer.outputColorSpace = SRGBColorSpace`; GLTFLoader marks base colour and emissive textures as sRGB and the rest as linear. Canvas or hand-loaded textures must be set by hand.
- Baked AO from glTF `occlusionTexture` uses its `texCoord`; for UV1 check that the loaded texture's `channel` is 1.

## Light and look

- An HDRI through PMREMGenerator for ambient and reflections, plus a directional sun for shadows that matches the brief.
- Tone mapping in exactly one place (the renderer or the post-processing chain). Compare AgX, ACES and Neutral against the references. AgX can wash out bright skies.
- Ambient occlusion (SSAO or N8AO) is usually the cheapest single step from "boxes" to "grounded objects"; measure its cost.

## Many objects

- Identical parts as InstancedMesh or EXT_mesh_gpu_instancing; per-instance colour through `instanceColor`.
- Watch `renderer.info.render.calls` and `.triangles` in the fixed shots, and frame time with `perf.mjs --headed`.

## Capture traps on Windows (FOLD / CITY, 2026-11-22)

- Chrome's ANGLE uses D3D11 by default on Windows. In headless Chrome with D3D11, a three.js + postprocessing game rendered completely white, or with black floors, whenever its render scale was not 1 (lower quality presets, or after adaptive resolution lowered the scale). Headless with `--use-angle=gl`, and headed Chrome with the default backend, rendered the same build correctly.
- So: capture with `shots.mjs` (GL by default on Windows), always record the renderer string, let the blank-frame check fail the run, and confirm any player-facing rendering bug with `shots.mjs --headed --backend default` before reporting it.
- A machine can have more than one GPU; the renderer string says which one Chrome used. Frame-time numbers only mean something for that GPU.
