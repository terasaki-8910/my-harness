import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome } from "../skills/game3d/scripts/lib/chrome.mjs";
import { backendArgs, createCleanupRegistry, parseNumber, parseSize, resolveBackend, watchPage } from "../skills/game3d/scripts/lib/page.mjs";
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

function fakeCdp() {
  const handlers = new Map();
  return {
    on(method, handler) {
      const set = handlers.get(method) ?? new Set();
      set.add(handler);
      handlers.set(method, set);
      return () => set.delete(handler);
    },
    emit(method, params, sessionId = "S") {
      for (const handler of handlers.get(method) ?? []) handler(params, sessionId);
    },
    count(method) { return handlers.get(method)?.size ?? 0; },
  };
}

test("watchPage records failed loads, HTTP errors and Log errors once per URL, with URL and status", () => {
  const cdp = fakeCdp();
  const diagnostics = watchPage(cdp, "S");
  const request = (requestId, url) => cdp.emit("Network.requestWillBeSent", { requestId, request: { url } });
  request("1", "http://h/a.png");
  cdp.emit("Network.responseReceived", { requestId: "1", response: { url: "http://h/a.png", status: 404, statusText: "Not Found" } });
  // Chrome also logs the same 404 as a Log entry: not a second error
  cdp.emit("Log.entryAdded", { entry: { source: "network", level: "error", text: "Failed to load resource: the server responded with a status of 404 (Not Found)", url: "http://h/a.png" } });
  request("2", "http://h/b.glb");
  cdp.emit("Network.loadingFailed", { requestId: "2", errorText: "net::ERR_CONNECTION_REFUSED", canceled: false });
  request("3", "http://h/c.png");
  cdp.emit("Network.loadingFailed", { requestId: "3", errorText: "net::ERR_ABORTED", canceled: true });
  request("4", "http://h/ok.png");
  cdp.emit("Network.responseReceived", { requestId: "4", response: { url: "http://h/ok.png", status: 200 } });
  cdp.emit("Network.responseReceived", { requestId: "5", response: { url: "http://h/redirect", status: 302 } });
  // a Log error that only the Log domain saw
  cdp.emit("Log.entryAdded", { entry: { source: "network", level: "error", text: "Failed to load resource: the server responded with a status of 500 ()", url: "http://h/d.bin" } });
  cdp.emit("Log.entryAdded", { entry: { source: "javascript", level: "warning", text: "just a warning", url: "http://h/e.js" } });
  cdp.emit("Log.entryAdded", { entry: { source: "security", level: "error", text: "mixed content" } });
  cdp.emit("Log.entryAdded", { entry: { source: "security", level: "error", text: "mixed content" } });
  cdp.emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: "boom" }, { description: "Error: x" }] });
  cdp.emit("Runtime.consoleAPICalled", { type: "log", args: [{ value: "fine" }] });
  cdp.emit("Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught", exception: { description: "Error: thrown" } } });
  // another session's events are not ours
  cdp.emit("Network.responseReceived", { requestId: "9", response: { url: "http://h/other.png", status: 404 } }, "OTHER");

  assert.deepEqual(diagnostics.networkErrors, [
    { kind: "http", url: "http://h/a.png", status: 404, text: "Not Found" },
    { kind: "failed", url: "http://h/b.glb", status: null, text: "net::ERR_CONNECTION_REFUSED" },
    { kind: "log", url: "http://h/d.bin", status: 500, text: "Failed to load resource: the server responded with a status of 500 ()" },
  ]);
  assert.deepEqual(diagnostics.errors, [
    "HTTP 404 http://h/a.png",
    "request failed (net::ERR_CONNECTION_REFUSED) http://h/b.glb",
    "Failed to load resource: the server responded with a status of 500 () (http://h/d.bin)",
    "mixed content",
    "boom Error: x",
    "Error: thrown",
  ]);
});

