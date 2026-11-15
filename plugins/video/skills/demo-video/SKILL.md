---
name: demo-video
description: Use when a deliverable is a short MP4 that shows an HTML page or interactive work being operated (assignment demo, product walkthrough).
---
# Demo video from an HTML page

The scripts are in this skill's base directory. They need Node 20+, Google Chrome or Chromium (`CHROME_PATH` overrides the search), and ffmpeg and ffprobe with libx264 (`FFMPEG_PATH`, `FFPROBE_PATH`). Reference: plugins/video/README.md in the ai-harness repository.

1. Turn the brief into checks before building. From the assignment text (and transcript, if any) write `video.json`: `checks.duration` (for "about 20 s" use [18, 22]), viewport and fps, and a `mustShow` entry with minimum seconds for every element the brief says the viewer must see. Put what no script can judge into `checks.human`.
2. Prepare the page: a fixed 1920x1080 layout, no network requests, installed or local fonts, and a stable `id` on every element the shot list targets. Crop or mask personal data in screenshots before they go into the page.
3. Keep it brisk: cursor moves 0.25-0.4 s, a click's result on screen 1.2-2 s, one idea per 1.5-3 s. If a screen needs longer to read, cut words on the page instead of holding longer. Draft long, then trim: time actions with `wait` instead of `at`, set `duration` to "auto", and drop beats with `skip: true`; later beats move up by themselves. Print the plan with scripts/plan.mjs before rendering. Give a run of beats that may be cut together the same `group`, and cut it with `skipGroups`.
4. Render: `node <base>/scripts/render.mjs video.json`. It films the real page in headless Chrome with scripted mouse and key input, draws a cursor, and encodes an H.264 MP4.
5. Check: `node <base>/scripts/check.mjs video.json`. Fix every FAIL, at most 3 rounds for the same failure. Run `scripts/review.mjs` and read every sheet; use `--fps 15 --from a --to b` to look closely at a short range. Then look at `<out>.contact.png` (one image, tiles in time order) and at most five frames in `<out>.frames/`.
6. Report: ask core:verifier with the two commands and the contact sheet. Give the user the NEEDS HUMAN list that check.mjs prints.

Minimal video.json:

```json
{
  "page": "index.html",
  "out": "out/demo.mp4",
  "duration": 20,
  "timeline": [
    { "at": 1.0, "do": "move", "to": "#step-2" },
    { "at": 1.8, "do": "click" },
    { "at": 5.0, "do": "key", "key": "Escape" },
    { "at": 6.0, "do": "scroll", "to": "#insights", "dur": 1.0 }
  ],
  "mustShow": [{ "selector": "#map", "min": 3 }, { "selector": "#detail", "min": 1.5, "label": "click result" }],
  "checks": { "duration": [18, 22], "human": ["The goal is stated within the first 3 s"] }
}
```
