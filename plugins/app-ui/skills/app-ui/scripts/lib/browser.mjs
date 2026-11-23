// One Chrome per command run, one browser target per screen: emulate a phone, record diagnostics, wait until the
// screen is ready, then hand the page to collect.js or a screenshot.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome } from "./chrome.mjs";

const COLLECT_SOURCE = fs.readFileSync(fileURLToPath(new URL("./collect.js", import.meta.url)), "utf8");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const IDLE_MS = 500;

// ---- Ctrl+C and friends: close Chrome and remove its profile, then exit 130 ----
const cleanups = new Set();
let signalsInstalled = false;
let interrupted = false;

function onSignal() {
  if (interrupted) return;
  interrupted = true;
  const work = Promise.allSettled([...cleanups].map((cleanup) => cleanup()));
  const limit = new Promise((resolve) => setTimeout(resolve, 3500));
  Promise.race([work, limit]).finally(() => process.exit(130));
}

function installSignals() {
  if (signalsInstalled) return;
  signalsInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? ["SIGBREAK"] : [])]) process.on(signal, onSignal);
}

function removeSignals() {
  if (!signalsInstalled || cleanups.size > 0) return;
  signalsInstalled = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.off(signal, onSignal);
}

/** Run `cleanup` if the process is interrupted while the returned function has not been called. */
export function onInterrupt(cleanup) {
  cleanups.add(cleanup);
  installSignals();
  return () => {
    cleanups.delete(cleanup);
    removeSignals();
  };
}

/** Start Chrome. Throws when Chrome or Chromium cannot be found. Returns { chrome, cdp, close }. */
export function startBrowser({ width, height, env = process.env } = {}) {
  const executable = findChrome({ env, platform: process.platform });
  const chrome = launchChrome(executable, { width, height });
  let removeInterrupt = () => {};
  const close = async () => {
    removeInterrupt();
    await chrome.close();
  };
  removeInterrupt = onInterrupt(async () => {
    await chrome.close();
    try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  return { chrome, cdp: chrome.cdp, close };
}

export async function evaluate(cdp, sessionId, expression, timeout = 30) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId, { timeout });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Page evaluation failed");
  return response.result?.value;
}

function withDeadline(promise, deadline, step) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error(`timed out waiting for ${step}`));
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${step}`)), remaining); }),
  ]).finally(() => clearTimeout(timer));
}

const text = (params) => (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");

/**
 * Open `url` as a phone screen in a new target.
 * device: { width, height, deviceScaleFactor }. timeout is in seconds.
 * Returns { sessionId, diagnostics, loadError, close }: `loadError` is a string when the screen did not become ready
 * within the timeout (the diagnostics gathered so far are still returned); the caller always calls close().
 */
export async function openScreen(browser, { url, device, timeout = 20 }) {
  const { cdp } = browser;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const diagnostics = { consoleErrors: [], logErrors: [], exceptions: [], failedRequests: [], httpErrors: [], requests: [], hasDeclaredIcon: false };
  const requestUrls = new Map();
  let lastNetworkActivity = Date.now();
  const touch = () => { lastNetworkActivity = Date.now(); };
  const subscriptions = [
    ["Runtime.consoleAPICalled", (params) => { if (params.type === "error") diagnostics.consoleErrors.push(text(params)); }],
    ["Runtime.exceptionThrown", (params) => { diagnostics.exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Uncaught page error"); }],
    ["Log.entryAdded", (params) => {
      const entry = params.entry ?? {};
      // Failed loads ("network" entries) also arrive here; they are counted once, as requests.
      if (entry.level === "error" && entry.source !== "network" && entry.text) diagnostics.logErrors.push(entry.text);
    }],
    ["Network.requestWillBeSent", (params) => {
      touch();
      const requestUrl = params.request?.url;
      if (requestUrl) {
        requestUrls.set(params.requestId, requestUrl);
        diagnostics.requests.push(requestUrl);
      }
    }],
    ["Network.responseReceived", (params) => {
      if ((params.response?.status ?? 0) >= 400) diagnostics.httpErrors.push({ url: params.response.url ?? requestUrls.get(params.requestId) ?? "(unknown URL)", status: params.response.status });
    }],
    ["Network.loadingFinished", () => touch()],
    ["Network.loadingFailed", (params) => {
      touch();
      if (params.canceled) return;
      const reason = String(params.errorText ?? "").replace(/^net::/, "");
      const error = params.blockedReason ? `${reason ? `${reason}, ` : ""}blocked: ${params.blockedReason}` : reason || "request failed";
      diagnostics.failedRequests.push({ url: requestUrls.get(params.requestId) ?? "(unknown URL)", error });
    }],
  ].map(([method, handler]) => cdp.on(method, (params, eventSessionId) => { if (eventSessionId === sessionId) handler(params ?? {}); }));

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const off of subscriptions) off();
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  };

  let loadError = null;
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: device.deviceScaleFactor, mobile: true }, sessionId);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
    for (const domain of ["Page", "Runtime", "Network", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);
    const deadline = Date.now() + timeout * 1000;
    let loadHandler;
    const loaded = new Promise((resolve) => { loadHandler = cdp.on("Page.loadEventFired", (_, eventSessionId) => { if (eventSessionId === sessionId) resolve(); }); });
    try {
      const navigation = await withDeadline(cdp.send("Page.navigate", { url }, sessionId), deadline, "navigation");
      if (navigation.errorText) throw new Error(`navigation to ${url} failed: ${navigation.errorText.replace(/^net::/, "")}`);
      await withDeadline(loaded, deadline, "the load event");
    } finally {
      loadHandler();
    }
    await withDeadline(evaluate(cdp, sessionId, "document.fonts ? document.fonts.ready.then(() => true) : true", timeout + 5), deadline, "document.fonts.ready");
    for (;;) {
      const state = await withDeadline(evaluate(cdp, sessionId, '!("__appReady" in window) ? "undefined" : window.__appReady === true ? "ready" : "waiting"', 10), deadline, "window.__appReady");
      if (state !== "waiting") break;
      if (Date.now() >= deadline) throw new Error("timed out waiting for window.__appReady to become exactly true");
      await sleep(50);
    }
    while (Date.now() - lastNetworkActivity < IDLE_MS) {
      if (Date.now() >= deadline) throw new Error("timed out waiting for the network to go quiet for 500 ms");
      await sleep(50);
    }
    await withDeadline(evaluate(cdp, sessionId, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", timeout + 5), deadline, "two animation frames");
    diagnostics.hasDeclaredIcon = Boolean(await evaluate(cdp, sessionId, 'Boolean(document.querySelector(\'link[rel~="icon" i]\'))', 10));
  } catch (error) {
    loadError = error.message;
  }
  return { sessionId, diagnostics, loadError, close };
}

/** Run collect.js in the page. options: { tap, tapText, tokenColors }. */
export function collectScreen(browser, screen, options = {}) {
  const expression = `(${COLLECT_SOURCE}\n)(${JSON.stringify(options)})`;
  return evaluate(browser.cdp, screen.sessionId, expression, 60);
}
