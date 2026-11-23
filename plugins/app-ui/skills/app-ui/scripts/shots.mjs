#!/usr/bin/env node
// Phone screenshots of a flow, with blank-frame detection and a flow sheet.
//
// Usage: shots.mjs <flow.json> [--device ios|android] [--size WxH] [--dpr N] [--out dir] [--full] [--timeout s]
//
//   flow.json   as for check.mjs.
//   --dpr N     device scale factor of the screenshots (default 2; the device preset's own factor is not used).
//   --out dir   output folder (default app-shots).
//   --full      also save <nn>-<id>-full.png, the whole page.
//   --timeout s seconds a screen may take to become ready (default 20).
//
// Writes, in flow order, <out>/<nn>-<id>.png (the viewport; when a screen's tap target lies outside the first
// viewport the page is scrolled to centre it and the scroll position is recorded), <out>/sheet.png (the flow sheet:
// every screen in a row of at most 5 with "label (id)" above it, the tap target outlined, an arrow where "next" names
// the following screen) and <out>/shots.json { device, width, height, dpr, screens: [{ id, label, png, full, tap,
// scrollY, blank }] } (plus "errors" and "stats" per screen). Each PNG is decoded and tested with the blank-frame
// check of frames.mjs (white, black, uniform, or flat at 97 percent of samples on one level).
// Prints one line per screen and the path of sheet.png.
// Exit 0: every shot has content and no screen logged a page error (console error, uncaught exception, failed request,
// load failure). Exit 1: a blank shot or a page error; the files are still written and the errors are listed.
// Exit 2: usage or setup error (bad flow.json, Chrome not found). Ctrl+C closes Chrome (exit 130).
import fs from "node:fs";
import path from "node:path";
import { UsageError, parseShotsArgs, resolveDevice } from "./lib/args.mjs";
import { collectScreen, evaluate, openScreen, startBrowser } from "./lib/browser.mjs";
import { decideScreen } from "./lib/decide.mjs";
import { loadFlow } from "./lib/flow.mjs";
import { blankReason, frameStats, toSlash } from "./lib/frames.mjs";
import { decodePng } from "./lib/png.mjs";
import { startServer } from "./lib/server.mjs";
import { sheetHtml } from "./lib/sheet.mjs";

const PAGE_ERROR_CODES = new Set(["load", "console", "request"]);
const SHEET_SCALE = 2;
// game3d's "flat" limit (0.9) flags sparse but finished app screens: a sign-in and a confirmation measured mode
// 0.936 and 0.934 (iOS, dpr 2, 2026-11-23). A screen with only a 64 px top bar measured 0.925, so mode cannot tell
// it from them; it passes, and the sheet must show it. A lone spinner is still caught (white 0.999).
const BLANK_OPTIONS = { maxMode: 0.97 };
const fixed = (value) => value.toFixed(3);

