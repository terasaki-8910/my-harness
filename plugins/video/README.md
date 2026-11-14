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
node plugins/video/skills/demo-video/scripts/render.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/render.mjs path/to/video.json --out path/to/demo.mp4 --keep-frames
node plugins/video/skills/demo-video/scripts/check.mjs path/to/video.json
node plugins/video/skills/demo-video/scripts/check.mjs path/to/video.json --file path/to/demo.mp4
```

## `video.json`

Paths are relative to `video.json` unless stated otherwise.

| Key | Meaning and default |
| --- | --- |
| `page` | Required local page path or `http(s)` URL. |
| `out` | MP4 path; `out/video.mp4`. |
| `root` | Local server root; the page's directory. |
| `viewport` | `{ "width": 1920, "height": 1080 }`. |
| `fps` | Output frame rate; `30`. |
| `duration` | Required planned duration in seconds, greater than zero. |
| `cursor` | `{ "visible": true, "size": 32, "start": null }`; start is `[x,y]`. |
| `ready` | Optional JavaScript expression, polled until truthy for up to 10 seconds. |
| `timeline` | Ordered actions; `[]`. Actions may have a `label`. |
| `mustShow` | `{ selector, min, label? }` visibility requirements; `[]`. |
| `checks` | Output checks described below; `{}`. |

### Actions

| `do` | Fields and defaults |
| --- | --- |
| `move` | `to` selector or `x` and `y`; `anchor: [0.5,0.5]`, `dur: 0.6`, `ease: "inOut"`. |
| `click` | Optional `to`, moving first with `anchor: [0.5,0.5]`, `dur: 0.5`, `ease: "inOut"`; otherwise clicks the current cursor with duration zero. |
| `scroll` | `to` selector or `x` and/or `y`; `in: null` (page), `offset: 0`, `dur: 0.8`, `ease: "inOut"`. |
| `key` | `key`: Escape, Enter, Tab, Space, arrows, PageUp, PageDown, Home, End, or one character. |
| `call` | Global `fn`, `args: []`. Promise results are awaited with a 5-second timeout. |
| `wait` | No additional fields. |

Easing is `linear`, `in`, `out`, or `inOut`. Actions cannot overlap or end after the planned duration.

### Checks

| Level | Checks |
| --- | --- |
| FAIL | Missing/unreadable file; codec, pixel format, size, frame rate or duration mismatch; `maxBytes`; `moov` after `mdat`; black segment at least `blackMax` (`0.5`, `null` disables); unmet `mustShow`; failed action. |
| WARN | Audio unless `audio: "allowed"` (`"none"`); static share above `maxStaticShare` (`0.85`); motion-window capture gap above 0.2 s; motion frame rate below 20 fps; action over 0.15 s late; console errors; missing render report. |
| NEEDS HUMAN | Legibility, pacing, privacy, silent comprehensibility, plus every string in `human` (`[]`). |

`checks.duration` defaults to planned duration ±0.25 s. `maxBytes` has no default.

## Output

Rendering writes the MP4 and `<base>.render.json`. Checking writes `<base>.check.json`, `<base>.contact.png`, and up to five PNGs in `<base>.frames/`. Contact-sheet tiles run left to right, top to bottom and have no embedded time labels; their times are in the check report.

Capture follows the page in real time. ffmpeg re-times the captured frames to the requested constant frame rate. `capture.maxGap` and `capture.motionFps` cover only move and scroll windows, where the screencast is expected to produce frames; still holds are excluded.

## Limits

- The output has no audio track.
- Contact-sheet tiles have no time labels.
- Native Windows, WSL, and Ubuntu have not been run yet.
- Only the page viewport is captured; the cursor is a drawn page overlay rather than the operating-system cursor.
