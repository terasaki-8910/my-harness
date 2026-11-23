# App UI plugin

`app-ui` supports making the UI of a phone app from a brief. Its `app-ui` skill takes a UI brief to a `DESIGN.md`, to prompts for Google Stitch (or Figma, or hand-written HTML), to checks of the exported screens at a phone viewport, and to a flow sheet the person approves. The scripts are `check.mjs` (headless-Chrome checks of every screen of a flow against the device and, when given, the `DESIGN.md`) and `shots.mjs` (per-screen screenshots, blank-frame detection and the flow sheet).

## Requirements

- Node.js 20 or later.
- Google Chrome or Chromium. Set `CHROME_PATH` to override discovery.
- No network for local screens: they are served from the flow.json folder over `http://127.0.0.1`. A screen that loads remote assets needs network, and the remote origins are listed under `origins`.

## Install

```text
claude plugin install app-ui@ai-harness --scope project
```

The scripts also work by path without installing the plugin.

## Files

- `skills/app-ui/SKILL.md`: rules and the loop for each round.
- `skills/app-ui/references/`: `brief.md` (how to decide each part of the brief, in order), `stitch.md` (working in Stitch: who sends the prompts, the first-prompt shape, edit prompts per finding, the prompt log, exporting), `audits.md` (which tool sees which layer: `check.mjs`, `designmd lint`, impeccable, unslop; turning findings into fixes), `html-in-canvas.md` (HTML-in-Canvas for the demo only).
- Pinned tools named by the references: `@google/design.md` 0.4.0 (`designmd lint`) and impeccable 4.10.0 (`detect` on a served URL). Raise a pin on purpose and record it here.
- `templates/`: `ui-brief.md.tmpl`, `DESIGN.md.tmpl`, `flow.json.tmpl`.
- `skills/app-ui/scripts/`: `check.mjs`, `shots.mjs` and `lib/`. `lib/chrome.mjs`, `cdp.mjs` and `server.mjs` are byte-for-byte copies of the video plugin's; `lib/png.mjs` and `frames.mjs` are copies of game3d's. A test keeps them identical, so edit the originals, never the copies.

## flow.json

```json
{
  "device": "ios",
  "designMd": "DESIGN.md",
  "screens": [
    { "id": "home", "file": "screens/home/code.html", "label": "1 Home", "tapText": "Reserve", "next": "detail" },
    { "id": "detail", "file": "screens/detail/code.html", "label": "2 Detail", "tap": ".btn-primary", "next": "done" },
    { "id": "done", "url": "https://example.org/done", "label": "3 Done" }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `device` | Optional. `ios` or `android`; the default for the run (`ios` when absent). |
| `designMd` | Optional path to the DESIGN.md the screens are compared with. |
| `screens` | At least one. Order is the order of the flow and of the sheet. |
| `id` | Unique, `/^[a-z0-9][a-z0-9-]*$/`. Used in file names. |
| `label` | Text shown above the tile on the sheet. |
| `file` or `url` | Exactly one. `file` is relative to the flow.json folder and must stay inside it; it is served over HTTP, never opened as `file://`. `url` is `http` or `https`. |
| `tap` or `tapText` | Optional, never both. The element the person taps next: a CSS selector, or the visible text (or `aria-label`) of an interactive element (an exact match wins; otherwise elements that contain the text). It must match exactly one visible element. |
| `next` | Optional id of an existing screen. An arrow is drawn on the sheet when it names the following screen. |

A missing or unreadable file, a duplicate id, an unknown `next`, both `tap` and `tapText`, a `file` outside the folder and invalid JSON are usage errors: exit 2 and one line naming the problem.

## Devices

| Device | Viewport | Scale factor | Minimum target | Safe area top / bottom |
| --- | --- | --- | --- | --- |
| `ios` | 390x844 | 3 | 44 | 59 / 34 |
| `android` | 412x915 | 2.625 | 48 | 24 / 24 |

`--device` beats the flow's `device`, which beats `ios`. `--size WxH` replaces width and height only. Each screen is opened with `Emulation.setDeviceMetricsOverride` (`mobile: true`) and touch emulation, so a page without a viewport meta is laid out at 980 px, as on a phone.

## Commands

```text
node skills/app-ui/scripts/check.mjs <flow.json> [--device ios|android] [--size WxH] [--min-text N] [--timeout s] [--only id,id] [--report file]
node skills/app-ui/scripts/shots.mjs <flow.json> [--device ios|android] [--size WxH] [--dpr N] [--out dir] [--full] [--timeout s]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--min-text N` | 11 | Smallest font size in px that does not warn. |
| `--timeout s` | 20 | Seconds a screen may take to become ready. |
| `--only a,b` | all | Check only these screen ids (`check.mjs`). |
| `--report file` | none | Write the JSON report (`check.mjs`). |
| `--dpr N` | 2 | Screenshot scale factor (`shots.mjs`). |
| `--out dir` | `app-shots` | Output folder (`shots.mjs`). |
| `--full` | off | Also save the whole page of each screen (`shots.mjs`). |

