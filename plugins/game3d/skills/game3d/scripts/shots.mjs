#!/usr/bin/env node
// Fixed-camera screenshots of a web game, with blank-frame detection and a contact sheet.
//
// Usage: shots.mjs <url> --out <dir> [--size 1600x900] [--backend auto|default|gl|d3d11|metal|swiftshader]
//                  [--headed] [--dpr 1] [--only id1,id2] [--settle 3] [--timeout 60] [--ignore-url <substring>]...
//
// Page contract: the page defines
//   window.__shots = {
//     ready(): boolean | Promise<boolean>,   // must be exactly true; anything else keeps waiting until --timeout
//     list(): Array<string | { id: string, label?: string }> | Promise<that>,
//     show(id: string): void | Promise<void>,
//   }
// `show` puts the scene into a fixed state for that shot (time frozen), so the same build gives the same image.
//
// Writes <dir>/NN-<id>.png per shot, <dir>/shots.json and <dir>/sheet.png (contact sheet).
// Prints PASS/FAIL per shot, the WebGL renderer string and the output paths.
// Page errors are console errors, uncaught exceptions, failed resource loads (Network.loadingFailed except
// canceled requests), responses with HTTP status >= 400 and Log entries of level error. /favicon.ico is
// ignored; --ignore-url <substring> (repeatable) also ignores requests whose URL contains it, for known
// optional assets such as a player.vrm the game probes for. shots.json lists each request error with its
// URL and status under "networkErrors".
// Exit 0: every shot has content and the page logged no errors. Exit 1: a shot is blank (white, black,
// uniform or flat, see frames.mjs) or the page logged errors. Exit 2: setup problem (no Chrome, contract
// missing, timeout, bad arguments).
//
// --backend auto means gl on Windows, swiftshader on Linux, default on macOS. Headless Chrome with ANGLE's
// D3D11 backend rendered all-white frames of WebGL games on Windows, so check the renderer line.
import fs from "node:fs";
import path from "node:path";
import { blankReason, frameStats, toSlash } from "./lib/frames.mjs";
import { BACKENDS, evaluate, htmlToPng, openGamePage, parseNumber, parseSize, resolveBackend, sleep, takeValue } from "./lib/page.mjs";
import { decodePng } from "./lib/png.mjs";
import { pngDataUri, safeFilePart, sheetHtml } from "./lib/sheet.mjs";

const USAGE = "Usage: shots.mjs <url> --out <dir> [--size 1600x900] [--backend auto|default|gl|d3d11|metal|swiftshader] [--headed] [--dpr 1] [--only id1,id2] [--settle 3] [--timeout 60] [--ignore-url <substring>]...";
const CONTRACT = "window.__shots = { ready(): boolean | Promise<boolean>, list(): Array<string | { id: string, label?: string }> | Promise<that>, show(id: string): void | Promise<void> }";

function parseArguments(argv) {
  const result = { url: null, out: null, size: "1600x900", backend: "auto", headed: false, dpr: 1, only: null, settle: 3, timeout: 60, ignoreUrl: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headed") result.headed = true;
    else if (argument === "--out") result.out = takeValue(argv, index++, argument);
    else if (argument === "--size") result.size = takeValue(argv, index++, argument);
    else if (argument === "--backend") result.backend = takeValue(argv, index++, argument);
    else if (argument === "--dpr") result.dpr = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument === "--only") result.only = takeValue(argv, index++, argument).split(",").map((id) => id.trim()).filter(Boolean);
    else if (argument === "--settle") result.settle = parseNumber(takeValue(argv, index++, argument), argument, { integer: true });
    else if (argument === "--timeout") result.timeout = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument === "--ignore-url") result.ignoreUrl.push(takeValue(argv, index++, argument));
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
    else if (result.url === null) result.url = argument;
    else throw new Error(`Unexpected argument: ${argument}\n${USAGE}`);
  }
  if (!result.url) throw new Error(USAGE);
  if (!result.out) throw new Error(`--out <dir> is required\n${USAGE}`);
  try { new URL(result.url); } catch { throw new Error(`Not a URL: ${result.url} (serve local files over http first)`); }
  if (!BACKENDS.includes(result.backend)) throw new Error(`Unknown backend "${result.backend}". Use one of: ${BACKENDS.join(", ")}`);
  if (result.only && result.only.length === 0) throw new Error("--only needs at least one shot id");
  return { ...result, ...parseSize(result.size) };
}

// Evaluated in the page; `waitMs` bounds how long one probe waits for an async ready(). One call of ready() is
// in flight at a time (kept on window), so a slow async ready() is not started again on every poll.
const readyProbe = (waitMs) => `(async () => {
  const shots = window.__shots;
  if (!shots) return "missing";
  for (const name of ["ready", "list", "show"]) if (typeof shots[name] !== "function") return "invalid: window.__shots." + name + " is not a function";
  try {
    if (!window.__game3dReady) {
      window.__game3dReady = Promise.resolve()
        .then(() => shots.ready())
        .then((value) => ({ value }), (error) => ({ failed: true, error }))
        .finally(() => { window.__game3dReady = null; });
    }
    const outcome = await Promise.race([window.__game3dReady, new Promise((resolve) => setTimeout(() => resolve({ pending: true }), ${waitMs}))]);
    if (outcome.pending) return "waiting: ready() has not settled yet";
    if (outcome.failed) return "error: " + ((outcome.error && outcome.error.message) || outcome.error);
    if (outcome.value === true) return "ready";
    return "waiting: ready() returned " + (typeof outcome.value === "string" ? JSON.stringify(outcome.value) : String(outcome.value)) + ", it must be exactly true";
  } catch (error) { return "error: " + ((error && error.message) || error); }
})()`;

