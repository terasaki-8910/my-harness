# Blender to the game

## Scripts

- One script per part family (for example art/blender/walkway.py), runnable on its own with `blender.mjs`, which starts Blender with `--factory-startup` so user preferences and add-ons never leak in.
- Deterministic: fixed random seeds, no timestamps in names, the same output for the same input.
- Shared code (units, material builders, export settings, checks) in one module next to the scripts, imported through `sys.path` from the script's own folder.
- Pin the Blender version in the project (README and the brief). Operator and socket names change between versions; list the exporter's options on the installed version with `bpy.ops.export_scene.gltf.get_rna_type().properties.keys()` instead of trusting memory.

## Scale, axes, pivots

- 1 Blender unit = 1 m. Model to the game's grid.
- Origin at the part's grid pivot (the point the game places), transforms applied before export.
- Blender is Z-up and glTF is Y-up; let the exporter convert (`export_yup=True`), never rotate by hand.

## Detail

- Bevel every visible hard edge with the width from the brief; use weighted normals (or smoothing by angle) so bevels shade.
- Detail that changes the silhouette at play distance is geometry; smaller detail goes into the normal map.
- Break repetition: a few variants per family, plus per-instance variation in the engine (rotation, UV offset, colour tint).

## UVs and texel density

- Every textured mesh has UV0. Tiling surfaces use world-scale box or cube projection so texel density stays constant (the brief sets pixels per metre).
- A second set (UV1) only for baked maps: non-overlapping, with a margin of at least 4 px at the bake resolution.

## Materials and textures

- Export only what glTF carries: Principled BSDF fed by image textures for base colour, metallic-roughness (G roughness, B metallic), normal (OpenGL convention), occlusion (R) and emission. Procedural node trees do not export; bake them to images first.
- Colour spaces: base colour and emission sRGB, every data map Non-Color.
- Power-of-two sizes, 1K by default, 2K only for hero surfaces, the total within the budget.

## Baking

- Parts that move at runtime: bake AO and surface detail (and wear masks into base colour if wanted). Never bake directional light into them; after the part rotates, the light would be wrong.
- Static scenery may use lightmaps on UV1, baked with the same sun as the engine.

## Checks inside the build script

Fail the script (raise) when:
- props intersect each other or the architecture (BVH overlap test);
- a part that should stand on the floor floats more than 1 cm above it;
- a textured mesh has no UVs, or there are zero-area faces or non-manifold edges on closed parts.
Visual inspection does not find these reliably. One published Blender MCP build (a café interior, 2026-10) reported 45 intersections among 326 props that only a scripted check found.

## Traps seen in practice

- The glTF exporter may pack baked AO (on UV1) and roughness (on UV0) into one image. Check `occlusionTexture.index` and `occlusionTexture.texCoord` in the exported JSON, and that the engine reads AO from the intended UV set.
- Pixel values read from 8-bit images in bpy are sRGB-encoded, not linear; convert before doing maths on them.
- On a Windows checkout with `core.autocrlf`, patch scripts that search for multi-line LF strings find nothing and silently change nothing. Make every scripted edit assert that its pattern was found.

- Blender's normal recalculation can turn a flat sheet face-down; it then exports back-face culled and is invisible in the engine. Check the face direction of single-sided pieces after recalculating normals.
- A relative output path given to a script can resolve against the drive root inside Blender (a stray `C:rtifacts` appeared once). Resolve every output path to an absolute one from the script's own location.
- After changing a shared constant or helper, rebuild every GLB that uses it and byte-compare the results; a stale file is otherwise invisible until someone looks closely.
- Scripts that reach into another script's private helpers break when that file changes in a parallel branch. Promote shared helpers to a public module, or copy them.

## Textures that tile

- Bake a joint along the edge of a tileable texture (grout lines, panel seams), so every cell can be rotated by quarter turns. That breaks the visible repeat without seams.
- A generated stone-course texture with more than about 12 % block contrast reads as a checkerboard at distance; keep the contrast low and let the form carry the detail.

## Export and after

`bpy.ops.export_scene.gltf(filepath=..., export_format='GLB', export_apply=True, export_yup=True)` with the options checked as above. Then `glb-audit.mjs` against the budget, `asset-audit.mjs`, and the game's own fixed shots.

## Generated meshes (Tripo, Hunyuan3D and similar)

Import, scale to the grid, decimate or retopologise to the budget, check or redo the UVs, rebake textures without baked lighting, then export through the same audits. Record the generator, its version, the plan, the input and the date in the manifest (references/sourcing.md).
