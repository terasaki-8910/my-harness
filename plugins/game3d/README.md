# game3d plugin

`game3d` supports making and reviewing 3D art for web games. Its `game3d` skill sets the rules and the loop: an approved art brief before any modelling, one representative area first, Blender work as rerunnable scripts, checks that run outside the model, and an independent review against reference images before a person decides. The scripts run headless Blender, audit GLB budgets and asset licences, capture fixed-camera screenshots with blank-frame detection, draw before/after sheets and probe frame times. The `art-reviewer` agent judges screenshots against the brief without seeing the maker's reasoning.

## Requirements

- Node.js 20 or later.
- Blender for `blender.mjs` (run with 4.4.3 on Windows 11). Set `BLENDER_BIN` to override discovery.
- Google Chrome or Chromium for `shots.mjs`, `sheet.mjs` and `perf.mjs`. Set `CHROME_PATH` to override discovery.

## Install

```text
claude plugin install game3d@ai-harness --scope project
```

The scripts also work by path without installing the plugin.

## Skill, references and agent

- `skills/game3d/SKILL.md`: rules, the loop for each change, commands.
- `skills/game3d/references/`: `art-brief.md` (how to write the brief), `pipeline.md` (Blender scripts, UVs, baking, export), `web.md` (three.js notes and capture traps), `sourcing.md` (CC0 libraries, generated meshes, the bake-off), `review.md` (the rubric).
- `agents/art-reviewer.md`: read-only reviewer. Give it the brief, the three reference images and a sheet; it returns PASS / FAIL / NEEDS HUMAN per criterion.
- `templates/`: `art-brief.md.tmpl` (copy to `docs/art-brief.md`), `asset-budget.json.tmpl` (for `glb-audit.mjs --budget`), `asset-manifest.json.tmpl` (for `asset-audit.mjs --manifest`).

## Commands

All scripts are in `skills/game3d/scripts/`. Each file starts with its full usage.

| Script | Purpose | Exit codes |
| --- | --- | --- |
| `blender.mjs --which` / `blender.mjs <script.py> [--timeout s] [--log f] [-- args]` | Find Blender; run a Python script with `--background --factory-startup`, streaming output. | 0 ok; 1 Blender failed or printed a traceback; 124 timeout (process tree killed); 2 not found or bad arguments |
| `glb-audit.mjs <file.glb>... [--budget b.json] [--json]` | Triangles (scene and unique), draw calls, materials, textures (size, bytes, slots), missing UVs, non-power-of-two images, against a budget. | 0 pass; 1 over budget; 2 unreadable file or budget |
| `asset-audit.mjs [dir] [--manifest path] [--json]` | Every file under the asset roots has a manifest entry with a source and an allowed licence; CC-BY needs attribution. | 0 pass; 1 FAIL; 2 manifest or roots unusable |
| `shots.mjs <url> --out dir [--size WxH] [--backend b] [--headed] [--dpr n] [--only ids] [--settle n] [--timeout s]` | Fixed-camera screenshots through the page contract below; blank-frame check per shot; `shots.json` and `sheet.png`. | 0 all shots have content, no page errors; 1 blank shot or page error; 2 setup problem |
| `frames.mjs <png or dir>... [--json] [--min-std 0.02] [--max-flat 0.98]` | Blank-frame check of existing PNGs: white, black or uniform. | 0 none blank; 1 a blank frame; 2 unreadable file |
| `sheet.mjs --before dir --after dir --out file.png [--title t]` | Before/after sheet paired by shot id. | 0 written; 2 missing or invalid shots.json |
| `perf.mjs <url> [--seconds s] [--warmup s] [--headed] [--backend b] [--p95 ms]` | requestAnimationFrame intervals: frames, p50, p95, p99, max, renderer. | 0 ok; 1 p95 over budget; 2 setup problem |

Backends: `auto` (GL on Windows, SwiftShader on Linux, default on macOS), `default` (no flags: what players get), `gl`, `d3d11`, `metal`, `swiftshader`. Every capture records the WebGL renderer string, so it is clear which GPU and backend drew the frame.

## Page contract for shots.mjs

```js
window.__shots = {
  ready(): boolean,                                   // assets loaded, shaders warmed
  list(): Array<string | { id: string, label?: string }> | Promise<that>,
  show(id: string): void | Promise<void>,             // fixed scene state for that shot, time frozen
};
```

The same build must give the same image for the same shot, whatever order the shots are shown in.

## Not confirmed or not tested

- Only Windows 11 was run for real (Blender 4.4.3, Chrome 158, two GPUs). The macOS and Linux paths are covered by unit tests with injected platforms only.
- `blender.mjs` has not been run with Blender 5.x.
- `glb-audit.mjs` was checked against synthetic GLBs and Blender 4.4 exports, not against the Khronos validator or files with Draco, meshopt, sparse accessors or texture slots beyond the five core ones.
- The headless D3D11 white-frame failure was seen with a three.js and postprocessing game; the test fixture page does not reproduce it. On Windows, Chrome is spawned with `windowsHide`, so a `--headed` window may stay hidden; captures still work.
- `perf.mjs` numbers depend on which GPU Chrome uses on machines with more than one; read the renderer line.
- The `art-reviewer` agent has not yet been compared with a person's judgement on a fixed set of shots.

## Lessons

- 2026-11-22, FOLD / CITY: headless Chrome with ANGLE D3D11 rendered the game all white, or with black floors, when its render scale was not 1, while headed Chrome rendered it correctly. Hence GL by default for captures on Windows, the renderer string in every report, blank-frame detection that fails the run, and a headed check before calling anything a player-facing bug.
