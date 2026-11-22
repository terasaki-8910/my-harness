import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { blankReason, frameStats, intervalStats } from "../skills/game3d/scripts/lib/frames.mjs";

const script = fileURLToPath(new URL("../skills/game3d/scripts/frames.mjs", import.meta.url));
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, body = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  let c = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), body])) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

function encodeRgb(image) {
  const { width, height, data } = image;
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.from([0]), Buffer.from(data.subarray(y * width * 3, (y + 1) * width * 3)));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND")]);
}

function image(width, height, channels, pixel) {
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * channels);
  }
  return { width, height, channels, data };
}

const white = () => image(64, 64, 3, () => [255, 255, 255]);
const black = () => image(64, 64, 3, () => [0, 0, 0]);
const grey = () => image(64, 64, 3, () => [128, 128, 128]);
// 8 px cells so that sampling every 4th pixel sees both colours.
const checkerboard = () => image(64, 64, 3, (x, y) => ((x >> 3) + (y >> 3)) % 2 === 0 ? [255, 255, 255] : [0, 0, 0]);

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30_000 });
}

test("frameStats uses Rec. 709 luminance on a 0..1 scale", () => {
  const stats = frameStats(image(8, 8, 3, () => [255, 0, 0]));
  assert.ok(Math.abs(stats.mean - 0.2126) < 1e-9);
  assert.equal(stats.std < 1e-6, true);
  assert.equal(stats.white, 0);
  assert.equal(stats.black, 0);
  assert.ok(Math.abs(frameStats(image(8, 8, 3, () => [0, 255, 0])).mean - 0.7152) < 1e-9);
  assert.ok(Math.abs(frameStats(image(8, 8, 3, () => [0, 0, 255])).mean - 0.0722) < 1e-9);
});

test("frameStats reads grey, grey+alpha and RGBA images and honours step", () => {
  assert.ok(Math.abs(frameStats(image(8, 8, 1, () => [51])).mean - 0.2) < 1e-9);
  assert.ok(Math.abs(frameStats(image(8, 8, 2, () => [51, 0])).mean - 0.2) < 1e-9);
  assert.ok(Math.abs(frameStats(image(8, 8, 4, () => [255, 0, 0, 7])).mean - 0.2126) < 1e-9);
  // Only the pixels at x and y multiples of 8 are bright, so step 8 sees nothing else.
  const dots = image(16, 16, 1, (x, y) => x % 8 === 0 && y % 8 === 0 ? [255] : [0]);
  assert.equal(frameStats(dots, { step: 8 }).white, 1);
  assert.equal(frameStats(dots, { step: 1 }).white, 4 / 256);
  assert.throws(() => frameStats(dots, { step: 0 }), /step/);
});

test("blankReason names white, black and uniform frames and passes a busy one", () => {
  assert.equal(blankReason(frameStats(white())), "white");
  assert.equal(blankReason(frameStats(black())), "black");
  assert.equal(blankReason(frameStats(grey())), "uniform");
  assert.equal(blankReason(frameStats(checkerboard())), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0.98, black: 0 }), "white");
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0.979, black: 0 }), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.02, white: 0, black: 0 }), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.019, white: 0, black: 0 }), "uniform");
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0.9, black: 0 }, { maxFlat: 0.9 }), "white");
  assert.equal(blankReason({ mean: 0.5, std: 0.05, white: 0, black: 0 }, { minStd: 0.1 }), "uniform");
});

