#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachPage } from "./lib/cdp.mjs";
import { findChrome, findFfmpeg, launchChrome, runProcess } from "./lib/chrome.mjs";
import { sheetHtml } from "./lib/review.mjs";
import { startServer } from "./lib/server.mjs";
import { resolveVariant, validate } from "./lib/timeline.mjs";

function number(argument, name, { positive = false } = {}) {
  const value = Number(argument);
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new Error(`${name} needs a ${positive ? "positive" : "non-negative"} number`);
  return value;
}

function parseArguments(argv) {
  const result = { config: null, file: null, variant: null, fps: 4, from: null, to: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--file") result.file = argv[++index];
    else if (argument === "--variant") result.variant = argv[++index];
    else if (argument === "--fps") result.fps = number(argv[++index], "--fps", { positive: true });
    else if (argument === "--from") result.from = number(argv[++index], "--from");
    else if (argument === "--to") result.to = number(argv[++index], "--to");
    else if (!result.config) result.config = argument;
    else throw new Error(`Unknown argument: ${argument}`);
    if (["--file", "--variant", "--fps", "--from", "--to"].includes(argument) && argv[index] === undefined) throw new Error(`${argument} needs a value`);
  }
  if (!result.config) throw new Error("Usage: review.mjs <video.json> [--variant name] [--file x.mp4] [--fps 4] [--from s] [--to s]");
  if (result.from !== null && result.to !== null && result.to <= result.from) throw new Error("--to must be greater than --from");
  return result;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function waitForEvent(cdp, method, sessionId, milliseconds) {
  return withTimeout(new Promise((resolve) => {
    const off = cdp.on(method, (params, eventSessionId) => {
      if (eventSessionId === sessionId) {
        off();
        resolve(params);
      }
    });
  }), milliseconds, `Timed out waiting for ${method}`);
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Page evaluation failed");
  return response.result?.value;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const configDirectory = path.dirname(configPath);
  const raw = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
  const { spec, errors } = validate(resolveVariant(raw, args.variant));
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`video.json: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  const file = path.resolve(configDirectory, args.file ?? spec.out);
  const base = file.toLowerCase().endsWith(".mp4") ? file.slice(0, -4) : file;
  const directory = `${base}.review`;
  await fs.promises.rm(directory, { recursive: true, force: true });
  await fs.promises.mkdir(directory, { recursive: true });

  const tools = await findFfmpeg({ env: process.env });
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "demo-video-review-"));
  let server;
  let chrome;
  try {
    const from = args.from ?? 0;
    const command = ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(from)];
    if (args.to !== null) command.push("-to", String(args.to));
    command.push("-copyts", "-i", file, "-vf", `fps=${args.fps},scale=384:-2`, path.join(temporary, "f_%05d.png"));
    await runProcess(tools.ffmpeg, command);

    const names = (await fs.promises.readdir(temporary)).filter((name) => /^f_\d+\.png$/.test(name)).toSorted();
    if (names.length === 0) throw new Error("ffmpeg extracted no review frames");
    const frames = names.map((name, index) => ({ src: name, time: from + index / args.fps }));
    const groups = [];
    for (let index = 0; index < frames.length; index += 25) groups.push(frames.slice(index, index + 25));
    for (let index = 0; index < groups.length; index += 1) {
      await fs.promises.writeFile(path.join(temporary, `sheet_${String(index + 1).padStart(2, "0")}.html`), sheetHtml({ frames: groups[index], cols: 5, tileWidth: 384 }));
    }

    server = await startServer(temporary);
    const chromePath = findChrome({ env: process.env, platform: process.platform });
    chrome = launchChrome(chromePath, { width: 1936, height: 800 });
    const sessionId = await attachPage(chrome.cdp);
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1936, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId),
    ]);

    for (let index = 0; index < groups.length; index += 1) {
      const number = String(index + 1).padStart(2, "0");
      const loaded = waitForEvent(chrome.cdp, "Page.loadEventFired", sessionId, 30_000);
      await chrome.cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/sheet_${number}.html` }, sessionId);
      await loaded;
      await evaluate(chrome.cdp, sessionId, "(async()=>{await Promise.all([...document.images].map(image=>image.decode()));if(document.fonts)await document.fonts.ready})()");
      const size = await evaluate(chrome.cdp, sessionId, "(()=>{const rect=document.querySelector('.sheet').getBoundingClientRect();return {width:Math.ceil(rect.width),height:Math.ceil(rect.height)}})()");
      if (!Number.isInteger(size?.width) || size.width <= 0 || !Number.isInteger(size?.height) || size.height <= 0) throw new Error(`Invalid review sheet size: ${JSON.stringify(size)}`);
      await chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate(chrome.cdp, sessionId, "new Promise(resolve=>requestAnimationFrame(()=>resolve()))");
      const screenshot = await chrome.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
      const output = path.join(directory, `sheet_${number}.png`);
      await fs.promises.writeFile(output, Buffer.from(screenshot.data, "base64"));
      process.stdout.write(`${output}\n`);
    }
    process.stdout.write(`${args.fps} fps; 25 frames per sheet\n`);
  } finally {
    await Promise.allSettled([chrome?.close(), server?.close()]);
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`review: ${error.message}\n`);
  process.exitCode = 1;
}