test("watchPage ignores /favicon.ico and URLs containing an ignored substring, and stop() unsubscribes", () => {
  const cdp = fakeCdp();
  const diagnostics = watchPage(cdp, "S", { ignoreUrl: ["optional-player.vrm", "/legacy/"] });
  const notFound = (url) => cdp.emit("Network.responseReceived", { requestId: url, response: { url, status: 404 } });
  notFound("http://h/favicon.ico");
  notFound("http://h/sub/favicon.ico?v=2");
  cdp.emit("Log.entryAdded", { entry: { source: "network", level: "error", text: "Failed to load resource: 404", url: "http://h/favicon.ico" } });
  notFound("http://h/models/optional-player.vrm");
  notFound("http://h/legacy/x.png");
  assert.deepEqual(diagnostics.errors, []);
  notFound("http://h/favicon.icon");
  notFound("http://h/models/player.vrm");
  assert.deepEqual(diagnostics.networkErrors.map((item) => item.url), ["http://h/favicon.icon", "http://h/models/player.vrm"]);
  diagnostics.stop();
  assert.equal(cdp.count("Network.responseReceived"), 0);
  notFound("http://h/later.png");
  assert.equal(diagnostics.errors.length, 2);
});

// Like the vendored launchChrome object: close() returns at once when it has been called before, and removes the
// profile only when the (possibly slow) shutdown has finished.
function fakeChrome({ closeNever = false, closeMs = 0 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-fake-profile-"));
  const chrome = { profile, closed: 0, killed: 0, child: { kill() { chrome.killed += 1; } } };
  let called = false;
  chrome.close = async () => {
    if (called) return;
    called = true;
    if (closeNever) await new Promise(() => {});
    if (closeMs > 0) await new Promise((resolve) => setTimeout(resolve, closeMs));
    chrome.closed += 1;
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return chrome;
}

test("the cleanup registry installs signal handlers only while something is open and removes them afterwards", async () => {
  const fake = new EventEmitter();
  const registry = createCleanupRegistry({ processImpl: fake, exit: () => {}, platform: "win32" });
  const signals = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  const listeners = () => signals.map((signal) => fake.listenerCount(signal));
  assert.deepEqual(listeners(), [0, 0, 0, 0]);
  assert.equal(registry.installed, false);

  const first = registry.trackChrome(fakeChrome());
  const second = registry.trackChrome(fakeChrome());
  assert.deepEqual(listeners(), [1, 1, 1, 1], "one handler per signal however many things are open");
  await first.close();
  assert.deepEqual(listeners(), [1, 1, 1, 1], "still one thing open");
  await second.close();
  assert.deepEqual(listeners(), [0, 0, 0, 0]);
  assert.equal(registry.size, 0);

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-fake-folder-"));
  registry.trackFolder(folder);
  assert.deepEqual(listeners(), [1, 1, 1, 1]);
  registry.untrackFolder(folder);
  assert.deepEqual(listeners(), [0, 0, 0, 0]);
  fs.rmSync(folder, { recursive: true, force: true });

  // SIGBREAK exists on Windows only
  const posix = new EventEmitter();
  const posixRegistry = createCleanupRegistry({ processImpl: posix, exit: () => {}, platform: "linux" });
  const chrome = posixRegistry.trackChrome(fakeChrome());
  assert.deepEqual(signals.map((signal) => posix.listenerCount(signal)), [1, 1, 0, 1]);
  await chrome.close();
});

test("cleanup() closes every Chrome, removes the temp folders and the handlers", async () => {
  const fake = new EventEmitter();
  const registry = createCleanupRegistry({ processImpl: fake, exit: () => {}, platform: "linux" });
  const chromes = [fakeChrome(), fakeChrome()];
  for (const chrome of chromes) registry.trackChrome(chrome);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-fake-folder-"));
  fs.writeFileSync(path.join(folder, "sheet.html"), "x");
  registry.trackFolder(folder);
  try {
    await registry.cleanup();
    assert.deepEqual(chromes.map((chrome) => chrome.closed), [1, 1]);
    assert.deepEqual(chromes.map((chrome) => fs.existsSync(chrome.profile)), [false, false]);
    assert.equal(fs.existsSync(folder), false);
    assert.equal(registry.size, 0);
    assert.equal(fake.listenerCount("SIGINT"), 0);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("a signal runs the cleanup once and exits with code 130; a Chrome that will not close is killed after the limit", async () => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    const fake = new EventEmitter();
    const exits = [];
    let exitNow;
    const exited = new Promise((resolve) => { exitNow = resolve; });
    const registry = createCleanupRegistry({ processImpl: fake, exit: (code) => { exits.push(code); exitNow(); }, platform: "win32", limitMs: 100 });
    const stuck = fakeChrome({ closeNever: true });
    const fine = fakeChrome();
    registry.trackChrome(stuck);
    registry.trackChrome(fine);
    fake.emit(signal);
    fake.emit(signal);
    await exited;
    assert.deepEqual(exits, [130], signal);
    assert.equal(fine.closed, 1, `${signal}: the good Chrome was closed once`);
    assert.equal(stuck.killed, 1, `${signal}: the stuck Chrome was killed`);
    assert.equal(fs.existsSync(stuck.profile), false, `${signal}: its profile folder is gone`);
    assert.equal(registry.size, 0);
    assert.equal(fake.listenerCount(signal), 0, `${signal}: the handler removed itself`);
  }
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
      assert.deepEqual(Object.keys(shot.stats), ["mean", "std", "white", "black", "mode"]);
      const png = decodePng(fs.readFileSync(path.join(main, shot.file)));
      assert.deepEqual([png.width, png.height], [640, 360], shot.file);
    }
    assert.ok(report.shots[0].stats.white > 0.12 && report.shots[0].stats.white < 0.16, "the white square covers 1/7 of the red frame");
    assert.ok(report.shots[0].stats.mode < 0.9, "and keeps the red frame from counting as flat");
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
    assert.doesNotMatch(result.stdout, /^event/m, "without --event the output has no event block");
    assert.doesNotMatch(over.stdout, /^event/m);
  });

  // Fixture: smooth until window.__stutter(frames, ms) blocks the main thread for `ms` in each of `frames` frames.
  // Only assertions that machine load cannot break: the stall is real, so frames of at least 90 ms must be there;
  // nothing here asserts that an idle frame is fast.
  const stutterArgs = (...rest) => [`${base}/perf-event.html`, "--warmup", "0.5", "--size", "320x180", ...rest];

  it("perf.mjs --event reports the frames after a one-off event, counted from the event, and --p95 judges that window", async () => {
    const result = await run("perf.mjs", stutterArgs("--seconds", "5", "--event", "window.__stutter(6, 100)", "--event-at", "1", "--event-window", "1", "--p95", "50"));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const lines = "(\\d+\\.\\d) ms";
    assert.match(result.stdout, new RegExp(`^frames: (\\d+)\\np50: ${lines}\\np95: ${lines}\\np99: ${lines}\\nmax: ${lines}\\nrenderer: .+\\n` +
      `event: ran (\\d\\.\\d\\d) s into the recording, judged for the next 1 s\\nevent frames: (\\d+)\\nevent p50: ${lines}\\nevent p95: ${lines}\\nevent p99: ${lines}\\nevent max: ${lines}\\n` +
      "event frames over 34 ms: (\\d+)\\nevent slowest: (.+)\\n"));
    const field = (name) => Number(new RegExp(`^${name}: (\\d+(?:\\.\\d+)?)`, "m").exec(result.stdout)[1]);
    const ran = Number(/^event: ran (\d\.\d\d) s/m.exec(result.stdout)[1]);
    assert.ok(ran >= 1 && ran < 1.5, `the event ran ${ran} s into the recording (asked for 1)`);
    assert.ok(field("event frames") >= 6 && field("event frames") < field("frames"), "the window holds the six stalled frames and is smaller than the recording");
    assert.ok(field("event frames over 34 ms") >= 6, "all six stalled frames are counted in the window");
    assert.ok(field("event p95") >= 90 && field("event max") >= 90, "the stall shows in the window's p95 and max");
    assert.ok(field("p95") < field("event p95"), "six stalled frames of about 270 do not move the whole recording's p95");
    const slowest = [...result.stdout.match(/^event slowest: (.+)$/m)[1].matchAll(/\+(\d\.\d\d)s (\d+\.\d) ms/g)].map((match) => ({ time: Number(match[1]), interval: Number(match[2]) }));
    assert.equal(slowest.length, 5);
    for (const frame of slowest) {
      assert.ok(frame.interval >= 90, `slowest frame ${frame.interval} ms`);
      // Counted from the event: the stall lies in the first 0.7 s after it. Counted from the recording start (1 s earlier) these would read 1.1 s or more.
      assert.ok(frame.time > 0 && frame.time <= 1, `at +${frame.time}s`);
    }
    assert.match(result.stdout, /^FAIL event window p95 \d+\.\d ms is above the 50\.0 ms budget$/m);
    assert.doesNotMatch(result.stdout, /^FAIL p95/m);
    assert.ok(result.stdout.indexOf("event: ran") > result.stdout.indexOf("renderer:"), "the event block follows the whole-recording lines");
  });

  it("perf.mjs --event with a harmless event passes a lenient window budget, and --event-at and --event-window default", async () => {
    const result = await run("perf.mjs", stutterArgs("--seconds", "5", "--event", "0", "--p95", "5000"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^event: ran \d\.\d\d s into the recording, judged for the next 4 s$/m);
    assert.match(result.stdout, /^PASS event window p95 \d+\.\d ms is within the 5000\.0 ms budget$/m);
    assert.ok(Number(/^event frames: (\d+)/m.exec(result.stdout)[1]) > 20);
  });

  it("perf.mjs --event that throws prints FAIL event threw with the message, no statistics, and exits 1", async () => {
    const result = await run("perf.mjs", stutterArgs("--seconds", "5", "--event", "throw new Error('boom \"quoted\" `tick`')", "--p95", "5000"));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^FAIL event threw: boom "quoted" `tick`$/m);
    assert.doesNotMatch(result.stdout, /^(frames|event|PASS|FAIL p95)/m);
    const missing = await run("perf.mjs", stutterArgs("--seconds", "5", "--event", "window.__nothing.start()"));
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /^FAIL event threw: .*undefined/m);
  });

  it("perf.mjs --event with a syntax error is a setup error", async () => {
    const result = await run("perf.mjs", stutterArgs("--seconds", "2", "--event", "window.__stutter(", "--event-window", "1"));
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /^perf: SyntaxError/);
    assert.equal(result.stdout, "");
  });

  it("a missing texture and a failed fetch are page errors listed with URL and status; favicon.ico is not", async () => {
    const out = path.join(work, "missing-assets");
    const result = await run("shots.mjs", [`${base}/missing-assets.html`, "--out", out, "--size", "320x180", "--settle", "1"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^PASS grad /m, "the frame itself has content");
    assert.match(result.stderr, /page error: HTTP 404 .*\/textures\/gate_albedo\.png/);
    assert.match(result.stderr, /page error: HTTP 404 .*\/models\/optional-player\.vrm/);
    assert.doesNotMatch(result.stderr, /favicon/);
    const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
    assert.equal(report.errors.length, 2);
    const found = report.networkErrors.map(({ kind, url, status }) => ({ kind, url: url.replace(base, ""), status })).sort((x, y) => x.url.localeCompare(y.url));
    assert.deepEqual(found, [
      { kind: "http", url: "/models/optional-player.vrm", status: 404 },
      { kind: "http", url: "/textures/gate_albedo.png", status: 404 },
    ]);
    assert.deepEqual(report.ignoreUrl, []);
  });

  it("--ignore-url (repeatable) silences known optional assets and only those", async () => {
    const both = path.join(work, "ignored-both");
    const result = await run("shots.mjs", [`${base}/missing-assets.html`, "--out", both, "--size", "320x180", "--settle", "1", "--ignore-url", "gate_albedo.png", "--ignore-url", "optional-player.vrm"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(both, "shots.json"), "utf8"));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.ignoreUrl, ["gate_albedo.png", "optional-player.vrm"]);

    const one = await run("shots.mjs", [`${base}/missing-assets.html`, "--out", path.join(work, "ignored-one"), "--size", "320x180", "--settle", "1", "--ignore-url", "optional-player.vrm"]);
    assert.equal(one.status, 1, one.stdout + one.stderr);
    assert.match(one.stderr, /gate_albedo\.png/);
    assert.doesNotMatch(one.stderr, /optional-player/);
    assert.equal((await run("shots.mjs", [`${base}/missing-assets.html`, "--out", path.join(work, "x"), "--ignore-url"], 20_000)).status, 2);
  });

  it("the automatic /favicon.ico request, which the server answers with 404, is not a page error", async () => {
    const result = await run("shots.mjs", [`${base}/favicon-only.html`, "--out", path.join(work, "favicon"), "--size", "320x180", "--settle", "1"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  it("an async ready() that resolves false keeps waiting until --timeout and exits 2", async () => {
    const started = Date.now();
    const result = await run("shots.mjs", [`${base}/ready-async-false.html`, "--out", path.join(work, "async-false"), "--timeout", "3"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /shots: window\.__shots\.ready\(\) did not return true within 3 s \(waiting: ready\(\) returned false/);
    assert.ok(Date.now() - started >= 3000, "it waited the whole timeout");
    assert.equal(fs.existsSync(path.join(work, "async-false", "shots.json")), false, "no capture happened");
  });

  it("an async ready() that resolves true is ready, and a truthy value that is not true is not", async () => {
    const good = await run("shots.mjs", [`${base}/ready-async-true.html`, "--out", path.join(work, "async-true"), "--size", "320x180", "--settle", "1", "--timeout", "10"]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /^PASS grad /m);
    const truthy = await run("shots.mjs", [`${base}/ready-truthy.html`, "--out", path.join(work, "truthy"), "--timeout", "2"]);
    assert.equal(truthy.status, 2);
    assert.match(truthy.stderr, /ready\(\) returned "yes", it must be exactly true/);
  });

  it("perf.mjs fails on page errors with or without --p95, and --ignore-url applies", async () => {
    const plain = await run("perf.mjs", [`${base}/errors.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180"]);
    assert.equal(plain.status, 1, plain.stdout + plain.stderr);
    assert.match(plain.stdout, /^FAIL page errors: 2 /m);
    assert.match(plain.stderr, /perf: page error: fixture console error/);
    assert.match(plain.stderr, /perf: page error: Error: fixture uncaught error/);
    const budget = await run("perf.mjs", [`${base}/errors.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180", "--p95", "1000"]);
    assert.equal(budget.status, 1, "a generous --p95 no longer hides a page that threw");
    assert.match(budget.stdout, /^FAIL page errors: 2 /m);
    assert.match(budget.stdout, /^PASS p95 /m);

    const missing = await run("perf.mjs", [`${base}/missing-assets.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180"]);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /perf: page error: HTTP 404 .*gate_albedo\.png/);
    const ignored = await run("perf.mjs", [`${base}/missing-assets.html`, "--seconds", "1", "--warmup", "0", "--size", "320x180", "--ignore-url", "gate_albedo.png", "--ignore-url", "optional-player.vrm"]);
    assert.equal(ignored.status, 0, ignored.stdout + ignored.stderr);
    assert.doesNotMatch(ignored.stdout, /FAIL/);
  });
});

test("a signal during a close that is already under way waits for that close instead of exiting early", async () => {
  const fake = new EventEmitter();
  const seen = [];
  let exitNow;
  const exited = new Promise((resolve) => { exitNow = resolve; });
  const registry = createCleanupRegistry({ processImpl: fake, exit: (code) => { seen.push({ code, profileLeft: fs.existsSync(chrome.profile) }); exitNow(); }, platform: "linux", limitMs: 5000 });
  const chrome = registry.trackChrome(fakeChrome({ closeMs: 300 }));
  const first = chrome.close();
  assert.equal(chrome.close(), first, "every caller gets the same close promise");
  await new Promise((resolve) => setTimeout(resolve, 30)); // the signal lands while the shutdown is still running
  fake.emit("SIGINT");
  await exited;
  await first;
  assert.deepEqual(seen, [{ code: 130, profileLeft: false }], "the profile was removed before exit was called");
  assert.equal(chrome.closed, 1);
  assert.equal(chrome.killed, 0, "a close that finishes in time is not followed by a kill");
  assert.equal(registry.size, 0);
  assert.equal(fake.listenerCount("SIGINT"), 0);
});
