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

## Measuring frame time

- On a 60 Hz display with vsync, requestAnimationFrame intervals sit at 16.7 ms with a little jitter, so p95 reads 16.7-16.8 ms even for an idle page. A budget of "p95 <= 16.7 ms" can never pass reliably; use 17.5 ms for "holds 60 fps" and watch p99 and max for dropped frames (FOLD / CITY, 2026-11-23: 16.8 ms before and after the change).
- Always measure the untouched build the same way first; the difference is the cost of the change.
- Measure a one-off event (a transition, a level change, the first use of an effect) the first time it happens after the page has sat idle. Trigger it through the page's debug API while recording, and judge only that window. A looped benchmark after a long warm-up hides a stutter from code running for the first time.
  - Example, FOLD / CITY, 2026-11-23: the first fold after 15 s at rest had p95 33.3 ms, with about 25 frames of 33-67 ms in its first 1.2 s.
  - The second fold in the same session had p95 16.8 ms. The looped fold passed only after an 8-15 s warm-up.

## Light from an HDRI

- A clear evening HDRI lights the shade strongly blue. Light the scene from a filtered, greyer and warmer copy, and keep the original only as the visible background.
- A warm ground colour in the lower half of the environment lifts blue-black shaded faces, but limit it to shallow angles or it lights the undersides too.
- Check the light against the reference photo's lit-to-shade ratio on the main walkable surface (for example about 2:1 on sunlit paving). Ambient fill and haze flatten it quickly.

## Drawing many objects

- A decal a few millimetres above a floor can z-fight inside the post-processing chain's depth buffer. A larger `polygonOffsetUnits` is the dependable fix. Dark decals need more alpha than the arithmetic suggests.
- three.js `BatchedMesh` draws many instanced variants in one call, but only with `WEBGL_multi_draw`. Without it, every object becomes its own draw call; read the extension in the headed run.

## Haze and depth

- three.js distance fog fades by distance from the camera only. Seen from above, a 46 m pier below the walkway stays crisp all the way down; add a height term (fog that thickens below the walkway level) in the material or a fog pass (FOLD / CITY, 2026-11-23).

## Capture traps on Windows (FOLD / CITY, 2026-11-22)

- Chrome's ANGLE uses D3D11 by default on Windows. In headless Chrome with D3D11, a three.js + postprocessing game rendered completely white, or with black floors, whenever its render scale was not 1 (lower quality presets, or after adaptive resolution lowered the scale). Headless with `--use-angle=gl`, and headed Chrome with the default backend, rendered the same build correctly.
- So: capture with `shots.mjs` (GL by default on Windows), always record the renderer string, let the blank-frame check fail the run, and confirm any player-facing rendering bug with `shots.mjs --headed --backend default` before reporting it.
- A machine can have more than one GPU; the renderer string says which one Chrome used. Frame-time numbers only mean something for that GPU.
- A failed type check (`tsc`) stops the build before Vite writes, so the previous `dist` stays and the next shots silently show the old build. Check the build's exit code before capturing.
