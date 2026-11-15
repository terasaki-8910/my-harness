---
name: html-slides
description: Use when a deliverable is slides or a one-message-per-screen page built in HTML (assignment, talk, explainer).
---

# HTML slides

The scripts are in this skill's base directory. They need Node 20+ and Google Chrome or Chromium (`CHROME_PATH` overrides the search). Reference: plugins/slides/README.md in the ai-harness repository.

1. Turn the brief into a slide list with one message per slide. Mark text supplied by the user and keep it verbatim; propose shorter alternatives instead of silently applying them.
2. Run `node <base>/scripts/new.mjs <dir>` and write static HTML, or generate that HTML from data with a script. Do not render content in the browser: checks and audits must read the real text from the HTML.
3. Remove repeated text: callouts that repeat another slide, captions under every image when one credits line covers them, and previous/next labels that repeat slide titles. Save a check report before editing and compare character counts with `--baseline`.
4. Run `node <base>/scripts/check.mjs <page.html | URL>` and fix every FAIL; inspect every WARN. Run `node <base>/scripts/shots.mjs <page.html | URL>` and read every contact sheet. For a design audit, serve the folder and run `npx impeccable detect http://127.0.0.1:<port>/`; scanning the file directly misreads `calc()` padding.
5. For a single-file deliverable or a demo video, use the video plugin's `pack.mjs` or `demo-video` skill.

## Limits

- Phrase wrapping needs Chrome 119 or later.
- Narrow columns can still break inside a phrase.
