import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachPage } from "./cdp.mjs";
import { findChrome, launchChrome } from "./chrome.mjs";
import { startServer } from "./server.mjs";

export const BACKENDS = ["auto", "default", "gl", "d3d11", "metal", "swiftshader"];

// Headless Chrome on Windows with ANGLE's default D3D11 backend produced all-white or black-floored
// frames of WebGL games whose render scale was not 1; `--use-angle=gl` rendered them correctly.
// So "auto" picks GL on Windows, and every capture records the renderer string.
export function resolveBackend(backend, platform = process.platform) {
  if (!BACKENDS.includes(backend)) throw new Error(`Unknown backend "${backend}". Use one of: ${BACKENDS.join(", ")}`);
  if (backend !== "auto") return backend;
  if (platform === "win32") return "gl";
  if (platform === "linux") return "swiftshader";
  return "default";
}

export function backendArgs(backend, platform = process.platform) {
  switch (resolveBackend(backend, platform)) {
    case "gl": return ["--use-angle=gl", "--ignore-gpu-blocklist"];
    case "d3d11": return ["--use-angle=d3d11", "--ignore-gpu-blocklist"];
    case "metal": return ["--use-angle=metal", "--ignore-gpu-blocklist"];
    case "swiftshader": return ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
    // "default" is what players get: no flags at all, so frame times and rendering match a normal Chrome.
    default: return [];
  }
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// The returned promise has a cancel() that removes the listener and the timer, so a failed setup does not
// leave a pending timeout keeping the process alive.
export function waitForEvent(cdp, method, sessionId, milliseconds = 10_000) {
  let off = () => {};
  let timer;
  const promise = new Promise((resolve, reject) => {
    off = cdp.on(method, (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      clearTimeout(timer);
      off();
      resolve(params);
    });
    timer = setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for ${method}`));
    }, milliseconds);
  });
  promise.cancel = () => { clearTimeout(timer); off(); };
  return promise;
}

// `timeout` is in seconds and bounds the CDP call, so it must be longer than any wait inside the expression.
export async function evaluate(cdp, sessionId, expression, timeout = 10) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId, { timeout });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Page evaluation failed");
  return response.result?.value;
}

export function parseSize(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value ?? ""));
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw new Error(`--size needs WIDTHxHEIGHT such as 1600x900, got "${value}"`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

export function parseNumber(value, name, { min = 0, integer = false, exclusiveMin = false } = {}) {
  const number = Number(value);
  const valid = String(value).trim() !== "" && Number.isFinite(number) && (exclusiveMin ? number > min : number >= min) && (!integer || Number.isInteger(number));
  if (!valid) throw new Error(`${name} needs ${integer ? "an integer" : "a number"} ${exclusiveMin ? "above" : "of at least"} ${min}, got "${value}"`);
  return number;
}

const RENDERER_EXPRESSION = `(() => {
  let gl = null;
  for (const type of ["webgl2", "webgl"]) {
    try { gl = document.createElement("canvas").getContext(type); } catch { gl = null; }
    if (gl) break;
  }
  if (!gl) return "no webgl";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  const renderer = String(unmasked || gl.getParameter(gl.RENDERER));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return renderer;
})()`;

function consoleText(params) {
  return (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
}

/**
 * Open `url` in Chrome at a fixed viewport and return the live page.
 * The caller owns `chrome` and must call `chrome.close()`.
 */
export async function openGamePage({ url, width, height, backend = "auto", headed = false, dpr = 1, env }) {
  const args = backendArgs(backend, process.platform);
  const chromePath = findChrome({ env: env ?? process.env, platform: process.platform });
  const chrome = launchChrome(chromePath, { width, height, headless: !headed, extraArgs: args });
  let loaded;
  try {
    const sessionId = await attachPage(chrome.cdp);
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false }, sessionId),
    ]);
    const diagnostics = { errors: [] };
    chrome.cdp.on("Runtime.consoleAPICalled", (params, eventSessionId) => {
      if (eventSessionId === sessionId && params.type === "error") diagnostics.errors.push(consoleText(params));
    });
    chrome.cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      diagnostics.errors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Uncaught page error");
    });
    loaded = waitForEvent(chrome.cdp, "Page.loadEventFired", sessionId, 30_000);
    loaded.catch(() => {});
    const navigation = await chrome.cdp.send("Page.navigate", { url }, sessionId);
    if (navigation.errorText) throw new Error(`Could not open ${url}: ${navigation.errorText}`);
    await loaded;
    const renderer = await evaluate(chrome.cdp, sessionId, RENDERER_EXPRESSION, 15);
    const version = await chrome.cdp.send("Browser.getVersion");
    return { chrome, sessionId, diagnostics, renderer, chromeVersion: version.product };
  } catch (error) {
    loaded?.cancel();
    await chrome.close();
    throw error;
  }
}

/**
 * Render an HTML string in Chrome and return the full page as a PNG buffer.
 * The HTML is served from a temporary directory that is removed afterwards; reference images as data: URIs.
 */
export async function htmlToPng(html, { width = 1200, env } = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "game3d-sheet-"));
  let server;
  let chrome;
  let loaded;
  try {
    await fs.promises.writeFile(path.join(directory, "sheet.html"), html);
    server = await startServer(directory);
    chrome = launchChrome(findChrome({ env: env ?? process.env, platform: process.platform }), { width, height: 800 });
    const sessionId = await attachPage(chrome.cdp);
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId),
    ]);
    loaded = waitForEvent(chrome.cdp, "Page.loadEventFired", sessionId, 30_000);
    loaded.catch(() => {});
    const navigation = await chrome.cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/sheet.html` }, sessionId);
    if (navigation.errorText) throw new Error(`Could not open the sheet page: ${navigation.errorText}`);
    await loaded;
    await evaluate(chrome.cdp, sessionId, "Promise.all([...document.images].map((image) => image.decode().catch(() => {})))", 60);
    const size = await evaluate(chrome.cdp, sessionId, "(() => { const rect = document.body.getBoundingClientRect(); return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }; })()");
    await chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await evaluate(chrome.cdp, sessionId, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const screenshot = await chrome.cdp.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    }, sessionId, { timeout: 60 });
    return Buffer.from(screenshot.data, "base64");
  } finally {
    loaded?.cancel();
    await Promise.allSettled([chrome?.close(), server?.close()]);
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}
