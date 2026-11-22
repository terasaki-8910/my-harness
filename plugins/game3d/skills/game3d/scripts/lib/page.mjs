import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachPage } from "./cdp.mjs";
import { findChrome, launchChrome } from "./chrome.mjs";
import { startServer } from "./server.mjs";

export const BACKENDS = ["auto", "default", "gl", "d3d11", "metal", "swiftshader"];

export const CLEANUP_LIMIT_MS = 3000;
export const SIGNAL_EXIT_CODE = 130;

/**
 * Registry of what a run leaves behind if it is interrupted: open Chrome instances (with their temporary
 * profile folders) and other temporary folders. While at least one thing is registered, SIGINT, SIGTERM,
 * SIGHUP and (on Windows) SIGBREAK close everything (at most `limitMs`, then Chrome is killed and the folders
 * are removed without waiting) and exit with code 130. The signal handlers exist only while something is
 * registered and are removed again afterwards, so a finished run exits on its own.
 */
export function createCleanupRegistry({ processImpl = process, exit = (code) => processImpl.exit(code), platform = process.platform, limitMs = CLEANUP_LIMIT_MS } = {}) {
  const chromes = new Set();
  const finished = new WeakSet();
  const folders = new Set();
  const signals = ["SIGINT", "SIGTERM", ...(platform === "win32" ? ["SIGBREAK"] : []), "SIGHUP"];
  let installed = false;
  let running = null;

  const remove = (directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
  };
  const uninstall = () => {
    if (!installed || chromes.size > 0 || folders.size > 0) return;
    installed = false;
    for (const signal of signals) processImpl.off(signal, onSignal);
  };
  const install = () => {
    if (installed) return;
    installed = true;
    for (const signal of signals) processImpl.on(signal, onSignal);
  };

  function cleanup() {
    running ??= (async () => {
      // What was open when the signal came; a close() already under way is awaited, not repeated (see trackChrome).
      const openChromes = [...chromes];
      const openFolders = [...folders];
      let timer;
      const work = Promise.allSettled(openChromes.map((chrome) => chrome.close()));
      await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, limitMs); })]);
      clearTimeout(timer);
      // Whatever did not close in time is killed; every profile is removed again, since a Chrome that has only
      // just exited may still have held files in it.
      for (const chrome of openChromes) {
        if (!finished.has(chrome)) {
          try { chrome.child?.kill(); } catch { /* already gone */ }
        }
        remove(chrome.profile);
      }
      for (const directory of openFolders) remove(directory);
      chromes.clear();
      folders.clear();
      uninstall();
    })().finally(() => { running = null; });
    return running;
  }
  // A second signal while the cleanup runs is ignored: the cleanup is bounded by limitMs and exits afterwards.
  let signalled = false;
  function onSignal() {
    if (signalled) return;
    signalled = true;
    cleanup().finally(() => exit(SIGNAL_EXIT_CODE));
  }

  return {
    /**
     * Register a chrome from launchChrome; its close() unregisters it once it has finished. Every call of
     * close() returns the same promise: the original close() returns at once on a second call, which would let
     * a signal during a close that is under way find nothing to wait for and exit before the profile is removed.
     */
    trackChrome(chrome) {
      const close = chrome.close.bind(chrome);
      let closing = null;
      chrome.close = () => {
        closing ??= (async () => {
          try {
            await close();
          } finally {
            finished.add(chrome);
            chromes.delete(chrome);
            uninstall();
          }
        })();
        return closing;
      };
      chromes.add(chrome);
      install();
      return chrome;
    },
    /** Register a temporary folder to remove on interruption; call untrackFolder once it has been removed. */
    trackFolder(directory) {
      folders.add(directory);
      install();
    },
    untrackFolder(directory) {
      folders.delete(directory);
      uninstall();
    },
    cleanup,
    get size() { return chromes.size + folders.size; },
    get installed() { return installed; },
  };
}

const registry = createCleanupRegistry();

function launchTrackedChrome(chromePath, options) {
  return registry.trackChrome(launchChrome(chromePath, options));
}

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

function isFavicon(url) {
  try {
    return new URL(url).pathname.endsWith("/favicon.ico");
  } catch {
    return false;
  }
}