async function waitForContract(cdp, sessionId, timeout) {
  const started = Date.now();
  let state = "missing";
  for (;;) {
    const remaining = timeout * 1000 - (Date.now() - started);
    try {
      state = await evaluate(cdp, sessionId, readyProbe(Math.max(50, Math.min(1000, remaining))), 10);
    } catch (error) {
      if (/pipe is closed|Chrome exited/.test(error.message)) throw error;
      state = `waiting: ${error.message}`;
    }
    if (state === "ready") return;
    if (Date.now() - started >= timeout * 1000) break;
    await sleep(50);
  }
  if (state === "missing") throw new Error(`The page does not define window.__shots (waited ${timeout} s). Contract: ${CONTRACT}`);
  if (state.startsWith("invalid")) throw new Error(`${state}. Contract: ${CONTRACT}`);
  throw new Error(`window.__shots.ready() did not return true within ${timeout} s (${state})`);
}

function normalizeList(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`window.__shots.list() must return a non-empty array. Contract: ${CONTRACT}`);
  const seen = new Set();
  return raw.map((item, index) => {
    const id = typeof item === "string" ? item : item?.id;
    if (typeof id !== "string" || id === "") throw new Error(`window.__shots.list() item ${index} has no string id. Contract: ${CONTRACT}`);
    if (seen.has(id)) throw new Error(`window.__shots.list() contains the id "${id}" twice`);
    seen.add(id);
    return { id, label: typeof item === "object" && typeof item.label === "string" && item.label !== "" ? item.label : id };
  });
}

const fixed = (value) => value.toFixed(3);
const settleExpression = (frames) => `new Promise((resolve) => { let left = ${frames}; const step = () => { if (left-- <= 0) resolve(); else requestAnimationFrame(step); }; step(); })`;

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const out = path.resolve(args.out);
  const callTimeout = Math.max(args.timeout, 10);
  const opened = await openGamePage({ url: args.url, width: args.width, height: args.height, backend: args.backend, headed: args.headed, dpr: args.dpr, ignoreUrl: args.ignoreUrl });
  const { chrome, sessionId } = opened;
  const shots = [];
  try {
    await waitForContract(chrome.cdp, sessionId, args.timeout);
    let list = normalizeList(await evaluate(chrome.cdp, sessionId, "Promise.resolve(window.__shots.list())", callTimeout));
    if (args.only) {
      const unknown = args.only.filter((id) => !list.some((shot) => shot.id === id));
      if (unknown.length > 0) throw new Error(`Unknown shot id in --only: ${unknown.join(", ")}. The page lists: ${list.map((shot) => shot.id).join(", ")}`);
      list = list.filter((shot) => args.only.includes(shot.id));
    }
    await fs.promises.mkdir(out, { recursive: true });
    for (const [index, shot] of list.entries()) {
      await evaluate(chrome.cdp, sessionId, `(async () => { await window.__shots.show(${JSON.stringify(shot.id)}); })()`, callTimeout);
      await evaluate(chrome.cdp, sessionId, settleExpression(args.settle), callTimeout);
      const screenshot = await chrome.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId, { timeout: 60 });
      const png = Buffer.from(screenshot.data, "base64");
      const file = `${String(index + 1).padStart(2, "0")}-${safeFilePart(shot.id, `shot-${index + 1}`)}.png`;
      await fs.promises.writeFile(path.join(out, file), png);
      const stats = frameStats(decodePng(png));
      shots.push({ id: shot.id, label: shot.label, file, stats, blank: blankReason(stats) });
    }
  } finally {
    await chrome.close();
  }
  const { renderer, chromeVersion, diagnostics } = opened;
  const report = {
    url: args.url, size: [args.width, args.height], dpr: args.dpr, backend: args.backend, headed: args.headed,
    renderer, chromeVersion, date: new Date().toISOString(), shots,
    errors: diagnostics.errors, networkErrors: diagnostics.networkErrors, ignoreUrl: args.ignoreUrl,
  };
  const reportPath = path.join(out, "shots.json");
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const tiles = [];
  for (const shot of shots) {
    tiles.push({ id: shot.id, label: shot.label, note: shot.blank ? `FAIL ${shot.blank}` : "", src: pngDataUri(await fs.promises.readFile(path.join(out, shot.file))) });
  }
  const sheetPath = path.join(out, "sheet.png");
  const subtitle = `${renderer} | ${args.width}x${args.height} @${args.dpr}x | backend ${args.backend} (${resolveBackend(args.backend)}) | ${args.headed ? "headed" : "headless"} | ${chromeVersion}`;
  await fs.promises.writeFile(sheetPath, await htmlToPng(sheetHtml({ title: args.url, subtitle, tiles })));

  for (const shot of shots) {
    process.stdout.write(`${shot.blank ? `FAIL ${shot.id} ${shot.blank}` : `PASS ${shot.id}`} mean=${fixed(shot.stats.mean)} std=${fixed(shot.stats.std)}\n`);
  }
  process.stdout.write(`renderer: ${renderer}\n${toSlash(reportPath)}\n${toSlash(sheetPath)}\n`);
  for (const error of diagnostics.errors) process.stderr.write(`shots: page error: ${error.split(/\r?\n/, 1)[0]}\n`);
  process.exitCode = shots.some((shot) => shot.blank) || diagnostics.errors.length > 0 ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`shots: ${error.message}\n`);
  process.exitCode = 2;
}
