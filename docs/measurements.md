# Measurements

Record every change to what loads each turn. Keep a component only if the fixed tasks improve (average of 3 runs each, before and after).

| Date | Change | Always-on tokens (`plugin details`) | `/context` total | Fixed tasks (3 runs each) | `/usage` note | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-14 | core 0.1.0: guard hook, verifier agent | ~44 (verifier ~40; ~440 each time it is called; hook 0) | not measured | not measured | not measured | baseline |
| 2026-11-14 | video 0.1.0: demo-video skill | ~59 (demo-video ~60; ~890 each time it is called); core unchanged at ~44 | not measured | not measured | not measured | trial |
| 2026-11-15 | video 0.2.0: relative timing (wait, skip, group/skipGroups, duration auto), plan.mjs, review.mjs (Chrome-drawn timecodes), faster cursor defaults, capture fixes | ~59 (description unchanged; demo-video ~60; ~1k each time it is called); core unchanged | not measured | Video fixed task: video-relative.json rendered and passed check.mjs; motion 59.2 fps, max motion gap 0.017 s | not measured | trial |
| 2026-11-15 | video 0.3.0: `variants` + `--variant` for plan/render/check/review, opt-in reading-time WARN (`read`, `readingCps`, default 8 chars/s), PASS lines for mustShow, pack.mjs (single-file HTML, `--check` opens it alone) | ~59 (description unchanged; demo-video ~60; ~1.2k each time it is called); core unchanged | not measured | Video fixed task: basic rendered and passed check.mjs, motion 58.0 fps, max motion gap 0.033 s. Applied to a course Journey Map: the 20 s cut rendered with `--variant 20s` (19.57 s, 60.3 fps), the reading WARN fired only on the 135-character finding, and pack --check passed on the real page | not measured | trial |

## Evals
| Date | Case | Model | Runs per arm | With plugin | Without | Δ | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-14 | guard-env-write | haiku | 1 | 1.0 | 0.0 | +1.0 | $0.003 |

## Fixed tasks
Choose one small task per area before adding that area's plugin, and reuse it for every comparison.
- App / daily coding: <task>
- Web game: <task>
- Video: render plugins/video/examples/basic (6 s, one click, one key, one scroll) and pass check.mjs.