| Exit code | `check.mjs` | `shots.mjs` |
| --- | --- | --- |
| 0 | No FAIL (WARN allowed). | Every shot has content and no screen logged a page error. |
| 1 | At least one FAIL. | A blank shot or a page error; the files are still written and the errors listed. |
| 2 | Usage or setup error: bad flow.json, DESIGN.md that does not parse, Chrome not found or not starting. | The same. |
| 130 | Interrupted (Ctrl+C, SIGTERM): Chrome is closed and its profile removed. | The same. |

A screen is ready when the load event has fired, `document.fonts.ready` has resolved, `window.__appReady` (if the page defines it) is exactly `true`, no request has started or finished for 500 ms and two animation frames have passed, all within `--timeout`. Otherwise it is `FAIL load` and the run continues with the next screen.

## Checks

Output: `== <id> <label> (<W>x<H> <device>)`, then `FAIL <code>: <message>`, `WARN <code>: <message>` and `info <code>: <message>` lines, then `<n> FAIL, <m> WARN` and the NEEDS HUMAN list.

| Level | Code | Rule |
| --- | --- | --- |
| FAIL | `load` | The screen did not become ready in time, or navigation failed. |
| FAIL | `console` | `console.error` calls, uncaught exceptions and error entries of the browser log (for example a Content Security Policy violation). A failed load that the log also reports is counted once, under `request`. |
| FAIL | `request` | A failed request (not cancelled) or a response with status 400 or above. The automatic `/favicon.ico` request is ignored only when the page declares no `<link rel~="icon">`. |
| FAIL | `image` | An `img` that is complete with `naturalWidth` 0. |
| FAIL | `overflow` | The page scrolls sideways: scroll width above the layout viewport width plus 1 px. |
| FAIL | `viewport-meta` | No `<meta name="viewport">`, or none with `width=device-width`. |
| FAIL | `tap` | The flow's `tap` or `tapText` does not match exactly one visible element. |
| WARN | `target` | A visible interactive element, not disabled and not an inline link, with width or height below the device minimum. At most 20 lines per screen, then one `+N more` line (it counts as one WARN in the totals). |
| WARN | `text-size` | Font size below `--min-text`. |
| WARN | `contrast` | WCAG 2 ratio below 4.5:1, or 3:1 for large text (24 px, or 18.66 px at weight 700). The background is the element stack under the text composited over white; text over an image or gradient, or text that could not be sampled, goes to `info contrast-unknown`. Opacity is applied; text with zero alpha is skipped. |
| WARN | `fixed-cover` | A text or interactive element hidden under a fixed or sticky bar: under a top bar at scroll 0, under a bottom bar at the end of the page. |
| WARN | `safe-area` | An interactive element starting above the top safe area at scroll 0, or inside a fixed bottom bar and ending within the bottom safe area. |
| WARN | `primary` | Two or more filled, saturated buttons (background alpha 0.9 or more, HSL saturation 0.35 or more, lightness 0.15 to 0.85, at least 44x32) in the first screen. |
| WARN | `token-color` | With a DESIGN.md: a used colour (alpha above 0) whose RGB differs from every DESIGN.md colour by more than 3 in some channel. One line per colour. |
| WARN | `token-font` | With a DESIGN.md: a first font family that is not a typography `fontFamily` (case-insensitive) and not a Material icon font. |
| WARN | `token-size` | With a DESIGN.md: a font size more than 0.5 px from every typography size (icon fonts skipped). |
| WARN | `token-radius` | With a DESIGN.md: a radius more than 0.5 px from every `rounded` value, not 0 and not a full (pill) radius. |
| WARN | `placeholder` | Lorem ipsum, John or Jane Doe, "your name", example.com, Acme, and the Japanese fillers (ダミー, テキストテキスト, ここにテキスト, 〇〇 and similar); image sources with placeholder, placehold.co, via.placeholder.com, picsum.photos or dummyimage. |
| WARN | `emoji` | An emoji (Extended_Pictographic, ignoring U+00A9, U+00AE and U+2122) in heading or control text. |
| info | `origins` | Distinct origins requested other than the local server. |
| info | `contrast-unknown` | Count and up to 3 examples of texts that were not measured. |
| info | `colors`, `fonts`, `font-sizes`, `radii` | What the screen uses, with counts. |
| info | `cross-screen` | One line when screens differ in fonts or in the colours they use. |

A DESIGN.md category that is empty (for example no `typography`) switches off its token check.

NEEDS HUMAN, printed at the end of every run: the first screen says what the app is for; one dominant element per screen; each step's primary action is obvious and leads to the next screen; platform conventions are followed; the content is real; the brief's banned looks are absent; the twist is visible. No script judges these.

## Report format

`--report` writes:

