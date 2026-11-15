import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(testDirectory, "..", "skills", "demo-video", "scripts", "lib", "page-helpers.js"), "utf8");

function harness() {
  const frames = [];
  const calls = [];
  const scroller = { scrollWidth: 1000, scrollHeight: 1000, style: { scrollSnapType: "x mandatory" } };
  const body = { style: { scrollSnapType: "y proximity" } };
  const window = {
    scrollX: 0,
    scrollY: 0,
    scrollTo(options) { calls.push(options); },
    addEventListener() {},
  };
  const document = {
    scrollingElement: scroller,
    documentElement: scroller,
    body,
    querySelector() { return null; },
  };
  const context = vm.createContext({
    window, document, innerWidth: 100, innerHeight: 100,
    performance: { now: () => 0 },
    requestAnimationFrame(callback) { frames.push(callback); },
    getComputedStyle(element) { return { scrollSnapType: element === body ? "y proximity" : "none" }; },
    Promise, Error, Math, Number,
  });
  vm.runInContext(source, context);
  return { api: window.__demoVideo, body, calls, frames, scroller, window };
}

test("scripted page scroll disables and restores snap after the last frame", async () => {
  const { api, body, calls, frames, scroller } = harness();
  const scrolling = api.scroll({ x: 200, y: 300, dur: 0.1, ease: "linear" });
  assert.equal(scroller.style.scrollSnapType, "none");
  assert.equal(body.style.scrollSnapType, "none");
  frames.shift()(50);
  frames.shift()(100);
  await scrolling;
  assert.equal(scroller.style.scrollSnapType, "x mandatory");
  assert.equal(body.style.scrollSnapType, "y proximity");
  assert.equal(calls.at(-1).behavior, "instant");
  assert.equal(calls.at(-1).left, 200);
  assert.equal(calls.at(-1).top, 300);
});

test("scripted page scroll restores snap when a frame rejects", async () => {
  const { api, body, frames, scroller, window } = harness();
  window.scrollTo = () => { throw new Error("scroll failed"); };
  const scrolling = api.scroll({ y: 300, dur: 0.1 });
  frames.shift()(100);
  await assert.rejects(scrolling, /scroll failed/);
  assert.equal(scroller.style.scrollSnapType, "x mandatory");
  assert.equal(body.style.scrollSnapType, "y proximity");
});
