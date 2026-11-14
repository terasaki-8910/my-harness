import assert from "node:assert/strict";
import test from "node:test";
import { ease, lerp, lerpPoint, validate } from "../skills/demo-video/scripts/lib/timeline.mjs";

const valid = {
  page: "index.html", duration: 6,
  timeline: [
    { at: 0.5, do: "move", to: "#card" },
    { at: 1.2, do: "click" },
    { at: 2, do: "scroll", y: 500 },
    { at: 3, do: "key", key: "Escape" },
    { at: 4, do: "call", fn: "finish" },
    { at: 5, do: "wait" },
  ],
  mustShow: [{ selector: "#card", min: 1 }],
};

test("valid timeline receives defaults", () => {
  const { spec, errors } = validate(valid);
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.viewport, { width: 1920, height: 1080 });
  assert.equal(spec.out, "out/video.mp4");
  assert.equal(spec.root, ".");
  assert.deepEqual(spec.cursor, { visible: true, size: 32, start: null });
  assert.equal(spec.timeline[0].dur, 0.6);
  assert.equal(spec.timeline[2].dur, 0.8);
  assert.deepEqual(spec.timeline[4].args, []);
  assert.deepEqual(spec.checks.duration, [5.75, 6.25]);
  assert.equal(spec.checks.blackMax, 0.5);
  assert.equal(spec.checks.maxStaticShare, 0.85);
  assert.equal(spec.checks.audio, "none");
});

test("timeline reports field, ordering, overlap and duration errors with action indexes", () => {
  const { errors } = validate({
    page: "x", duration: 2,
    timeline: [
      { at: 0, do: "move", dur: 1, ease: "bad" },
      { at: 0.5, do: "click", to: "", dur: -1 },
      { at: 0.4, do: "scroll" },
      { at: 1, do: "key", key: "F13" },
      { at: 1.2, do: "call", fn: "not.valid", args: "no" },
      { at: 1.3, do: "move", x: 1, y: 2, dur: 1 },
      { at: 1.4, do: "unknown" },
    ],
  });
  for (const fragment of ["action 0 field to/x/y", "action 0 field ease", "action 1 field to", "action 1 field dur", "action 2 field to/x/y", "action 2 field at: actions must be sorted", "action 3 field key", "action 4 field fn", "action 4 field args", "action 5 field dur: ends after duration", "action 6 field do: unknown"]) {
    assert.ok(errors.some((error) => error.includes(fragment)), fragment);
  }
  assert.ok(errors.some((error) => error.includes("starts before")));
});

test("top-level, cursor, ready, mustShow and checks errors are reported", () => {
  const { errors } = validate({ page: "", out: "", root: "", duration: 0, viewport: { width: 0, height: 1.5 }, fps: 0, cursor: { visible: "yes", size: 0, start: [1] }, ready: {}, timeline: {}, mustShow: [{ selector: "", min: 0, label: 3 }], checks: { duration: [2, 1], maxBytes: 0, blackMax: 0, maxStaticShare: 2, audio: "yes", human: [1] } });
  for (const field of ["page", "out", "root", "duration", "viewport.width", "viewport.height", "fps", "cursor.visible", "cursor.size", "cursor.start", "ready", "timeline", "mustShow 0 field selector", "mustShow 0 field min", "mustShow 0 field label", "checks.duration", "checks.maxBytes", "checks.blackMax", "checks.maxStaticShare", "checks.audio", "checks.human"]) assert.ok(errors.some((error) => error.startsWith(field)), field);
});

test("ease and lerp helpers", () => {
  assert.equal(ease("linear", 0.25), 0.25);
  assert.equal(ease("in", 0.5), 0.125);
  assert.equal(ease("out", 0.5), 0.875);
  assert.equal(ease("inOut", 0.25), 0.0625);
  assert.equal(ease("inOut", 0.75), 0.9375);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.deepEqual(lerpPoint({ x: 0, y: 10 }, { x: 10, y: 20 }, 0.5), { x: 5, y: 15 });
  assert.throws(() => ease("bad", 0.5));
});