```json
{
  "device": "ios", "width": 390, "height": 844,
  "flow": "/path/flow.json", "designMd": "/path/DESIGN.md",
  "screens": [
    { "id": "home", "label": "1 Home", "file": "screens/home/code.html",
      "fail": [{ "code": "image", "message": "..." }],
      "warn": [{ "code": "target", "message": "..." }],
      "info": { "origins": [], "contrastUnknown": { "count": 0, "examples": [] }, "colors": [{ "color": "#1f1f1f", "count": 12 }],
                "fonts": [{ "name": "Noto Sans JP", "count": 20 }], "fontSizes": [{ "px": 15, "count": 9 }], "radii": [{ "px": 12, "full": false, "count": 2 }] } }
  ],
  "fail": 1, "warn": 1, "crossScreen": null
}
```

`fail` and `warn` at the top are the totals over the listed screens; `crossScreen` is the cross-screen info line or `null`.

## Screenshots and the flow sheet

`shots.mjs` opens each screen like `check.mjs`. When the tap target lies below the first viewport it scrolls the page to centre it and records `scrollY`. It writes, in flow order:

```text
<out>/<nn>-<id>.png          the viewport at --dpr
<out>/<nn>-<id>-full.png     the whole page (--full)
<out>/sheet.png              the flow sheet
<out>/shots.json             { device, width, height, dpr, screens: [{ id, label, png, full, tap, scrollY, blank }] }
```

`shots.json` also carries `stats` (the blank-frame numbers) and `errors` for each screen. Each PNG is decoded and tested with the blank-frame check of game3d (white, black, uniform or flat), with the flat limit raised to 97 percent for app screens. The sheet shows the tiles in flow order, at most 5 per row, each with `label (id)` above it; the tap rect has a 2 px accent ring 2 px outside it; an arrow joins two tiles when `next` names the following screen (a flow that wraps to a second row says `next: <id>` under the last tile instead). Its header has the flow file name, the device, the size and the date. The page defines one grey scale and one accent as CSS custom properties and uses no other colour. Read the sheet before accepting a design.

## DESIGN.md subset

`lib/designmd.mjs` reads the YAML front matter between the first `---` line and the next one. It supports block mappings by indentation, `key: value` scalars, single- and double-quoted strings (`\"` and `\\` in double quotes), plain scalars, `#` comments (at the start of a line or after whitespace, outside quotes) and an empty value that starts a nested mapping. A sequence (`- `), a flow collection (`{...}` or `[...]`), an anchor, an alias, a tag, a `|` or `>` block, a tab in indentation, a duplicate key, or a `: ` inside a plain value throws an error naming the line. `{colors.primary}` references are resolved (at most 10 hops; a missing target is an error). The body's `##` headings are returned as `sections`. This is the subset the checks need, not a validator: `npx -y -p @google/design.md@0.4.0 designmd lint DESIGN.md` stays the check against the format.

## Not confirmed or not tested

- Stitch's export layout is not confirmed, and neither is whether its HTML loads the Tailwind CDN, Google Fonts or remote images. Point `file` at each screen's HTML; remote requests need network and are listed under `origins`.
- The `primary`, `safe-area` and `fixed-cover` rules are heuristics. `safe-area` and `fixed-cover` see only content that scrolls with the window: a screen built as a full-height container with its own inner scroll is measured as it is first drawn.
- `overflow` compares the scroll width with the layout viewport width (`clientWidth` of the scrolling element), not `window.innerWidth`: a mobile-emulated page wider than the screen is zoomed out and reports a larger `innerWidth`, which would hide the overflow. The zoom also shifts the other geometry readings on that screen (targets, bars, safe areas), so fix the overflow first and check again.
- `target` exempts an `a` element only when it is `display: inline` and its nearest block-level ancestor also holds text outside any link or button (a link inside a sentence). Links in a flex navigation bar are not exempt.
- "Visible" is the plain definition (a rectangle wider and taller than 0, `visibility: visible`, `display` not `none`, opacity above 0 up the tree). An element parked off-screen, such as a drawer at `translateX(-100%)` or a skip link at `-9999px`, therefore counts: it can raise `target` or `text-size`, and its text goes to `info contrast-unknown` because it cannot be sampled.
- The background behind a text is read from `document.elementsFromPoint` at the text's centre, after scrolling that point into the viewport. Text inside an inner scroll container, text outside the viewport horizontally, and text over an image or gradient are not measured and are counted under `info contrast-unknown`; an overlay that has `pointer-events: none` is not in the element stack and is ignored.
- The blank-frame check calls a screen "flat" when 97 percent of its samples sit within 2 luminance levels of one level (game3d uses 90 percent). Measured on 2026-11-23 (iOS, dpr 2): a finished sign-in screen 0.936 and a confirmation 0.934, which 90 percent would flag; a screen with only a 64 px top bar 0.925, which passes either way below 97 percent, so a screen that drew only its bar is not caught and has to be seen on the sheet; a lone spinner on white is caught as white (0.999).
- Only Windows 11 with Chrome 158 was run. The macOS and Linux paths are unrun; the Chrome discovery is the video plugin's.
