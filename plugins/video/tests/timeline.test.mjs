import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ease, lerp, lerpPoint, validate } from "../skills/demo-video/scripts/lib/timeline.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

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
  assert.equal(spec.timeline[0].dur, 0.35);
  assert.equal(spec.timeline[0].ease, "out");
  assert.equal(spec.timeline[2].dur, 0.6);
  assert.equal(spec.timeline[2].ease, "inOut");
  assert.deepEqual(spec.timeline[4].args, []);
  assert.deepEqual(spec.checks.duration, [5.75, 6.25]);
  assert.equal(spec.checks.blackMax, 0.5);
  assert.equal(spec.checks.maxStaticShare, 0.85);
  assert.equal(spec.checks.audio, "none");
});

test("relative waits chain from the previous planned end", () => {
  const { spec, errors } = validate({
    page: "x", duration: "auto", tail: 0.5,
    timeline: [
      { wait: 0.25, do: "move", x: 1, y: 2, dur: 0.5 },
      { wait: 0.1, do: "click", to: "#x", dur: 0.4 },
      { do: "wait", dur: 2 },
      { wait: 0.2, do: "key", key: "Escape" },
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.timeline.map((action) => action.at), [0.25, 0.85, 1.25, 3.45]);
  assert.equal(spec.duration, 3.95);
  assert.deepEqual(spec.checks.duration, [3.7, 4.2]);
});

test("skipped actions are removed before timing and their other fields are ignored", () => {
  const { spec, errors } = validate({
    page: "x", duration: "auto",
    timeline: [
      { wait: 1, do: "wait", dur: 1 },
      { skip: true, at: "bad", wait: -3, do: "unknown", dur: "bad" },
      { wait: 0.5, do: "wait", dur: 1 },
      { at: 8, do: "key", key: "Escape" },
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.timeline.map((action) => action.at), [1, 2.5, 8]);
  assert.equal(spec.duration, 9);
});

test("skipGroups removes a whole group before resolving later relative actions", () => {
  const { spec, errors } = validate({
    page: "x", duration: "auto", tail: 1, skipGroups: ["tour"],
    timeline: [
      { wait: 0, do: "wait", dur: 1 },
      { wait: 0, do: "wait", dur: 2, group: "tour" },
      { wait: 0, do: "wait", dur: 3, group: "tour" },
      { wait: 0, do: "key", key: "Escape" },
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.timeline.map((action) => action.at), [0, 1]);
  assert.deepEqual(spec.skipGroups, ["tour"]);
  assert.equal(spec.duration, 2);
});

test("group and skipGroups validation reports invalid and unused names", () => {
  const invalidGroup = validate({ page: "x", duration: 2, timeline: [{ at: 0, do: "wait", group: 3 }] });
  assert.ok(invalidGroup.errors.includes("action 0 field group: must be a non-empty string"));
  const unknown = validate({ page: "x", duration: 2, skipGroups: ["missing"], timeline: [{ at: 0, do: "wait", group: "tour" }] });
  assert.ok(unknown.errors.includes('skipGroups: no action has group "missing"'));
  const invalidList = validate({ page: "x", duration: 2, skipGroups: [""], timeline: [] });
  assert.ok(invalidList.errors.includes("skipGroups: must be an array of non-empty strings"));
});

test("absolute at mixes with relative wait without moving the absolute action", () => {
  const { spec, errors } = validate({ page: "x", duration: 10, timeline: [
    { wait: 1, do: "wait", dur: 1 },
    { at: 5, do: "wait", dur: 1 },
    { wait: 0.5, do: "key", key: "Escape" },
  ] });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.timeline.map((action) => action.at), [1, 5, 6.5]);
});

test("auto duration uses tail and rejects an empty zero-length plan", () => {
  assert.equal(validate({ page: "x", duration: "auto", tail: 2, timeline: [] }).spec.duration, 2);
  const empty = validate({ page: "x", duration: "auto", tail: 0, timeline: [] });
  assert.ok(empty.errors.some((error) => error.startsWith("duration:")));
  const numericTail = validate({ page: "x", duration: 2, tail: 1 });
  assert.ok(numericTail.errors.some((error) => error.startsWith("tail:")));
});

test("at and wait together is invalid and resolved relative timing still detects overlap", () => {
  const both = validate({ page: "x", duration: 5, timeline: [{ at: 1, wait: 1, do: "wait" }] });
  assert.ok(both.errors.some((error) => error.includes("action 0 fields at/wait")));
  const overlap = validate({ page: "x", duration: 5, timeline: [
    { wait: 1, do: "wait", dur: 2 },
    { at: 2, do: "key", key: "Escape" },
  ] });
  assert.ok(overlap.errors.some((error) => error.includes("action 1 field at: starts before action 0 ends at 3")));
});

test("new movement defaults apply unless explicitly overridden", () => {
  const { spec, errors } = validate({ page: "x", duration: 5, timeline: [
    { at: 0, do: "move", x: 1, y: 2 },
    { at: 1, do: "click", to: "#x" },
    { at: 2, do: "scroll", y: 1 },
    { at: 3, do: "move", x: 1, y: 2, dur: 0.9, ease: "linear" },
  ] });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.timeline.map(({ dur, ease }) => [dur, ease]), [[0.35, "out"], [0.35, "out"], [0.6, "inOut"], [0.9, "linear"]]);
});

test("existing examples keep their explicit start times", () => {
  for (const name of ["video.json", "video-20s.json"]) {
    const raw = JSON.parse(fs.readFileSync(path.join(testDirectory, "..", "examples", "basic", name), "utf8"));
    const { spec, errors } = validate(raw);
    assert.deepEqual(errors, [], name);
    assert.deepEqual(spec.timeline.map((action) => action.at), raw.timeline.map((action) => action.at), name);
  }
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
