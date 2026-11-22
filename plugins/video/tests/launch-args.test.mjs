import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { launchChrome } from "../skills/demo-video/scripts/lib/chrome.mjs";

function launch(options = {}) {
  const calls = [];
  const spawnImpl = (executable, args, spawnOptions) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => {};
    calls.push({ executable, args, spawnOptions });
    return child;
  };
  const fsImpl = { mkdtempSync: () => "/profile", rmSync() {} };
  const launched = launchChrome("/chrome", { width: 800, height: 600, spawnImpl, fsImpl, tmpdir: "/tmp", ...options });
  launched.cdp.close();
  assert.equal(calls.length, 1);
  return calls[0];
}

const CURRENT_ARGS = [
  "--headless=new", "--remote-debugging-pipe", "--user-data-dir=/profile", "--no-first-run",
  "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio",
  "--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "--window-size=800,600", "about:blank",
];

test("default launch arguments are exactly the original list", () => {
  const call = launch();
  assert.equal(call.executable, "/chrome");
  assert.deepEqual(call.args, CURRENT_ARGS);
  assert.deepEqual(call.spawnOptions, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
});

test("the profile directory is created under the given tmpdir with the demo-video prefix", () => {
  let prefix;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
    return child;
  };
  const launched = launchChrome("/chrome", { width: 1, height: 1, spawnImpl, tmpdir: "/tmp", fsImpl: { mkdtempSync: (value) => { prefix = value; return "/p"; }, rmSync() {} } });
  launched.cdp.close();
  assert.equal(prefix, path.join("/tmp", "demo-video-chrome-"));
});

test("headless false removes only --headless=new", () => {
  assert.deepEqual(launch({ headless: false }).args, CURRENT_ARGS.filter((argument) => argument !== "--headless=new"));
  assert.deepEqual(launch({ headless: true }).args, CURRENT_ARGS);
});

test("extraArgs are inserted right before about:blank", () => {
  const extra = ["--use-angle=gl", "--ignore-gpu-blocklist"];
  const args = launch({ extraArgs: extra }).args;
  assert.deepEqual(args, [...CURRENT_ARGS.slice(0, -1), ...extra, "about:blank"]);
  assert.equal(args.at(-1), "about:blank");
  assert.deepEqual(launch({ headless: false, extraArgs: extra }).args, [...CURRENT_ARGS.slice(1, -1), ...extra, "about:blank"]);
  assert.deepEqual(launch({ extraArgs: [] }).args, CURRENT_ARGS);
});
