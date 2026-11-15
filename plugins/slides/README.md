# Slides plugin

`slides` creates and reviews one-message-per-screen HTML slide pages. Its `html-slides` skill provides a content-free static starter, repeatable headless-Chrome checks at multiple viewports, per-slide screenshots, and labelled contact sheets.

## Requirements

- Node.js 20 or later.
- Google Chrome or Chromium. Set `CHROME_PATH` to override discovery.
- Chrome 119 or later for Japanese `word-break: auto-phrase` wrapping.

## Install

```text
claude plugin install slides@ai-harness --scope project
```

## Commands

```text
node plugins/slides/skills/html-slides/scripts/new.mjs path/to/deck
node plugins/slides/skills/html-slides/scripts/check.mjs path/to/deck/index.html
node plugins/slides/skills/html-slides/scripts/check.mjs path/to/deck/index.html --widths 1920x1080,1280x800,400x860 --slides "section.slide" --report out/check.json
node plugins/slides/skills/html-slides/scripts/check.mjs path/to/deck/index.html --baseline out/before.json --dup-min 12
node plugins/slides/skills/html-slides/scripts/shots.mjs path/to/deck/index.html
node plugins/slides/skills/html-slides/scripts/shots.mjs path/to/deck/index.html --widths 1920x1080,400x860 --slides "section.slide" --out slides-shots
```

`new.mjs` copies `index.html`, `style.css`, and `app.js` into the target directory. It creates a missing directory, but exits 1 without changing anything if any destination file already exists.

Both browser commands accept a local HTML file or an HTTP(S) URL. Local files are served from their containing folder. They wait for page load and fonts; if the page defines `window.__slidesReady`, it must become `true` within 10 seconds.

## Check options

| Option | Default | Meaning |
| --- | --- | --- |
| `--widths` | `1920x1080,1280x800,400x860` | Comma-separated viewport sizes. |
| `--slides` | `section.slide` | Selector used to find slides. |
| `--report` | none | Write the JSON report described below. |
| `--baseline` | none | Read an earlier report and print before → after character counts and differences. |
| `--dup-min` | `12` | Minimum non-whitespace characters in a repeated direct-text block. |

The first width produces a table of non-whitespace character counts per slide and in total. Duplicate blocks found on different slides are printed once with their slide IDs. Every run ends with the human-review list.

## Checks

| Level | Checks |
| --- | --- |
| FAIL | Readiness timeout; console error; uncaught page error; failed request; HTTP status 400 or above; image with `naturalWidth` 0; horizontal page overflow; no matching slide. Any FAIL makes the command exit 1. |
| WARN | A direct text-node rectangle extends horizontally beyond its element's padding box by more than 1 px; text is clipped by `hidden`, `clip`, or `auto` overflow. Inspect every warning. |
| information | Character counts, baseline differences, and duplicate text blocks. Duplicates do not produce WARN. |
| NEEDS HUMAN | One message per slide; clear hierarchy; no template filler; intentional phone layout. |

Chrome's automatic `/favicon.ico` request is ignored only when the page declares no `<link rel~="icon">`. A declared icon that fails to load remains a FAIL. Text-overflow and clipping checks skip text with a computed color alpha of zero, text under an element with zero opacity, and text whose visibility is hidden.

`--report` writes `{ widths, slides: [{ id, chars }], total, duplicates, fail, warn }` as JSON. A baseline is another report in this format.

## Screenshots and sheets

`shots.mjs` accepts the same `--widths` and `--slides` options plus `--out` (default `slides-shots`). For each viewport it writes every slide to:

```text
<out>/<width>/<nn>-<id>.png
```

Slides taller than the viewport are captured in full. Chrome then draws one labelled contact sheet per viewport at `<out>/sheet-<width>.png`; the command prints those sheet paths. Read every sheet before accepting the design.

## Limits

- Chrome 119 or later is required for phrase-aware Japanese wrapping. Narrow columns can still break inside a phrase.
- Browser checks catch mechanical failures and likely clipping, not message quality or visual hierarchy.
- Native Windows, WSL2, and Ubuntu have not been run yet.
- For a self-contained HTML deliverable or an MP4 demo, use the video plugin's `pack.mjs` or `demo-video` skill.