/**
 * Collect what the page reports as wrong: console errors, uncaught exceptions, failed resource loads
 * (Network.loadingFailed except canceled requests), responses with HTTP status >= 400 and Log entries of level
 * "error". Returns { errors, networkErrors }: `errors` holds one line per problem (all kinds, in order),
 * `networkErrors` the request problems as { kind: "http" | "failed" | "log", url, status, text }.
 * A request URL is reported once, however many events mention it. Requests whose path ends with /favicon.ico
 * and URLs containing any `ignoreUrl` substring (known optional assets) are not reported.
 * The caller enables the Runtime, Network and Log domains for `sessionId`. `stop()` unsubscribes, so nothing
 * Chrome reports while it shuts down is counted.
 */
export function watchPage(cdp, sessionId, { ignoreUrl = [] } = {}) {
  const offs = [];
  const diagnostics = { errors: [], networkErrors: [], stop: () => offs.splice(0).forEach((off) => off()) };
  const requestUrls = new Map();
  const reportedUrls = new Set();
  const skipped = (url) => isFavicon(url) || ignoreUrl.some((part) => url.includes(part));
  const onPage = (method, handler) => offs.push(cdp.on(method, (params, eventSessionId) => {
    if (eventSessionId === sessionId) handler(params ?? {});
  }));
  const reportRequest = (kind, url, status, text) => {
    if (typeof url !== "string" || url === "" || skipped(url) || reportedUrls.has(url)) return;
    reportedUrls.add(url);
    diagnostics.networkErrors.push({ kind, url, status, text });
    diagnostics.errors.push(kind === "http" ? `HTTP ${status} ${url}` : kind === "failed" ? `request failed (${text}) ${url}` : `${text} (${url})`);
  };

  onPage("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") diagnostics.errors.push(consoleText(params));
  });
  onPage("Runtime.exceptionThrown", (params) => {
    diagnostics.errors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Uncaught page error");
  });
  onPage("Network.requestWillBeSent", (params) => {
    if (params.requestId !== undefined && params.request?.url) requestUrls.set(params.requestId, params.request.url);
  });
  onPage("Network.loadingFinished", (params) => requestUrls.delete(params.requestId));
  onPage("Network.responseReceived", (params) => {
    const status = params.response?.status;
    if (Number.isInteger(status) && status >= 400) reportRequest("http", params.response.url ?? requestUrls.get(params.requestId), status, params.response.statusText ?? "");
  });
  onPage("Network.loadingFailed", (params) => {
    const url = requestUrls.get(params.requestId);
    requestUrls.delete(params.requestId);
    if (params.canceled) return;
    const reason = params.errorText ?? "failed";
    reportRequest("failed", url, null, params.blockedReason ? `${reason}, ${params.blockedReason}` : reason);
  });
  onPage("Log.entryAdded", (params) => {
    const entry = params.entry ?? {};
    if (entry.level !== "error") return;
    const text = entry.text ?? "";
    if (entry.url) reportRequest("log", entry.url, Number(/status of (\d{3})/.exec(text)?.[1]) || null, text);
    else if (!ignoreUrl.some((part) => text.includes(part)) && !diagnostics.errors.includes(text)) diagnostics.errors.push(text);
  });
  return diagnostics;
}

/**
 * Open `url` in Chrome at a fixed viewport and return the live page.
 * `ignoreUrl` lists URL substrings of known optional assets whose load failures are not page errors.
 * The caller owns `chrome` and must call `chrome.close()`.
 */
export async function openGamePage({ url, width, height, backend = "auto", headed = false, dpr = 1, env, ignoreUrl = [] }) {
  const args = backendArgs(backend, process.platform);
  const chromePath = findChrome({ env: env ?? process.env, platform: process.platform });
  const chrome = launchTrackedChrome(chromePath, { width, height, headless: !headed, extraArgs: args });
  let loaded;
  try {
    const sessionId = await attachPage(chrome.cdp);
    const diagnostics = watchPage(chrome.cdp, sessionId, { ignoreUrl });
    const closeChrome = chrome.close;
    chrome.close = () => {
      diagnostics.stop();
      return closeChrome();
    };
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Network.enable", {}, sessionId),
      chrome.cdp.send("Log.enable", {}, sessionId),
      chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false }, sessionId),
    ]);
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
  registry.trackFolder(directory);
  let server;
  let chrome;
  let loaded;
  try {
    await fs.promises.writeFile(path.join(directory, "sheet.html"), html);
    server = await startServer(directory);
    chrome = launchTrackedChrome(findChrome({ env: env ?? process.env, platform: process.platform }), { width, height: 800 });
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
    try {
      await fs.promises.rm(directory, { recursive: true, force: true });
    } finally {
      registry.untrackFolder(directory);
    }
  }
}
