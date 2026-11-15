#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachPage } from "./lib/cdp.mjs";
import { findChrome, findFfmpeg, launchChrome, runProcess } from "./lib/chrome.mjs";
import { buildEncodeArgs } from "./lib/encode.mjs";
import { buildConcat, captureMotionMetrics } from "./lib/frames.mjs";
import { keyEvents } from "./lib/input.mjs";
import { startServer } from "./lib/server.mjs";
import { ease, lerpPoint, validate } from "./lib/timeline.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const now = () => performance.now() / 1000;

function usage() {
  return "Usage: render.mjs <video.json> [--out file] [--keep-frames]";
}

function parseArguments(argv) {
  const result = { file: null, out: null, keepFrames: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-frames") result.keepFrames = true;
    else if (argument === "--out") {
      result.out = argv[++index];
      if (!result.out) throw new Error("--out needs a file path");
    } else if (!result.file) result.file = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.file) throw new Error(usage());
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

async function evaluate(cdp, sessionId, expression, options = {}) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: options.awaitPromise ?? true }, sessionId, { timeout: options.timeout ?? 30 });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Page evaluation failed");
  return response.result?.value;
}

async function waitUntil(target) {
  const delay = target - now();
  if (delay > 0) await sleep(delay * 1000);
}

async function waitReady(cdp, sessionId, ready) {
  if (!ready) return;
  const deadline = now() + ready.timeout;
  while (now() < deadline) {
    if (await evaluate(cdp, sessionId, `Boolean(${ready.expression})`)) return;
    await sleep(100);
  }
  throw new Error(`ready expression was not truthy within ${ready.timeout} s: ${ready.expression}`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const configPath = path.resolve(args.file);
  const configDirectory = path.dirname(configPath);
  const raw = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
  const { spec, errors } = validate(raw);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`video.json: ${error}\n`);
    process.exitCode = 1;
    return;
  }

  let server;
  let chrome;
  let watchdogError;
  const abortController = new AbortController();
  const watchdogLimit = spec.duration + 90;
  const watchdogTimer = setTimeout(() => {
    watchdogError = new Error(`render exceeded watchdog limit of ${watchdogLimit} s`);
    abortController.abort(watchdogError);
    chrome?.cdp.close(watchdogError);
    if (chrome?.child.exitCode === null && chrome.child.signalCode === null) chrome.child.kill();
  }, watchdogLimit * 1000);

  try {
  const outPath = path.resolve(configDirectory, args.out ?? spec.out);
  // Remove the previous run's outputs first, so check.mjs can never pass a stale video
  // when this run fails before encoding (for example, Chrome or ffmpeg not found).
  const outBase = outPath.toLowerCase().endsWith(".mp4") ? outPath.slice(0, -4) : outPath;
  for (const stale of [outPath, `${outBase}.render.json`, `${outBase}.check.json`, `${outBase}.contact.png`, `${outBase}.frames`]) {
    await fs.promises.rm(stale, { recursive: true, force: true });
  }
  const toolchain = await findFfmpeg({ env: process.env, signal: abortController.signal });
  const chromePath = findChrome({ env: process.env, platform: process.platform });
  const frameDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "demo-video-frames-"));
  let renderError;
  const frames = [];
  const frameWrites = [];
  const consoleMessages = [];
  const actions = [];
  const mustShow = spec.mustShow.map((item) => ({ ...item, visibleSec: 0 }));
  let timestampSource = "metadata";
  let t0;
  let t0Epoch;
  let browserVersion = "unknown";
  let captureReadyForEncode = false;
  let polling = false;
  let pollingError;
  let actionRunning = false;
  let visibilitySample = Promise.resolve();
  let visibilityPolling = Promise.resolve();

  try {
    let pageUrl;
    if (/^https?:\/\//i.test(spec.page)) pageUrl = spec.page;
    else {
      const pagePath = path.resolve(configDirectory, spec.page);
      const rootPath = path.resolve(configDirectory, spec.root ?? path.dirname(spec.page));
      const relative = path.relative(rootPath, pagePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`page is outside root: ${spec.page}`);
      server = await startServer(rootPath);
      const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
      pageUrl = `http://127.0.0.1:${server.port}/${encoded}`;
    }

    chrome = launchChrome(chromePath, spec.viewport);
    const { cdp } = chrome;
    const version = await cdp.send("Browser.getVersion");
    browserVersion = version.product ?? "unknown";
    const sessionId = await attachPage(cdp);
    cdp.on("Runtime.consoleAPICalled", (params, eventSessionId) => {
      if (eventSessionId !== sessionId || params.type !== "error" || consoleMessages.length >= 20) return;
      const text = params.args?.map((item) => item.value ?? item.description ?? item.type).join(" ") ?? "console error";
      consoleMessages.push({ type: "error", text });
    });
    cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
      if (eventSessionId !== sessionId || consoleMessages.length >= 20) return;
      consoleMessages.push({ type: "exception", text: params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Uncaught exception" });
    });
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Runtime.enable", {}, sessionId),
      cdp.send("Emulation.setDeviceMetricsOverride", { ...spec.viewport, deviceScaleFactor: 1, mobile: false }, sessionId),
    ]);
    const helperSource = await fs.promises.readFile(path.join(scriptDirectory, "lib", "page-helpers.js"), "utf8");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: helperSource }, sessionId);
    const loaded = waitForEvent(cdp, "Page.loadEventFired", sessionId, 30_000);
    await cdp.send("Page.navigate", { url: pageUrl }, sessionId);
    await loaded;
    await evaluate(cdp, sessionId, "(async()=>{if(document.fonts)await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));})()", { awaitPromise: true, timeout: 15 });
    await evaluate(cdp, sessionId, `window.__demoVideo.init(${JSON.stringify(spec.cursor)})`);
    await waitReady(cdp, sessionId, spec.ready);
    await sleep(300);

    let firstFrameResolve;
    const firstFrame = new Promise((resolve) => { firstFrameResolve = resolve; });
    let frameNumber = 0;
    cdp.on("Page.screencastFrame", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => {});
      const receipt = Date.now() / 1000;
      const metadata = params.metadata?.timestamp;
      if (!Number.isFinite(metadata) || (frameNumber === 0 && Math.abs(metadata - receipt) > 1)) timestampSource = "receipt";
      frameNumber += 1;
      const file = path.join(frameDirectory, `f_${String(frameNumber).padStart(6, "0")}.jpg`);
      frames.push({ file, metadata, receipt });
      frameWrites.push(fs.promises.writeFile(file, Buffer.from(params.data, "base64")));
      firstFrameResolve();
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: spec.viewport.width, maxHeight: spec.viewport.height, everyNthFrame: 1 }, sessionId);
    try {
      await withTimeout(firstFrame, 1000, "No screencast frame arrived within 1 s");
    } catch {
      await evaluate(cdp, sessionId, "(()=>{const e=document.querySelector('#__demo-video-overlay');if(!e)return;const v=e.style.opacity;e.style.opacity='.999';requestAnimationFrame(()=>{e.style.opacity=v})})()", { awaitPromise: false });
      await withTimeout(firstFrame, 1000, "No screencast frame arrived after a visual nudge");
    }

    const initialVisibility = await evaluate(cdp, sessionId, "document.visibilityState");
    if (initialVisibility !== "visible") throw new Error(`page is ${initialVisibility} before the timeline started`);
    let sampledVisibility = await evaluate(cdp, sessionId, `window.__demoVideo.visible(${JSON.stringify(mustShow.map((item) => item.selector))})`);
    t0 = now();
    t0Epoch = Date.now() / 1000;
    let cursor = spec.cursor.start ? { x: spec.cursor.start[0], y: spec.cursor.start[1] } : { x: 0, y: 0 };
    if (spec.cursor.start) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...cursor }, sessionId);

    polling = true;
    visibilityPolling = (async () => {
      let previous = t0;
      let nextSample = t0 + 0.25;
      const credit = (current) => {
        const delta = Math.max(0, current - previous);
        sampledVisibility.forEach((value, index) => { if (value) mustShow[index].visibleSec += delta; });
        previous = current;
      };
      while (polling) {
        await waitUntil(nextSample);
        credit(now());
        if (!polling) break;
        if (!actionRunning) {
          visibilitySample = evaluate(cdp, sessionId, `window.__demoVideo.visible(${JSON.stringify(mustShow.map((item) => item.selector))})`);
          const nextVisibility = await visibilitySample;
          credit(now());
          sampledVisibility = nextVisibility;
          visibilitySample = Promise.resolve();
        }
        nextSample += 0.25;
        if (nextSample < now()) nextSample = now() + 0.25;
      }
    })().catch((error) => { pollingError = error; });

    async function move(action) {
      let target;
      if (action.to) {
        target = await evaluate(cdp, sessionId, `window.__demoVideo.point(${JSON.stringify(action.to)},${JSON.stringify(action.anchor)})`);
        if (!target) throw new Error(`${action.to} is missing or has zero size at ${(now() - t0).toFixed(1)} s`);
        if (target.offscreen) throw new Error(`${action.to} is off screen at ${(now() - t0).toFixed(1)} s; scroll first`);
      } else target = { x: action.x, y: action.y };
      const start = { ...cursor };
      const started = now();
      if (action.dur === 0) {
        cursor = { x: target.x, y: target.y };
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...cursor }, sessionId);
        return;
      }
      let firstSendError;
      for (let tick = 1; started + tick / 60 < started + action.dur; tick += 1) {
        const tickAt = started + tick / 60;
        await waitUntil(tickAt);
        const progress = Math.min(1, (tickAt - started) / action.dur);
        cursor = lerpPoint(start, target, ease(action.ease, progress));
        cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...cursor }, sessionId).catch((error) => { firstSendError ??= error; });
      }
      await waitUntil(started + action.dur);
      cursor = { x: target.x, y: target.y };
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...cursor }, sessionId);
      if (firstSendError) throw firstSendError;
    }

    for (let index = 0; index < spec.timeline.length; index += 1) {
      const action = spec.timeline[index];
      await waitUntil(t0 + action.at);
      await visibilitySample;
      const record = { index, do: action.do, label: action.label, at: action.at, dur: action.dur, startedAt: now() - t0 };
      actions.push(record);
      actionRunning = true;
      try {
        if (action.do === "move") await move(action);
        else if (action.do === "click") {
          if (action.to) await move({ ...action, do: "move" });
          await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...cursor, button: "left", clickCount: 1 }, sessionId);
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...cursor, button: "left", clickCount: 1 }, sessionId);
        } else if (action.do === "scroll") {
          await evaluate(cdp, sessionId, `window.__demoVideo.scroll(${JSON.stringify(action)})`, { awaitPromise: true, timeout: action.dur + 5 });
        } else if (action.do === "key") {
          const [down, up] = keyEvents(action.key);
          await cdp.send("Input.dispatchKeyEvent", down, sessionId);
          await cdp.send("Input.dispatchKeyEvent", up, sessionId);
        } else if (action.do === "call") {
          const expression = `Promise.race([Promise.resolve(window[${JSON.stringify(action.fn)}](...${JSON.stringify(action.args)})),new Promise((_,r)=>setTimeout(()=>r(new Error('call timed out: ${action.fn}')),${action.timeout * 1000}))])`;
          await evaluate(cdp, sessionId, expression, { awaitPromise: true, timeout: action.timeout + 1 });
        }
      } catch (error) {
        record.error = error.message;
        renderError = error;
      } finally {
        record.endedAt = now() - t0;
        actionRunning = false;
      }
      try {
        const visibility = await evaluate(cdp, sessionId, "document.visibilityState");
        if (visibility !== "visible") {
          const message = `page became hidden after action ${index} (${action.do}) at ${(now() - t0).toFixed(3)} s; headless Chrome stopped painting`;
          record.error = message;
          renderError = new Error(message);
        }
      } catch (error) {
        if (!renderError) {
          record.error = error.message;
          renderError = error;
        }
      }
      if (renderError) break;
    }

    await waitUntil(t0 + spec.duration + 0.2);
    polling = false;
    await visibilityPolling;
    if (pollingError) throw pollingError;
    await cdp.send("Page.stopScreencast", {}, sessionId);
    captureReadyForEncode = true;
  } finally {
    polling = false;
    await Promise.allSettled(frameWrites);
    if (chrome) await chrome.close();
    await visibilityPolling;
    if (server) await server.close();
    if (!captureReadyForEncode) {
      if (args.keepFrames) process.stderr.write(`Frames kept at ${frameDirectory}\n`);
      else await fs.promises.rm(frameDirectory, { recursive: true, force: true });
    }
  }

  try {
    const timedFrames = frames.map((frame) => ({ file: frame.file, ts: timestampSource === "metadata" ? frame.metadata : frame.receipt }));
    if (timedFrames.length === 0) throw new Error("No screencast frames were captured");
    const listPath = path.join(frameDirectory, "list.ffconcat");
    await fs.promises.writeFile(listPath, buildConcat(timedFrames, { start: t0Epoch, duration: spec.duration }));
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await runProcess(toolchain.ffmpeg, buildEncodeArgs({ list: listPath, fps: spec.fps, width: spec.viewport.width, height: spec.viewport.height, duration: spec.duration, out: outPath }), { signal: abortController.signal, timeout: watchdogLimit });

    const motion = captureMotionMetrics(timedFrames, { start: t0Epoch, actions });
    const span = timedFrames.length > 1 ? timedFrames.at(-1).ts - timedFrames[0].ts : 0;
    const report = {
      planned: { duration: spec.duration, fps: spec.fps, width: spec.viewport.width, height: spec.viewport.height },
      capture: { frames: timedFrames.length, meanFps: span > 0 ? (timedFrames.length - 1) / span : 0, maxGap: motion.maxGap, motionFps: motion.motionFps, windows: motion.windows, timestampSource },
      actions,
      mustShow: mustShow.map((item) => ({ ...item, visibleSec: Number(item.visibleSec.toFixed(3)) })),
      console: consoleMessages.slice(0, 20),
      versions: { chrome: browserVersion, ffmpeg: toolchain.ffmpegVersion },
    };
    const base = outPath.toLowerCase().endsWith(".mp4") ? outPath.slice(0, -4) : outPath;
    await fs.promises.writeFile(`${base}.render.json`, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${renderError ? "Encoded what was captured before the failure" : "Rendered"} ${outPath}: ${timedFrames.length} frames, motion ${report.capture.motionFps?.toFixed(1) ?? "n/a"} fps, max motion gap ${report.capture.maxGap.toFixed(3)} s\n`);
    if (args.keepFrames) process.stdout.write(`Frames kept at ${frameDirectory}\n`);
    if (renderError) throw renderError;
  } finally {
    if (!args.keepFrames) await fs.promises.rm(frameDirectory, { recursive: true, force: true });
  }
  } catch (error) {
    throw watchdogError ?? error;
  } finally {
    clearTimeout(watchdogTimer);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`render: ${error.message}\n`);
  process.exitCode = 1;
}