async function scrollTapIntoView(browser, opened, collected) {
  const tap = collected.tap;
  if (!tap || !tap.rect || tap.visibleCount !== 1 || tap.inFixed) return;
  const height = collected.doc.clientHeight ?? collected.doc.innerHeight;
  if (tap.rect.y + tap.rect.height <= height) return;
  const top = Math.max(0, tap.rect.y + tap.rect.height / 2 - height / 2);
  await evaluate(browser.cdp, opened.sessionId, `(async () => {
    window.scrollTo({ top: ${JSON.stringify(top)}, left: 0, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
}

async function renderSheet(browser, html, file) {
  const { targetId } = await browser.cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    const send = (method, params) => browser.cdp.send(method, params, sessionId, { timeout: 60 });
    await send("Page.enable", {});
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: SHEET_SCALE, mobile: false });
    const { frameTree } = await send("Page.getFrameTree", {});
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
    await evaluate(browser.cdp, sessionId, "Promise.all([...document.images].map((image) => image.decode().catch(() => {}))).then(() => document.fonts.ready).then(() => true)", 60);
    const size = await evaluate(browser.cdp, sessionId, "({ width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.documentElement.scrollHeight) })");
    await send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: SHEET_SCALE, mobile: false });
    await evaluate(browser.cdp, sessionId, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  } finally {
    await browser.cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function main() {
  const args = parseShotsArgs(process.argv.slice(2));
  const flow = loadFlow(args.flow);
  const device = resolveDevice({ flowDevice: flow.device, device: args.device, size: args.size });
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });

  const browser = startBrowser({ width: device.width, height: device.height });
  let server = null;
  const shots = [];
  const tiles = [];
  let sheetPath = null;
  try {
    if (flow.screens.some((screen) => screen.abs)) server = await startServer(flow.dir);
    const localOrigin = server ? `http://127.0.0.1:${server.port}` : null;
    const screenDevice = { ...device, deviceScaleFactor: args.dpr };
    for (const [index, screen] of flow.screens.entries()) {
      const number = String(index + 1).padStart(2, "0");
      const url = screen.url ?? `${localOrigin}/${screen.urlPath}`;
      const entry = { id: screen.id, label: screen.label, png: null, full: null, tap: null, scrollY: 0, blank: null, stats: null, errors: [] };
      const tile = { id: screen.id, label: screen.label, src: null, tap: null, scrollY: 0, blank: null, error: null, nextIsFollowing: screen.next !== null && screen.next === flow.screens[index + 1]?.id };
      const opened = await openScreen(browser, { url, device: screenDevice, timeout: args.timeout });
      let loadError = opened.loadError;
      let collected = null;
      try {
        if (!loadError) {
          collected = await collectScreen(browser, opened, { tap: screen.tap ?? undefined, tapText: screen.tapText ?? undefined, tokenColors: [] });
          await scrollTapIntoView(browser, opened, collected);
          const state = await evaluate(browser.cdp, opened.sessionId, "({ scrollY: window.scrollY, clientWidth: (document.scrollingElement || document.documentElement).clientWidth, scrollHeight: (document.scrollingElement || document.documentElement).scrollHeight })");
          entry.scrollY = Math.round(state.scrollY * 100) / 100;
          tile.scrollY = entry.scrollY;
          const shot = await browser.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, opened.sessionId, { timeout: 60 });
          const png = Buffer.from(shot.data, "base64");
          entry.png = `${number}-${screen.id}.png`;
          fs.writeFileSync(path.join(out, entry.png), png);
          entry.stats = frameStats(decodePng(png));
          entry.blank = blankReason(entry.stats, BLANK_OPTIONS);
          tile.src = `data:image/png;base64,${png.toString("base64")}`;
          tile.blank = entry.blank;
          const rect = collected.tap?.rect;
          if (rect && collected.tap.visibleCount === 1) {
            entry.tap = { x: rect.x, y: collected.tap.inFixed ? rect.y : rect.y - entry.scrollY, width: rect.width, height: rect.height };
            tile.tap = entry.tap;
          }
          if (args.full) {
            const whole = await browser.cdp.send("Page.captureScreenshot", {
              format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: state.clientWidth, height: state.scrollHeight, scale: 1 },
            }, opened.sessionId, { timeout: 60 });
            entry.full = `${number}-${screen.id}-full.png`;
            fs.writeFileSync(path.join(out, entry.full), Buffer.from(whole.data, "base64"));
          }
        }
      } catch (error) {
        loadError = `could not capture the page: ${error.message.split(/\r?\n/, 1)[0]}`;
      } finally {
        await opened.close();
      }
      const ownOrigins = [localOrigin, screen.url ? new URL(screen.url).origin : null].filter(Boolean);
      const decision = decideScreen({ loadError, diagnostics: opened.diagnostics, page: loadError ? null : collected }, { device, minText: 11, screen: null, designMd: null, ownOrigins });
      entry.errors = decision.fail.filter((finding) => PAGE_ERROR_CODES.has(finding.code)).map((finding) => `${finding.code}: ${finding.message}`);
      if (loadError) tile.error = "did not load";
      shots.push(entry);
      tiles.push(tile);
    }

    const date = new Date().toISOString().slice(0, 10);
    sheetPath = path.join(out, "sheet.png");
    await renderSheet(browser, sheetHtml({ flowName: path.basename(flow.file), device: device.name, width: device.width, height: device.height, date, tiles }), sheetPath);
  } finally {
    await browser.close();
    await server?.close().catch(() => {});
  }

  const report = {
    device: device.name, width: device.width, height: device.height, dpr: args.dpr,
    screens: shots.map(({ id, label, png, full, tap, scrollY, blank, stats, errors }) => ({ id, label, png, full, tap, scrollY, blank, stats, errors })),
  };
  fs.writeFileSync(path.join(out, "shots.json"), `${JSON.stringify(report, null, 2)}\n`);

  for (const [index, shot] of shots.entries()) {
    const number = String(index + 1).padStart(2, "0");
    if (!shot.png) process.stdout.write(`FAIL ${number} ${shot.id} no screenshot\n`);
    else {
      const tail = `mean=${fixed(shot.stats.mean)} std=${fixed(shot.stats.std)} white=${fixed(shot.stats.white)} mode=${fixed(shot.stats.mode)} scrollY=${shot.scrollY}`;
      process.stdout.write(`${shot.blank ? `FAIL ${number} ${shot.id} blank (${shot.blank})` : `PASS ${number} ${shot.id}`} ${tail}\n`);
    }
    for (const error of shot.errors) process.stderr.write(`shots: ${shot.id}: ${error}\n`);
  }
  process.stdout.write(`${toSlash(path.join(out, "shots.json"))}\n${toSlash(sheetPath)}\n`);
  process.exitCode = shots.some((shot) => !shot.png || shot.blank || shot.errors.length > 0) ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`shots: ${error instanceof UsageError ? error.message : error.message}\n`);
  process.exitCode = 2;
}
