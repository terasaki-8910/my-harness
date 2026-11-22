---
name: game3d
description: Use when making or reviewing 3D art for a web game: art brief, Blender scripts to GLB, asset licences, fixed-camera shots, review against reference images.
---

# 3D game art

Scripts are in `<base>/scripts` (this skill's base directory). They need Node 20+; `blender.mjs` needs Blender (`BLENDER_BIN` overrides discovery); `shots.mjs`, `sheet.mjs` and `perf.mjs` need Chrome (`CHROME_PATH`). Read a file in `<base>/references/` when a step names it. Options and formats: plugins/game3d/README.md in the ai-harness repository.

## Rules

- No modelling before the person approves an art brief: three reference images and what to take from each, value structure, materials, light, camera, banned looks, budgets. Start from `<base>/../../templates/art-brief.md.tmpl`; references/art-brief.md says how to fill it.
- Build one representative area first. Extend to the rest only after the person approves that area in the game's own fixed shots.
- Every asset comes from a script or a recorded source. Blender work is one script per part family, rebuilt from scratch with `blender.mjs`; never hand-edit an exported GLB. Every file under the asset roots has a manifest entry (`asset-audit.mjs`, references/sourcing.md).
- Parts that move at runtime get baked AO and surface detail only, never baked directional light (references/pipeline.md).
- Judge in the target engine from fixed cameras, not from Blender renders. The page exposes `window.__shots` for `shots.mjs`.
- Before calling anything a player-facing rendering bug, reproduce it in a headed browser with the default GPU backend. Headless captures fail in ways players never see (references/web.md).

## Loop for each change

1. Spec: goal, files, acceptance commands, the shots to compare, the budget lines that apply.
2. Build: scripts, Blender, engine code.
3. Check: `glb-audit.mjs` against the project budget, `asset-audit.mjs`, the project's own tests, `shots.mjs` (exit 0 means no blank frame and no page error), `perf.mjs --headed` when a budget may move.
4. Review: `sheet.mjs` before/after, then the `art-reviewer` agent with the brief, the three references and the sheet (references/review.md). It must not see the builder's reasoning. Fix its FAILs; stop after 3 rounds and report what still fails.
5. Person: show the sheet and a preview only at the agreed gates (brief, first area, UI direction, release).
6. Write what went wrong, and the check that caught it, into this plugin's references/.

## Commands

```text
node <base>/scripts/blender.mjs --which
node <base>/scripts/blender.mjs art/blender/<part>.py -- --out public/assets/<part>.glb
node <base>/scripts/glb-audit.mjs public/assets/<part>.glb --budget docs/asset-budget.json
node <base>/scripts/asset-audit.mjs . --manifest docs/asset-manifest.json
node <base>/scripts/shots.mjs "http://localhost:4173/?shots=1" --out artifacts/shots/after
node <base>/scripts/sheet.mjs --before artifacts/shots/before --after artifacts/shots/after --out artifacts/shots/compare.png
node <base>/scripts/perf.mjs "http://localhost:4173/" --headed --seconds 20 --p95 17.5
```