test("intervalStats uses nearest-rank percentiles", () => {
  const intervals = Array.from({ length: 100 }, (_, index) => index + 1).reverse();
  assert.deepEqual(intervalStats(intervals), { frames: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  assert.deepEqual(intervalStats([16.7]), { frames: 1, p50: 16.7, p95: 16.7, p99: 16.7, max: 16.7 });
  assert.throws(() => intervalStats([]), /no frame/);
});

test("frames.mjs exits 0, 1 and 2 and prints PASS and FAIL lines", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-frames-"));
  try {
    const ok = path.join(directory, "ok.png");
    const blank = path.join(directory, "blank.png");
    const broken = path.join(directory, "broken.png");
    fs.writeFileSync(ok, encodeRgb(checkerboard()));
    fs.writeFileSync(blank, encodeRgb(white()));
    fs.writeFileSync(broken, "this is not a png");

    const pass = run([ok]);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /^PASS .*ok\.png mean=0\.500 std=0\.500\n$/);

    const fail = run([blank, ok]);
    assert.equal(fail.status, 1, fail.stderr);
    assert.match(fail.stdout, /^FAIL .*blank\.png white mean=1\.000 std=0\.000\nPASS .*ok\.png /);

    const bad = run([ok, broken]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /broken\.png: Not a PNG file/);
    assert.match(bad.stdout, /^PASS .*ok\.png /);
    assert.equal(run([blank, broken]).status, 2, "exit 2 outranks exit 1");

    assert.equal(run([path.join(directory, "missing.png")]).status, 2);
    assert.equal(run([]).status, 2);
    assert.equal(run([ok, "--nope"]).status, 2);
    assert.equal(run([ok, "--min-std", "high"]).status, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("frames.mjs scans directories without recursion, prints JSON and takes thresholds", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-frames-"));
  try {
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "b-black.png"), encodeRgb(black()));
    fs.writeFileSync(path.join(directory, "a-grey.png"), encodeRgb(grey()));
    fs.writeFileSync(path.join(directory, "c-checker.PNG"), encodeRgb(checkerboard()));
    fs.writeFileSync(path.join(directory, "notes.txt"), "ignored");
    fs.writeFileSync(path.join(directory, "nested", "d-white.png"), encodeRgb(white()));

    const result = run([directory, "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.map((item) => [path.basename(item.file), item.blank]), [["a-grey.png", "uniform"], ["b-black.png", "black"], ["c-checker.PNG", null]]);
    assert.deepEqual(Object.keys(parsed[0]), ["file", "stats", "blank"]);
    assert.deepEqual(Object.keys(parsed[0].stats), ["mean", "std", "white", "black", "mode"]);
    assert.equal(parsed[0].file.includes("\\"), false);

    // a uniform frame is flat as well, so loosening --min-std needs a frame that varies a little (levels 120..127)
    const faint = path.join(directory, "faint.png");
    fs.writeFileSync(faint, encodeRgb(image(64, 64, 3, (x) => [120 + (x >> 3), 120 + (x >> 3), 120 + (x >> 3)])));
    assert.equal(run([faint]).status, 1);
    const loose = run([faint, "--min-std", "0"]);
    assert.equal(loose.status, 0, loose.stdout);
    assert.equal(run([path.join(directory, "a-grey.png"), "--min-std", "0"]).status, 1, "a uniform frame is still flat");
    const strict = run([path.join(directory, "c-checker.PNG"), "--max-flat", "0.5"]);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /^FAIL .* white /);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-frames-empty-"));
    try { assert.equal(run([empty]).status, 2); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// A frame of one colour with a small dark box on it, like a whited-out WebGL canvas with a HUD element.
const withBox = (base, boxColour = [40, 40, 48]) => image(64, 64, 3, (x, y) => (x >= 4 && x < 20 && y >= 52 && y < 60 ? boxColour : base));

test("frameStats reports the share of samples within +-2 levels of the most common level", () => {
  assert.equal(frameStats(white()).mode, 1);
  assert.equal(frameStats(grey()).mode, 1);
  assert.equal(frameStats(checkerboard()).mode, 0.5);
  // levels 98..102 are all within 2 of the most common level 100; 103 is not
  const bands = (offset) => image(64, 64, 1, (x) => [x < 40 ? 100 : 100 + offset]);
  assert.equal(frameStats(bands(2)).mode, 1);
  assert.equal(frameStats(bands(-2)).mode, 1);
  assert.ok(Math.abs(frameStats(bands(3)).mode - 40 / 64) < 1e-9);
  // the share is taken around the single most common level, wherever it is in the range
  assert.equal(frameStats(image(8, 8, 1, () => [0])).mode, 1);
  assert.equal(frameStats(image(8, 8, 1, () => [255])).mode, 1);
});

test("a whited-out frame with a small HUD box is flat, and a frame with real content is not", () => {
  const whiteWithBox = frameStats(withBox([255, 255, 255]));
  assert.ok(whiteWithBox.white < 0.98, "the box keeps the white share under maxFlat");
  assert.ok(whiteWithBox.std >= 0.02, "and the std above minStd");
  assert.equal(blankReason(whiteWithBox), "flat");
  assert.equal(blankReason(frameStats(withBox([0, 0, 0], [220, 220, 220]))), "flat");
  assert.equal(blankReason(frameStats(withBox([120, 130, 140]))), "flat");
  // white, black and uniform are decided first
  assert.equal(blankReason(frameStats(white())), "white");
  assert.equal(blankReason(frameStats(black())), "black");
  assert.equal(blankReason(frameStats(grey())), "uniform");
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0.98, black: 0, mode: 1 }), "white");
  assert.equal(blankReason({ mean: 0.5, std: 0.0, white: 0, black: 0, mode: 1 }), "uniform");
  // a busy frame passes, the threshold is inclusive and adjustable
  assert.equal(blankReason(frameStats(checkerboard())), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0, black: 0, mode: 0.9 }), "flat");
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0, black: 0, mode: 0.899 }), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0, black: 0, mode: 0.95 }, { maxMode: 0.96 }), null);
  assert.equal(blankReason({ mean: 0.5, std: 0.1, white: 0, black: 0, mode: 0.6 }, { maxMode: 0.5 }), "flat");
});

test("frames.mjs prints flat for a whited-out frame with a HUD box and takes --max-mode", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-frames-"));
  try {
    const pure = path.join(directory, "1-white.png");
    const boxed = path.join(directory, "2-white-with-box.png");
    const busy = path.join(directory, "3-busy.png");
    fs.writeFileSync(pure, encodeRgb(white()));
    fs.writeFileSync(boxed, encodeRgb(withBox([255, 255, 255])));
    fs.writeFileSync(busy, encodeRgb(checkerboard()));

    const json = run([directory, "--json"]);
    assert.equal(json.status, 1, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.deepEqual(parsed.map((item) => [path.basename(item.file), item.blank]), [["1-white.png", "white"], ["2-white-with-box.png", "flat"], ["3-busy.png", null]]);
    assert.deepEqual(Object.keys(parsed[1].stats), ["mean", "std", "white", "black", "mode"]);

    const text = run([boxed]);
    assert.equal(text.status, 1);
    assert.match(text.stdout, /^FAIL .*2-white-with-box\.png flat mean=0\.\d{3} std=0\.\d{3}\n$/);
    const lenient = run([boxed, "--max-mode", "1"]);
    assert.equal(lenient.status, 0, lenient.stdout);
    assert.equal(run([busy, "--max-mode", "0.4"]).status, 1, "a threshold below the busy frame's own mode share flags it");
    assert.equal(run([busy, "--max-mode", "2"]).status, 2);
    assert.equal(run([busy, "--max-mode"]).status, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
