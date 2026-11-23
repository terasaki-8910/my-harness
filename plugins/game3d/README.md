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
| `blender.mjs --which` / `blender.mjs <script.py> [--timeout s] [--log f] [-- args]` | Find Blender; run a Python script with `--background --factory-startup`, streaming output. The result follows Blender's own exit: a helper process the script leaves running does not hold the run (a WARN line says so). | 0 ok; 1 Blender failed or printed a traceback; 124 timeout (process tree killed); 2 not found or bad arguments |
| `glb-audit.mjs <file.glb>... [--budget b.json] [--json]` | Triangles (scene and unique), draw calls, materials, textures (size, bytes, slots), missing UVs, non-power-of-two images, against a budget. A texture whose file is missing or unreadable is a FAIL whatever the budget. | 0 pass; 1 over budget or missing image; 2 unreadable file or invalid budget |
| `asset-audit.mjs [dir] [--manifest path] [--json]` | Every file under the asset roots has a manifest entry with a source and an allowed licence; CC-BY needs attribution. Directory links and junctions are followed. | 0 pass; 1 FAIL; 2 manifest or roots unusable |
| `shots.mjs <url> --out dir [--size WxH] [--backend b] [--headed] [--dpr n] [--only ids] [--settle n] [--timeout s] [--ignore-url s]...` | Fixed-camera screenshots through the page contract below; blank-frame check per shot; `shots.json` and `sheet.png`. Page errors include console errors, exceptions, failed resource loads and HTTP status 400 and above (each listed with its URL and status in `shots.json`); `/favicon.ico` is ignored and `--ignore-url` (repeatable, a URL substring) ignores known optional assets. | 0 all shots have content, no page errors; 1 blank shot or page error; 2 setup problem |
| `frames.mjs <png or dir>... [--json] [--min-std 0.02] [--max-flat 0.98] [--max-mode 0.9]` | Blank-frame check of existing PNGs: white, black, uniform, or flat (at least `--max-mode` of the pixels within +-2 luminance levels of one level, so a whited-out frame with a small HUD box still fails). `shots.mjs` applies the same check with the defaults. | 0 none blank; 1 a blank frame; 2 unreadable file |
| `sheet.mjs --before dir --after dir --out file.png [--title t]` | Before/after sheet paired by shot id. | 0 written; 2 missing or invalid shots.json |
| `perf.mjs <url> [--seconds s] [--warmup s] [--headed] [--backend b] [--p95 ms] [--ignore-url s]... [--event js [--event-at s] [--event-window s]]` | requestAnimationFrame intervals: frames, p50, p95, p99, max, renderer. Page errors (as for `shots.mjs`) fail the run with or without `--p95`. `--event` runs JavaScript in the page once, inside the recording loop, `--event-at` seconds (default 0.5) into the recording, and adds an `event` block for the `--event-window` seconds (default 4) after it: frames, p50, p95, p99, max, frames over 34 ms, and the 5 slowest as `+seconds-after-the-event duration`. With `--event`, `--p95` judges that window (the verdict line says `event window p95`). `--event-at` plus `--event-window` must fit in `--seconds`, and neither is accepted without `--event`. | 0 ok; 1 p95 over budget, the event threw (`FAIL event threw: <message>`, no statistics) or page error; 2 setup problem (including a syntax error in `--event`) |

A run that is interrupted (Ctrl+C, SIGTERM, a closing console) closes its Chrome, removes its temporary profile and sheet folders and exits with code 130.

Backends: `auto` (GL on Windows, SwiftShader on Linux, default on macOS), `default` (no flags: what players get), `gl`, `d3d11`, `metal`, `swiftshader`. Every capture records the WebGL renderer string, so it is clear which GPU and backend drew the frame.

## Budget file for glb-audit.mjs

Either a flat object of limits, or `{ "default": {...}, "files": { "<basename>": {...} } }` where a per-file object overrides the default for the file with that basename (`hero.glb`, never a path). Limits: `maxFileBytes`, `maxTriangles`, `maxDrawCalls`, `maxMaterials`, `maxTextureSize`, `maxTextureBytes`, `requireUVs` (default true), `requirePowerOfTwo` (default false). The budget is strict and exits 2 with a message that names the problem when it has an unknown key anywhere (a typo such as `maxTris`), limit keys next to `default` or `files` (put them under `default`), or a `files` key that contains `/` or `\`. `templates/asset-budget.json.tmpl` is a valid starting point.

## Page contract for shots.mjs

```js
window.__shots = {
  ready(): boolean | Promise<boolean>,                // assets loaded, shaders warmed; must be exactly true
  list(): Array<string | { id: string, label?: string }> | Promise<that>,
  show(id: string): void | Promise<void>,             // fixed scene state for that shot, time frozen
};
```

`ready()` is polled until it returns (or resolves to) exactly `true`; any other value, including a truthy one and a Promise that resolves `false`, keeps waiting until `--timeout` (exit 2). The same build must give the same image for the same shot, whatever order the shots are shown in.

## Not confirmed or not tested

- Only Windows 11 was run for real (Blender 4.4.3, Chrome 158, two GPUs). The macOS and Linux paths are covered by unit tests with injected platforms only.
- `blender.mjs` has not been run with Blender 5.x.
- `glb-audit.mjs` was checked against synthetic GLBs and Blender 4.4 exports, not against the Khronos validator or files with Draco, meshopt, sparse accessors or texture slots beyond the five core ones.
- The headless D3D11 white-frame failure was seen with a three.js and postprocessing game; the test fixture page does not reproduce it. On Windows, Chrome is spawned with `windowsHide`, so a `--headed` window may stay hidden; captures still work.
- Blank-frame checks use whole-frame statistics, so a partial failure cannot be seen by them: for example black floors under a good sky (a headless D3D11 capture with black floors passed `frames.mjs`). Judge such captures on the review sheet or cross-check with a headed run.
- `perf.mjs` numbers depend on which GPU Chrome uses on machines with more than one; read the renderer line.
- The `art-reviewer` agent has not yet been compared with a person's judgement on a fixed set of shots.
- Text contrast measured from element boxes includes borders and empty space and reports false failures; measure from the text node's own rects clipped to its element.
- In Git Bash on Windows, a long heredoc containing apostrophes or backticks passed through a tool's shell wrapper broke ("unexpected EOF"); write long inputs to a file and redirect it instead.

## Lessons

- 2026-11-22, FOLD / CITY: headless Chrome with ANGLE D3D11 rendered the game all white, or with black floors, when its render scale was not 1, while headed Chrome rendered it correctly. Hence GL by default for captures on Windows, the renderer string in every report, blank-frame detection that fails the run, and a headed check before calling anything a player-facing bug.
