import assert from "node:assert/strict";
import test from "node:test";
import { DEVICES, UsageError, parseCheckArgs, parseShotsArgs, parseSize, resolveDevice } from "../skills/app-ui/scripts/lib/args.mjs";

test("device presets", () => {
  assert.deepEqual({ ...DEVICES.ios }, { name: "ios", width: 390, height: 844, deviceScaleFactor: 3, minTarget: 44, safeTop: 59, safeBottom: 34 });
  assert.deepEqual({ ...DEVICES.android }, { name: "android", width: 412, height: 915, deviceScaleFactor: 2.625, minTarget: 48, safeTop: 24, safeBottom: 24 });
});

test("resolveDevice: --device beats the flow, the flow beats ios, --size changes only the size", () => {
  assert.equal(resolveDevice().name, "ios");
  assert.equal(resolveDevice({ flowDevice: "android" }).name, "android");
  assert.equal(resolveDevice({ flowDevice: "android", device: "ios" }).name, "ios");
  const sized = resolveDevice({ device: "android", size: { width: 360, height: 640 } });
  assert.deepEqual({ ...sized }, { ...DEVICES.android, width: 360, height: 640 });
  assert.throws(() => resolveDevice({ device: "tablet" }), UsageError);
  assert.equal(DEVICES.ios.width, 390, "presets are not mutated");
});

test("parseSize", () => {
  assert.deepEqual(parseSize("360x640"), { width: 360, height: 640 });
  assert.deepEqual(parseSize("360X640"), { width: 360, height: 640 });
  for (const bad of ["360", "0x640", "360x0", "axb", "360x640x2", "", "-1x5"]) assert.throws(() => parseSize(bad), UsageError, bad);
});

test("check arguments and defaults", () => {
  const args = parseCheckArgs(["flow.json"]);
  assert.deepEqual(args, { flow: "flow.json", device: null, size: null, minText: 11, timeout: 20, only: null, report: null });
  const full = parseCheckArgs(["--device", "android", "flow.json", "--size", "400x800", "--min-text", "12", "--timeout", "5", "--only", "a, b", "--report", "r.json"]);
  assert.deepEqual(full, { flow: "flow.json", device: "android", size: { width: 400, height: 800 }, minText: 12, timeout: 5, only: ["a", "b"], report: "r.json" });
});

test("check usage errors", () => {
  const cases = [
    [[], /usage/],
    [["a.json", "b.json"], /unexpected argument b\.json/],
    [["a.json", "--nope"], /unknown option --nope/],
    [["a.json", "--device"], /--device needs a value/],
    [["a.json", "--device", "tablet"], /--device must be ios or android/],
    [["a.json", "--size", "big"], /--size needs/],
    [["a.json", "--min-text", "x"], /--min-text/],
    [["a.json", "--min-text", "-1"], /--min-text/],
    [["a.json", "--timeout", "0"], /--timeout/],
    [["a.json", "--only", ","], /--only needs/],
    [["a.json", "--report"], /--report needs a value/],
  ];
  for (const [argv, pattern] of cases) assert.throws(() => parseCheckArgs(argv), (error) => error instanceof UsageError && pattern.test(error.message), argv.join(" "));
});

test("shots arguments and defaults", () => {
  assert.deepEqual(parseShotsArgs(["flow.json"]), { flow: "flow.json", device: null, size: null, dpr: 2, out: "app-shots", full: false, timeout: 20 });
  assert.deepEqual(parseShotsArgs(["flow.json", "--full", "--dpr", "1.5", "--out", "x", "--device", "ios", "--size", "320x568", "--timeout", "9"]), {
    flow: "flow.json", device: "ios", size: { width: 320, height: 568 }, dpr: 1.5, out: "x", full: true, timeout: 9,
  });
  assert.throws(() => parseShotsArgs(["flow.json", "--dpr", "0"]), UsageError);
  assert.throws(() => parseShotsArgs(["flow.json", "--report", "r"]), UsageError);
  assert.throws(() => parseShotsArgs([]), UsageError);
});
