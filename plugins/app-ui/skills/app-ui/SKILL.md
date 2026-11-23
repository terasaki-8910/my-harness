---
name: app-ui
description: Use when deciding or reviewing a phone app's UI or prototype (Google Stitch, Figma or HTML): brief, DESIGN.md, Stitch prompts, phone-viewport checks, flow sheet.
---

# Phone app UI

Scripts are in `<base>/scripts` (this skill's base directory). They need Node 20+ and Google Chrome or Chromium (`CHROME_PATH` overrides the search). Read a file in `<base>/references/` when a step names it. Formats and options: plugins/app-ui/README.md in the ai-harness repository.

## Rules

- No screen is generated before the person approves a UI brief: who, scene, goal, a main flow of 3 to 5 screens with one primary action each, real content, 2 or 3 reference apps and what to take from each, direction, banned looks, a 20 to 30 s storyboard. Start from `<base>/../../templates/ui-brief.md.tmpl`; references/brief.md says how to decide each part. The idea, the twist and the direction are the person's: propose options, never fill them in silently.
- The approved direction becomes a DESIGN.md (`<base>/../../templates/DESIGN.md.tmpl`) before the first generation. Every screen is generated against it, and the checks compare the screens with it.
- When the person makes the UI in Stitch, the person sends or approves every prompt: one screen per prompt, one change per edit prompt, all recorded in a prompt log (references/stitch.md). Fixes go back to Stitch as prompts; do not hand-edit exported HTML unless the person moves the UI to code.
- Judge rendered screens at phone size, not the design canvas: `check.mjs`, an impeccable URL scan and the flow sheet from `shots.mjs` (references/audits.md).
- HTML-in-Canvas only for the demo, with a stated purpose, one effect and fallbacks (references/html-in-canvas.md).

## Loop for each round

1. Brief: write or update it with the person; they approve it.
2. DESIGN.md: fill the template from the brief. `designmd lint` reports no error and no contrast warning.
3. Prompts: draft the Stitch prompts for the flow (references/stitch.md). The person runs them and exports each screen's HTML into `screens/`.
4. Flow: write `flow.json` from `<base>/../../templates/flow.json.tmpl`: screen order, the element tapped on each screen, the next screen.
5. Check: `check.mjs` on the brief's device. Exit 0 means no FAIL; fix every WARN or write why it stays into the brief. Run the impeccable URL scan on each screen.
6. Look: `shots.mjs`, then read the sheet. Go through the NEEDS HUMAN list, and look for the two faults tests cannot see: a low-priority action drawn as the most prominent element, and controls left on screen with nothing to act on.
7. Fix: turn each finding into one edit prompt, then repeat from step 3. Stop after 3 rounds and report what still fails.
8. Person: show the sheet at the agreed gates (brief, first screens, final flow).
9. Demo: record the flow for 20 to 30 s with the video plugin's demo-video skill, or record Stitch's or Figma's own prototype. The person chooses.

## Commands

```text
node <base>/scripts/check.mjs path/to/flow.json
node <base>/scripts/check.mjs path/to/flow.json --device android --report out/check.json
node <base>/scripts/shots.mjs path/to/flow.json --out out/shots
npx -y -p @google/design.md@0.4.0 designmd lint path/to/DESIGN.md
npx -y impeccable@4.10.0 detect http://127.0.0.1:<port>/<screen path>
```
