# Video plugin

`video` makes short, repeatable MP4 demos from local HTML pages or URLs. Its `demo-video` skill drives a declarative shot list in headless Chrome, captures the page in real time, encodes H.264 with ffmpeg, and checks the result.

## Requirements

- Node.js 20 or later.
- Google Chrome or Chromium. Set `CHROME_PATH` to override discovery.
- ffmpeg and ffprobe with the `libx264` encoder. Set `FFMPEG_PATH` and `FFPROBE_PATH` to override discovery.

## Install

```text
claude plugin install video@ai-harness --scope project
```

This records the plugin in that project's `.claude/settings.json`.

## Commands

```text
node plugins/video/skills/demo-video/scripts/plan.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/render.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/render.mjs path/to/video.json --out path/to/demo.mp4 --keep-frames
node plugins/video/skills/demo-video/scripts/check.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/check.mjs path/to/video.json --file path/to/demo.mp4
node plugins/video/skills/demo-video/scripts/review.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/review.mjs path/to/video.json --file path/to/demo.mp4 --fps 15 --from 4 --to 6
```

`plan.mjs` validates without starting Chrome or ffmpeg and prints the resolved action timetable. `review.mjs` replaces `<base>.review/` with numbered 5x5 review sheets; `--fps` defaults to 4. It extracts frames with ffmpeg and uses headless Chrome to draw a timecode on every tile.

## `video.json`

Paths are relative to `video.json` unless stated otherwise.

| Key | Meaning and default |
| --- | --- |
| `page` | Required local page path or `http(s)` URL. |
| `out` | MP4 path; `out/video.mp4`. |
| `root` | Local server root; the page's directory. |
| `viewport` | `{ "width": 1920, "height": 1080 }`. |
| `fps` | Output frame rate; `30`. |
| `duration` | Required planned duration: seconds greater than zero, or `"auto"`. Auto ends after the last kept action plus `tail`. |
| `tail` | Seconds after the last kept action for `duration: "auto"`; `1.0`. Not allowed with numeric duration. |
| `cursor` | `{ "visible": true, "size": 32, "start": null }`; start is `[x,y]`. |
| `ready` | Optional JavaScript expression, polled until truthy for up to 10 seconds. |
| `timeline` | Ordered actions; `[]`. Actions may have a `label`, `group`, timing, and `skip: true`. |
| `skipGroups` | Group names to remove before timing; `[]`. Every name must be used by an action. |
| `mustShow` | `{ selector, min, label? }` visibility requirements; `[]`. |
| `checks` | Output checks described below; `{}`. |

### Actions

| `do` | Fields and defaults |
| --- | --- |
| `move` | `to` selector or `x` and `y`; `anchor: [0.5,0.5]`, `dur: 0.35`, `ease: "out"`. |
| `click` | Optional `to`, moving first with `anchor: [0.5,0.5]`, `dur: 0.35`, `ease: "out"`; otherwise clicks the current cursor with duration zero. |
| `scroll` | `to` selector or `x` and/or `y`; `in: null` (page), `offset: 0`, `dur: 0.6`, `ease: "inOut"`. The end is clamped to the scrollable range, so the easing slows into the real end. Scroll snapping is suspended during the scripted motion and then restored. |
| `key` | `key`: Escape, Enter, Tab, Space, arrows, PageUp, PageDown, Home, End, or one character. |
| `call` | Global `fn`, `args: []`. Promise results are awaited with a 5-second timeout. |
| `wait` | Optional `dur: 0`; holds the screen for that many seconds. |

Each action may set `at` to an absolute start in seconds or `wait` to seconds after the previous kept action ends. With neither, it starts when the previous kept action ends; the first starts at `wait ?? 0`. `at` and `wait` cannot be combined. `group` is an optional non-empty string. `skip: true` removes one action, while top-level `skipGroups` removes every action in the named groups before timing. Later relative actions move up while later absolute `at` values do not. After validation, all kept actions have a resolved numeric `at`.

Planned action length is `dur` for moves and scrolls, `dur` for clicks with `to`, and optional `dur` for waits. Keys, calls, and clicks at the current cursor have zero planned length. Easing is `linear`, `in`, `out`, or `inOut`. Resolved actions must be sorted, cannot overlap, and must end within the resolved duration. With `duration: "auto"`, an empty timeline resolves to `tail`, which must leave a duration greater than zero.

### Checks

| Level | Checks |
| --- | --- |
| FAIL | Missing/unreadable file; codec, pixel format, size, frame rate or duration mismatch; `maxBytes`; `moov` after `mdat`; black segment at least `blackMax` (`0.5`, `null` disables); unmet `mustShow`; failed action. |
| WARN | Audio unless `audio: "allowed"` (`"none"`); static share above `maxStaticShare` (`0.85`); motion-window capture gap above 0.2 s; motion frame rate below 20 fps; action over 0.15 s late; console errors; missing render report. |
| NEEDS HUMAN | Legibility, pacing, privacy, silent comprehensibility, plus every string in `human` (`[]`). |

`checks.duration` defaults to planned duration ±0.25 s. `maxBytes` has no default.

## Output

Rendering first deletes the previous run's MP4, reports, contact sheet and frames, so a run that fails before encoding cannot leave a stale video for check.mjs to pass. It then writes the MP4 and `<base>.render.json`. Checking writes `<base>.check.json`, `<base>.contact.png`, and up to five PNGs in `<base>.frames/`. Contact-sheet tiles run left to right, top to bottom; their times are printed and stored in the check report. Review sheets are numbered `<base>.review/sheet_01.png`, `sheet_02.png`, and so on, and Chrome always draws their timecodes.

Capture follows the page in real time. ffmpeg re-times the captured frames to the requested constant frame rate. `capture.maxGap` and `capture.motionFps` cover only the middle 80% of each move, moving click, and scroll (by its planned `dur`), where the screencast is expected to produce frames; still holds and the eased ends, which move less than a pixel per frame, are excluded. `capture.windows` contains `{ index, do, from, to, frames, fps, maxGap }` for each of those windows.

Examples: `examples/basic/video.json` (6 s, the fixed task in docs/measurements.md), `examples/basic/video-20s.json` (20 s, two clicks, two keys, two scrolls), and `examples/basic/video-relative.json` (`wait`, `skip`, and automatic duration).

## Limits

- The output has no audio track.
- Contact-sheet labels require an ffmpeg build with the `drawtext` filter; `review.mjs` sheets are always labeled because Chrome draws them.
- Native Windows, WSL, and Ubuntu have not been run yet.
- Only the page viewport is captured; the cursor is a drawn page overlay rather than the operating-system cursor.
