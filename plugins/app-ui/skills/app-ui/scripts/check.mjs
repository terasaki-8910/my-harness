#!/usr/bin/env node
// Check the screens of a phone-app flow at a phone viewport in headless Chrome.
//
// Usage: check.mjs <flow.json> [--device ios|android] [--size WxH] [--min-text N] [--timeout s] [--only id,id] [--report file]
//
//   flow.json     screens in order (see templates/flow.json.tmpl): { device?, designMd?, screens: [{ id, label,
//                 file | url, tap | tapText?, next? }] }. Files are served over HTTP from the flow.json folder.
//   --device      ios (390x844, 3x, 44 pt targets) or android (412x915, 2.625x, 48 dp targets). Default: the flow's
//                 "device", else ios.
//   --size WxH    override width and height only.
//   --min-text N  smallest font size in px that does not warn (default 11).
//   --timeout s   seconds a screen may take to become ready (default 20).
//   --only a,b    check only these screen ids.
//   --report f    write a JSON report: { device, width, height, flow, designMd, screens: [{ id, label, file,
//                 fail, warn, info }], fail, warn }.
//
// Each screen is opened with phone emulation (mobile, touch, device scale factor). It is ready when the load event
// has fired, document.fonts.ready has resolved, window.__appReady (if the page defines it) is exactly true, the network
// has been quiet for 500 ms and two animation frames have passed; otherwise FAIL load.
// FAIL: load, console, request, image, overflow, viewport-meta, tap. WARN: target, text-size, contrast, fixed-cover,
// safe-area, primary and, with a DESIGN.md, token-color, token-font, token-size, token-radius; placeholder, emoji.
// Exit 0: no FAIL (WARN allowed). Exit 1: at least one FAIL. Exit 2: usage or setup error (bad flow.json, DESIGN.md that
// does not parse, Chrome not found). Ctrl+C closes Chrome and removes its profile (exit 130).
import fs from "node:fs";
import path from "node:path";
import { UsageError, parseCheckArgs, resolveDevice } from "./lib/args.mjs";
import { collectScreen, openScreen, startBrowser } from "./lib/browser.mjs";
import { crossScreenLine, decideScreen, formatFinding, infoLines } from "./lib/decide.mjs";
import { parseDesignMd } from "./lib/designmd.mjs";
import { loadFlow } from "./lib/flow.mjs";
import { startServer } from "./lib/server.mjs";

const NEEDS_HUMAN = [
  "the first screen says what the app is for",
  "one dominant element per screen",
  "each step's primary action is obvious and leads to the next screen",
  "platform conventions are followed",
  "the content is real",
  "the brief's banned looks are absent",
  "the twist is visible",
];

function loadDesign(file) {
  if (!file) return null;
  try {
    return parseDesignMd(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new UsageError(error.message.split(/\r?\n/, 1)[0]);
  }
}

async function main() {
  const args = parseCheckArgs(process.argv.slice(2));
  const flow = loadFlow(args.flow);
  const device = resolveDevice({ flowDevice: flow.device, device: args.device, size: args.size });
  const design = loadDesign(flow.designMd);
  let screens = flow.screens;
  if (args.only) {
    const unknown = args.only.filter((id) => !screens.some((screen) => screen.id === id));
    if (unknown.length > 0) throw new UsageError(`--only names unknown screen(s): ${unknown.join(", ")}`);
    screens = screens.filter((screen) => args.only.includes(screen.id));
  }

  const browser = startBrowser({ width: device.width, height: device.height });
  let server = null;
  const results = [];
  try {
    if (screens.some((screen) => screen.abs)) server = await startServer(flow.dir);
    const tokenColors = design ? Object.entries(design.colors).map(([name, value]) => ({ name, value })) : [];
    for (const screen of screens) {
      const localOrigin = server ? `http://127.0.0.1:${server.port}` : null;
      const url = screen.url ?? `${localOrigin}/${screen.urlPath}`;
      process.stdout.write(`\n== ${screen.id} ${screen.label} (${device.width}x${device.height} ${device.name})\n`);
      const opened = await openScreen(browser, { url, device, timeout: args.timeout });
      let page = null;
      let loadError = opened.loadError;
      try {
        if (!loadError) page = await collectScreen(browser, opened, { tap: screen.tap ?? undefined, tapText: screen.tapText ?? undefined, tokenColors });
      } catch (error) {
        loadError = `could not inspect the page: ${error.message.split(/\r?\n/, 1)[0]}`;
      } finally {
        await opened.close();
      }
      const ownOrigins = [localOrigin, screen.url ? new URL(screen.url).origin : null].filter(Boolean);
      const decision = decideScreen({ loadError, diagnostics: opened.diagnostics, page }, { device, minText: args.minText, screen, designMd: design, ownOrigins });
      for (const finding of decision.fail) process.stdout.write(`${formatFinding("FAIL", finding)}\n`);
      for (const finding of decision.warn) process.stdout.write(`${formatFinding("WARN", finding)}\n`);
      if (!loadError) for (const line of infoLines(decision.info)) process.stdout.write(`${line}\n`);
      results.push({ screen, decision, loadError });
    }
  } finally {
    await browser.close();
    await server?.close().catch(() => {});
  }

  const cross = crossScreenLine(results.filter((item) => !item.loadError).map((item) => ({ id: item.screen.id, info: item.decision.info })));
  if (cross) process.stdout.write(`\n${cross}\n`);
  const failCount = results.reduce((sum, item) => sum + item.decision.fail.length, 0);
  const warnCount = results.reduce((sum, item) => sum + item.decision.warn.length, 0);
  process.stdout.write(`\n${failCount} FAIL, ${warnCount} WARN\n`);
  process.stdout.write(`\nNEEDS HUMAN\n${NEEDS_HUMAN.map((line) => `- ${line}`).join("\n")}\n`);

  if (args.report) {
    const report = {
      device: device.name,
      width: device.width,
      height: device.height,
      flow: flow.file.replaceAll("\\", "/"),
      designMd: flow.designMd ? flow.designMd.replaceAll("\\", "/") : null,
      screens: results.map(({ screen, decision }) => ({
        id: screen.id, label: screen.label, file: screen.file ?? screen.url, fail: decision.fail, warn: decision.warn, info: decision.info,
      })),
      fail: failCount,
      warn: warnCount,
      crossScreen: cross,
    };
    const output = path.resolve(args.report);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\nreport: ${output.replaceAll("\\", "/")}\n`);
  }
  process.exitCode = failCount > 0 ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`check: ${error.message}\n`);
  process.exitCode = 2;
}
