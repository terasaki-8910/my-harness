import assert from "node:assert/strict";
import test from "node:test";
import { buildEncodeArgs } from "../skills/demo-video/scripts/lib/encode.mjs";
import { captureMotionMetrics } from "../skills/demo-video/scripts/lib/frames.mjs";
import { keyEvents } from "../skills/demo-video/scripts/lib/input.mjs";

test("key events never include nativeVirtualKeyCode and separate text from raw keys", () => {
  const [escapeDown, escapeUp] = keyEvents("Escape");
  assert.deepEqual(escapeDown, { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.deepEqual(escapeUp, { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  for (const key of ["Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
    const [down, up] = keyEvents(key);
    assert.equal(down.type, "rawKeyDown", key);
    assert.equal("text" in down, false, key);
    assert.equal("unmodifiedText" in down, false, key);
    assert.equal("nativeVirtualKeyCode" in down, false, key);
    assert.equal("nativeVirtualKeyCode" in up, false, key);
  }
  for (const [key, text] of [["Enter", "\r"], ["Space", " "], ["a", "a"], ["7", "7"]]) {
    const [down, up] = keyEvents(key);
    assert.equal(down.type, "keyDown", key);
    assert.equal(down.text, text, key);
    assert.equal(down.unmodifiedText, text, key);
    assert.equal(up.type, "keyUp", key);
    assert.equal("text" in up, false, key);
    assert.equal("unmodifiedText" in up, false, key);
  }
});

test("encode arguments convert JPEG full range to limited-range BT.709 yuv420p", () => {
  assert.deepEqual(buildEncodeArgs({ list: "/tmp/list.ffconcat", fps: 30, width: 1920, height: 1080, duration: 6, out: "/tmp/out.mp4" }), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", "/tmp/list.ffconcat",
    "-vf", "fps=30,scale=1920:1080:flags=lanczos:in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p",
    "-t", "6", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", "/tmp/out.mp4",
  ]);
});

test("capture metrics use only move and scroll windows", () => {
  const frames = [0.1, 0.2, 0.8, 1.5, 2.1, 2.2, 2.3, 2.4].map((time, index) => ({ file: `${index}.jpg`, ts: 100 + time }));
  const metrics = captureMotionMetrics(frames, { start: 100, actions: [
    { do: "move", startedAt: 0, endedAt: 1 },
    { do: "click", startedAt: 1.4, endedAt: 1.6 },
    { do: "scroll", startedAt: 2, endedAt: 2.5 },
  ] });
  // Middle 80% of each window: move [0.1, 0.9], scroll [2.05, 2.45].
  assert.ok(Math.abs(metrics.maxGap - 0.6) < 1e-9);
  assert.ok(Math.abs(metrics.motionFps - (6 / 1.2)) < 1e-9);
  assert.deepEqual(captureMotionMetrics(frames, { start: 100, actions: [{ do: "click", startedAt: 0, endedAt: 1 }] }), { maxGap: 0, motionFps: null });
});

test("capture metrics use the planned duration when it is recorded", () => {
  // The move was planned for 0.6 s, but its record ends at 1.25 s after the post-action checks.
  // The frame-free time after the planned end must not count as a gap.
  const frames = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((time, index) => ({ file: `${index}.jpg`, ts: 100 + time }));
  const metrics = captureMotionMetrics(frames, { start: 100, actions: [{ do: "move", dur: 0.6, startedAt: 0, endedAt: 1.25 }] });
  assert.ok(metrics.maxGap < 0.06, `maxGap ${metrics.maxGap}`);
});
