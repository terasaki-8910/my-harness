import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome } from "../skills/game3d/scripts/lib/chrome.mjs";
import { backendArgs, parseNumber, parseSize, resolveBackend } from "../skills/game3d/scripts/lib/page.mjs";
import { decodePng } from "../skills/game3d/scripts/lib/png.mjs";
import { startServer } from "../skills/game3d/scripts/lib/server.mjs";
import { compareHtml, pairShots, safeFilePart, sheetHtml } from "../skills/game3d/scripts/lib/sheet.mjs";

const scripts = fileURLToPath(new URL("../skills/game3d/scripts/", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/shots-page/", import.meta.url));

let chromeMissing = false;
try {
  findChrome();
} catch (error) {
  chromeMissing = `Chrome or Chromium is not installed (${error.message.split("\n", 1)[0]})`;
}

function run(script, args, timeout = 120_000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(scripts, script), ...args], { encoding: "utf8", timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

test("backendArgs maps each backend to Chrome arguments", () => {
  assert.deepEqual(backendArgs("auto", "win32"), ["--use-angle=gl", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("auto", "linux"), ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("auto", "darwin"), []);
  assert.deepEqual(backendArgs("gl", "darwin"), ["--use-angle=gl", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("d3d11", "win32"), ["--use-angle=d3d11", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("metal", "darwin"), ["--use-angle=metal", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("swiftshader", "win32"), ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]);
  assert.deepEqual(backendArgs("default", "win32"), []);
  assert.throws(() => backendArgs("vulkan", "linux"), /Unknown backend "vulkan"/);
  assert.equal(resolveBackend("auto", "win32"), "gl");
  assert.equal(resolveBackend("auto", "freebsd"), "default");
});

test("size and number options reject bad values", () => {
  assert.deepEqual(parseSize("640x360"), { width: 640, height: 360 });
  for (const bad of ["640", "0x10", "10x0", "axb", "640x360x2", ""]) assert.throws(() => parseSize(bad), /--size/, bad);
  assert.equal(parseNumber("2.5", "--dpr", { min: 0, exclusiveMin: true }), 2.5);
  assert.throws(() => parseNumber("0", "--dpr", { min: 0, exclusiveMin: true }), /--dpr/);
  assert.throws(() => parseNumber("1.5", "--settle", { integer: true }), /--settle/);
  assert.throws(() => parseNumber("", "--timeout"), /--timeout/);
});

test("safeFilePart keeps useful ids and removes reserved characters", () => {
  assert.equal(safeFilePart("level 1/boss: <fight>", "shot-1"), "level 1-boss- -fight-");
  assert.equal(safeFilePart("結論/次", "shot-1"), "結論-次");
  assert.equal(safeFilePart("", "shot-1"), "shot-1");
  assert.equal(safeFilePart("name. ", "shot-1"), "name");
  assert.equal(safeFilePart("x".repeat(200), "shot-1").length, 80);
});

test("pairShots follows the after order, then ids only in before", () => {
  const before = [{ id: "a" }, { id: "gone" }, { id: "b" }];
  const after = [{ id: "b" }, { id: "new" }, { id: "a" }];
  assert.deepEqual(pairShots(before, after).map((row) => [row.id, row.before?.id ?? null, row.after?.id ?? null]), [
    ["b", "b", "b"], ["new", null, "new"], ["a", "a", "a"], ["gone", "gone", null],
  ]);
});

test("sheet HTML escapes captions, shows notes and the word missing", () => {
  const html = sheetHtml({ title: "<x>", subtitle: "A & B", tiles: [{ id: "one < two", label: "L", src: 'data:image/png;base64,"', note: "FAIL white" }], columns: 5, tileWidth: 320 });
  assert.match(html, /repeat\(1,320px\)/);
  assert.match(html, /one &lt; two/);
  assert.match(html, /FAIL white/);
  assert.match(html, /<title>&lt;x&gt;<\/title>/);
  assert.doesNotMatch(html, /one < two/);
  const compare = compareHtml({ title: "t", rows: [{ id: "r", label: "Row", before: null, after: { src: "data:x" } }, { id: "s", before: { src: "data:y" }, after: null }] });
  assert.equal(compare.match(/>missing</g).length, 2);
  assert.match(compare, /Row/);
});

describe("shots.mjs, sheet.mjs and perf.mjs in headless Chrome", { skip: chromeMissing }, () => {
  let server;
  let base;
  let work;
  let main;

  before(async () => {
    server = await startServer(fixtures);
    base = `http://127.0.0.1:${server.port}`;
    work = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-shots-"));
    main = path.join(work, "main");
  });

  after(async () => {
    await server?.close();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("captures the three fixture shots, flags the blank one and draws a contact sheet", async () => {
    const result = await run("shots.mjs", [`${base}/index.html`, "--out", main, "--size", "640x360"]);
    assert.equal(result.status, 1, result.stderr);
    const lines = result.stdout.trim().split("\n");
    assert.match(lines[0], /^PASS red mean=0\.\d{3} std=0\.\d{3}$/);
    assert.match(lines[1], /^PASS grad mean=/);
    assert.match(lines[2], /^FAIL blank white mean=1\.000 std=0\.000$/);
    assert.match(lines[3], /^renderer: .+/);
    assert.match(lines[4], /shots\.json$/);
    assert.match(lines[5], /sheet\.png$/);

    const report = JSON.parse(fs.readFileSync(path.join(main, "shots.json"), "utf8"));
    assert.equal(report.url, `${base}/index.html`);
    assert.deepEqual(report.size, [640, 360]);
    assert.equal(report.dpr, 1);
    assert.equal(report.backend, "auto");
    assert.equal(report.headed, false);
    assert.equal(typeof report.renderer, "string");
    assert.ok(report.renderer.length > 0);
    assert.match(report.chromeVersion, /Chrome\//);
    assert.ok(!Number.isNaN(Date.parse(report.date)));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.shots.map((shot) => [shot.id, shot.label, shot.file, shot.blank]), [
      ["red", "red", "01-red.png", null],
      ["grad", "Horizontal gradient", "02-grad.png", null],
      ["blank", "Pure white", "03-blank.png", "white"],
    ]);
    for (const shot of report.shots) {
      assert.deepEqual(Object.keys(shot.stats), ["mean", "std", "white", "black"]);
      const png = decodePng(fs.readFileSync(path.join(main, shot.file)));
      assert.deepEqual([png.width, png.height], [640, 360], shot.file);
    }
    assert.ok(report.shots[0].stats.white > 0.05 && report.shots[0].stats.white < 0.08, "the white square covers 1/16 of the red frame");
    assert.equal(report.shots[2].stats.white, 1);

    const sheet = decodePng(fs.readFileSync(path.join(main, "sheet.png")));
    assert.ok(sheet.width > 640, `sheet is ${sheet.width} px wide`);
    assert.ok(sheet.height > 360);
  });

  it("--only selects shots, numbers them from 01 and --dpr scales the capture", async () => {
    const out = path.join(work, "only");
    const result = await run("shots.mjs", [`${base}/index.html`, "--out", out, "--size", "320x180", "--dpr", "2", "--only", "grad,red", "--settle", "1"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
    assert.deepEqual(report.shots.map((shot) => shot.file), ["01-red.png", "02-grad.png"]);
    assert.equal(report.dpr, 2);
    assert.deepEqual(report.size, [320, 180]);
    const png = decodePng(fs.readFileSync(path.join(out, "01-red.png")));
    assert.deepEqual([png.width, png.height], [640, 360]);
  });

  it("an unknown --only id is a setup error", async () => {
    const result = await run("shots.mjs", [`${base}/index.html`, "--out", path.join(work, "unknown"), "--only", "nope"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /shots: Unknown shot id in --only: nope/);
    assert.match(result.stderr, /red, grad, blank/);
  });

  it("a page without window.__shots exits 2 and states the contract", async () => {
    const result = await run("shots.mjs", [`${base}/nocontract.html`, "--out", path.join(work, "nocontract"), "--timeout", "3"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /window\.__shots/);
    assert.match(result.stderr, /ready\(\): boolean/);
    assert.match(result.stderr, /show\(id: string\)/);
  });

  it("an unreachable page exits 2 at once instead of waiting for the contract", async () => {
    const started = Date.now();
    const result = await run("shots.mjs", ["http://127.0.0.1:9/index.html", "--out", path.join(work, "refused"), "--timeout", "30"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Could not open/);
    assert.ok(Date.now() - started < 25_000);
  });

  it("page errors are collected and make the exit code 1", async () => {
    const out = path.join(work, "errors");
    const result = await run("shots.mjs", [`${base}/errors.html`, "--out", out, "--size", "320x180"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^PASS grad /);
    assert.match(result.stderr, /page error: fixture console error/);
    assert.match(result.stderr, /page error: Error: fixture uncaught error/);
    const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
    assert.equal(report.errors.length, 2);
  });

  it("bad arguments exit 2", async () => {
    for (const args of [[], [`${base}/index.html`], [`${base}/index.html`, "--out", path.join(work, "x"), "--size", "big"], [`${base}/index.html`, "--out", path.join(work, "x"), "--backend", "vulkan"], ["not a url", "--out", path.join(work, "x")]]) {
      const result = await run("shots.mjs", args, 20_000);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /^shots: /);
    }
  });

  it("sheet.mjs compares two runs, and shows a missing shot instead of failing", async () => {
    const same = path.join(work, "same.png");
    const result = await run("sheet.mjs", ["--before", main, "--after", main, "--out", same, "--title", "Same build"]);
    assert.equal(result.status, 0, result.stderr);
    const png = decodePng(fs.readFileSync(same));
    assert.ok(png.width > 640);

    const trimmed = path.join(work, "trimmed");
    fs.cpSync(main, trimmed, { recursive: true });
    const report = JSON.parse(fs.readFileSync(path.join(trimmed, "shots.json"), "utf8"));
    report.shots = report.shots.filter((shot) => shot.id !== "grad");
    fs.writeFileSync(path.join(trimmed, "shots.json"), JSON.stringify(report));
    const different = path.join(work, "different.png");
    const second = await run("sheet.mjs", ["--before", main, "--after", trimmed, "--out", different]);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(decodePng(fs.readFileSync(different)).height > 360);
  });

  it("sheet.mjs exits 2 for a missing or invalid shots.json", async () => {
    const empty = path.join(work, "empty");
    fs.mkdirSync(empty);
    const missing = await run("sheet.mjs", ["--before", empty, "--after", main, "--out", path.join(work, "nope.png")], 20_000);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /shots\.json not found/);
    const invalid = path.join(work, "invalid");
    fs.mkdirSync(invalid);
    fs.writeFileSync(path.join(invalid, "shots.json"), "{ not json");
    assert.equal((await run("sheet.mjs", ["--before", main, "--after", invalid, "--out", path.join(work, "nope.png")], 20_000)).status, 2);
    fs.writeFileSync(path.join(invalid, "shots.json"), JSON.stringify({ shots: [{ id: 1 }] }));
    assert.equal((await run("sheet.mjs", ["--before", main, "--after", invalid, "--out", path.join(work, "nope.png")], 20_000)).status, 2);
    assert.equal((await run("sheet.mjs", ["--before", main], 20_000)).status, 2);
    assert.equal(fs.existsSync(path.join(work, "nope.png")), false);
  });

  it("perf.mjs reports frame times and applies the p95 budget", async () => {
    const result = await run("perf.mjs", [`${base}/index.html`, "--seconds", "2", "--warmup", "0.5", "--size", "320x180"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^frames: \d+\np50: \d+\.\d ms\np95: \d+\.\d ms\np99: \d+\.\d ms\nmax: \d+\.\d ms\nrenderer: .+/);
    const frames = Number(/frames: (\d+)/.exec(result.stdout)[1]);
    assert.ok(frames > 20, `${frames} frames in 2 s`);
    const over = await run("perf.mjs", [`${base}/index.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180", "--p95", "0.1"]);
    assert.equal(over.status, 1, over.stderr);
    assert.match(over.stdout, /FAIL p95 .* is above the 0\.1 ms budget/);
    const within = await run("perf.mjs", [`${base}/index.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180", "--p95", "1000"]);
    assert.equal(within.status, 0, within.stderr);
    assert.equal((await run("perf.mjs", [`${base}/index.html`, "--seconds", "0"], 20_000)).status, 2);
  });
});
