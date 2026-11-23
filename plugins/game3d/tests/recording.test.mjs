import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { SLOW_FRAME_MS, countOver, eventLines, recordExpression, slowestFrames, summariseEvent, windowSamples } from "../skills/game3d/scripts/lib/recording.mjs";

const perf = fileURLToPath(new URL("../skills/game3d/scripts/perf.mjs", import.meta.url));

// The expression perf.mjs evaluated before --event existed: without an event the page must receive these exact bytes.
const ORIGINAL_EXPRESSION = (seconds) => `new Promise((resolve) => {
  const intervals = [];
  const end = performance.now() + ${seconds * 1000};
  let last = null;
  const tick = (now) => {
    if (last !== null) intervals.push(now - last);
    last = now;
    if (now >= end) resolve(intervals); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

/**
 * Run a recording expression in a bare vm context whose performance.now() is `start` and whose
 * requestAnimationFrame is driven by hand with `ticks` (frame timestamps). `globals` are the page's globals.
 * The result is JSON round-tripped because it comes from another realm. `pending` is how many ticks were left.
 */
async function simulate(expression, ticks, { start = 1000, globals = {} } = {}) {
  const callbacks = [];
  const context = vm.createContext({ performance: { now: () => start }, requestAnimationFrame: (callback) => callbacks.push(callback), ...globals });
  const promise = vm.runInContext(expression, context);
  let used = 0;
  while (callbacks.length > 0 && used < ticks.length) callbacks.shift()(ticks[used++]);
  const unresolved = Symbol("unresolved");
  const value = await Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve(unresolved)))]);
  return { value: value === unresolved ? unresolved : JSON.parse(JSON.stringify(value)), unresolved, used, pending: ticks.length - used };
}

test("without an event the recording expression is exactly the original one and resolves to the intervals", async () => {
  assert.equal(recordExpression({ seconds: 15 }), ORIGINAL_EXPRESSION(15));
  assert.equal(recordExpression({ seconds: 0.25, eventAt: 3, eventWindow: 9 }), ORIGINAL_EXPRESSION(0.25), "the event options are ignored without an event");
  const run = await simulate(recordExpression({ seconds: 0.3 }), [1100, 1116, 1150, 1300, 1400]);
  assert.deepEqual(run.value, [16, 34, 150]);
  assert.equal(run.pending, 1, "stops at the first frame at or after the end");
  assert.throws(() => recordExpression({ seconds: 0 }), /seconds/);
});

test("the expression with an event parses as JavaScript, whatever the event contains", () => {
  const events = [
    "window.__debug.transition()",
    "a(); b()",
    "f('single', \"double\", `back${tick}tick`, '$&', \"$1\") // trailing comment",
    "go(`${a}`) /* block comment */",
    "/* open */ go()",
  ];
  for (const event of events) assert.doesNotThrow(() => new vm.Script(recordExpression({ seconds: 8, event })), event);
  assert.doesNotThrow(() => new vm.Script(recordExpression({ seconds: 8 })));
  assert.throws(() => new vm.Script(recordExpression({ seconds: 8, event: "window.__debug.transition(" })), SyntaxError, "a syntax error in the event is a syntax error of the expression");
  assert.throws(() => recordExpression({ seconds: 8, event: "  " }), /event/);
  assert.throws(() => recordExpression({ seconds: 8, event: "x", eventAt: -1 }), /eventAt/);
  assert.throws(() => recordExpression({ seconds: 8, event: "x", eventWindow: 0 }), /eventWindow/);
});

test("the event source arrives intact: quotes, backticks, template syntax, replacement patterns and a trailing comment", async () => {
  const event = "calls.push('it\\'s', \"say \\\"hi\\\"\", `tick ${1 + 1}`, '$&', \"$1 $$\", typeof document); // trailing comment, no semicolon after";
  const globals = { calls: [] };
  const run = await simulate(recordExpression({ seconds: 1, event, eventAt: 0, eventWindow: 0.5 }), [1010, 1020, 2000], { globals });
  assert.equal(run.value.eventError, null);
  assert.deepEqual(JSON.parse(JSON.stringify(globals.calls)), ["it's", 'say "hi"', "tick 2", "$&", "$1 $$", "undefined"]);
});

test("bare names in the event are the page's globals, not the recorder's variables", async () => {
  const globals = { seen: [], start: "page start", now: "page now", end: "page end", last: "page last", samples: "page samples", eventTime: "page eventTime", tick: "page tick", resolve: "page resolve" };
  const event = "seen.push(start, now, end, last, samples, eventTime, tick, resolve)";
  const run = await simulate(recordExpression({ seconds: 1, event, eventAt: 0, eventWindow: 0.5 }), [1010, 1020, 2000], { globals });
  assert.equal(run.value.eventError, null);
  assert.deepEqual(JSON.parse(JSON.stringify(globals.seen)), ["page start", "page now", "page end", "page last", "page samples", "page eventTime", "page tick", "page resolve"]);
});

test("the event runs once, at the first frame at or after --event-at, and the frame it ran in is not part of its window", async () => {
  const globals = { runs: [] };
  const expression = recordExpression({ seconds: 1, event: "runs.push('ran')", eventAt: 0.5, eventWindow: 0.2 });
  // The page's clock starts at 1000, so the event is due at 1500: the frame at 1499 is too early, 1500 is the one.
  const run = await simulate(expression, [1100, 1200, 1499, 1500, 1600, 1700, 1800, 2000, 2100], { globals });
  assert.notEqual(run.value, run.unresolved);
  assert.equal(globals.runs.length, 1, "once");
  assert.equal(run.value.eventTime, 500, "counted from the start of the recording");
  assert.equal(run.value.eventError, null);
  assert.deepEqual(run.value.samples, [[200, 100], [499, 299], [500, 1], [600, 100], [700, 100], [800, 100], [1000, 200]]);
  assert.equal(run.pending, 1, "stops at the first frame at or after the end (1000)");
  const frames = windowSamples(run.value.samples, { from: run.value.eventTime, length: 200 });
  assert.deepEqual(frames, [{ time: 100, interval: 100 }, { time: 200, interval: 100 }], "the sample of the event frame itself (time 500) is excluded");
});

test("the recording is extended so that --event-at plus --event-window after a late event is never cut short", async () => {
  // --seconds 0.8 = 0.5 + 0.3, but the event ran at the frame of 1510 (10 ms late): the window ends at 1810, past 1800.
  const expression = recordExpression({ seconds: 0.8, event: "0", eventAt: 0.5, eventWindow: 0.3 });
  const run = await simulate(expression, [1100, 1510, 1700, 1800, 1810, 1900]);
  assert.equal(run.value.eventTime, 510);
  assert.deepEqual(run.value.samples.at(-1), [810, 10], "the frame at the end of the window was recorded");
  assert.equal(run.pending, 1);
  assert.equal(windowSamples(run.value.samples, { from: 510, length: 300 }).at(-1).time, 300, "a frame exactly at the end of the window belongs to it");
});

test("an event that throws stops the recording and reports the message", async () => {
  const thrown = await simulate(recordExpression({ seconds: 5, event: "throw new Error('boom `tick`')", eventAt: 0.2 }), [1100, 1200, 1300, 1400]);
  assert.equal(thrown.value.eventError, "boom `tick`");
  assert.equal(thrown.value.eventTime, 200);
  assert.equal(thrown.pending, 2, "no further frames are waited for");
  const plain = await simulate(recordExpression({ seconds: 5, event: "throw 'plain text'", eventAt: 0 }), [1100]);
  assert.equal(plain.value.eventError, "plain text");
  const missing = await simulate(recordExpression({ seconds: 5, event: "window.__debug.transition()", eventAt: 0 }), [1100], { globals: { window: {} } });
  assert.match(missing.value.eventError, /transition is not a function|Cannot read properties of undefined/);
});

test("windowSamples keeps frames after the start of the window up to and including its end", () => {
  const samples = [[0, 16], [100, 17], [200, 100], [300, 18], [400, 19]];
  assert.deepEqual(windowSamples(samples, { from: 100, length: 200 }), [{ time: 100, interval: 100 }, { time: 200, interval: 18 }]);
  assert.deepEqual(windowSamples(samples, { from: 100, length: 199.9 }), [{ time: 100, interval: 100 }], "a frame just after the end is outside");
  assert.deepEqual(windowSamples(samples, { from: 99, length: 1 }), [{ time: 1, interval: 17 }], "a frame just after the start is inside");
  assert.deepEqual(windowSamples(samples, { from: 0, length: 1000 }).map((frame) => frame.interval), [17, 100, 18, 19], "time 0 is the event frame itself");
  assert.deepEqual(windowSamples(samples, { from: -1, length: 1 }).map((frame) => frame.interval), [16], "times before the start are not counted");
});

test("an empty window is an error", () => {
  const samples = [[0, 16], [100, 17], [200, 100]];
  assert.throws(() => windowSamples(samples, { from: 200, length: 500 }), /no frame fell inside the event window/);
  assert.throws(() => windowSamples(samples, { from: 100, length: 0.5 }), /no frame/);
  assert.throws(() => windowSamples([], { from: 0, length: 10 }), /no frame/);
  assert.throws(() => windowSamples(samples, { from: 0, length: 0 }), /length/);
  assert.throws(() => windowSamples(samples, { from: Number.NaN, length: 10 }), /finite/);
  assert.throws(() => windowSamples(null, { from: 0, length: 10 }), /array/);
  assert.throws(() => summariseEvent(samples, { eventTime: null, windowMs: 1000 }), /event never ran/);
});

test("countOver counts intervals strictly above the threshold, 34 ms by default", () => {
  assert.equal(SLOW_FRAME_MS, 34);
  assert.equal(countOver([16.7, 34, 34.0001, 100, 33.3]), 2);
  assert.equal(countOver([34, 34]), 0);
  assert.equal(countOver([]), 0);
  assert.equal(countOver([10, 20, 30], 15), 2);
  assert.equal(countOver([10, 20, 30], 30), 0);
});

test("slowestFrames lists the longest first, the earlier one first among equals", () => {
  const frames = [{ time: 10, interval: 20 }, { time: 20, interval: 90 }, { time: 30, interval: 40 }, { time: 40, interval: 90 }, { time: 50, interval: 10 }, { time: 60, interval: 50 }, { time: 70, interval: 30 }];
  assert.deepEqual(slowestFrames(frames), [{ time: 20, interval: 90 }, { time: 40, interval: 90 }, { time: 60, interval: 50 }, { time: 30, interval: 40 }, { time: 70, interval: 30 }]);
  assert.deepEqual(slowestFrames(frames, 2).map((frame) => frame.interval), [90, 90]);
  assert.equal(slowestFrames(frames.slice(0, 2)).length, 2, "fewer frames than the count");
  assert.equal(frames[0].time, 10, "the input is not reordered");
});

test("the event block reports frames, percentiles, the count over 34 ms and the slowest frames as +seconds duration", () => {
  const samples = [[0, 16], [100, 16.7], [170, 33.4], [200, 16.7], [250, 34], [300, 120.04], [400, 16.7], [450, 50]];
  const summary = summariseEvent(samples, { eventTime: 100, windowMs: 400 });
  assert.equal(summary.stats.frames, 6);
  assert.equal(summary.over, 2, "34.0 is not over 34");
  assert.deepEqual(eventLines(summary, 0.4), [
    "event: ran 0.10 s into the recording, judged for the next 0.4 s",
    "event frames: 6",
    "event p50: 33.4 ms",
    "event p95: 120.0 ms",
    "event p99: 120.0 ms",
    "event max: 120.0 ms",
    "event frames over 34 ms: 2",
    "event slowest: +0.20s 120.0 ms, +0.35s 50.0 ms, +0.15s 34.0 ms, +0.07s 33.4 ms, +0.10s 16.7 ms",
  ]);
});

function runPerf(args) {
  return spawnSync(process.execPath, [perf, ...args], { encoding: "utf8", timeout: 20_000 });
}

test("perf.mjs refuses bad event options with exit 2 before it opens a page", () => {
  const url = "http://127.0.0.1:9/";
  const cases = [
    [["--event-at", "1"], /--event-at needs --event/],
    [["--event-window", "2"], /--event-window needs --event/],
    [["--event", "go()", "--event-at", "-0.1"], /--event-at needs a number of at least 0, got "-0\.1"/],
    [["--event", "go()", "--event-window", "0"], /--event-window needs a number above 0, got "0"/],
    [["--event", "go()", "--event-window", "-2"], /--event-window needs a number above 0/],
    [["--event", "go()", "--event-at", "x"], /--event-at needs a number/],
    [["--event", "go()", "--seconds", "4", "--event-at", "1", "--event-window", "4"], /--event-at 1 plus --event-window 4 is 5 s, longer than --seconds 4/],
    [["--event", "go()", "--seconds", "4"], /--event-at 0\.5 plus --event-window 4 is 4\.5 s, longer than --seconds 4/],
    [["--event", "go()", "--event-at"], /--event-at needs a value/],
    [["--event", "  "], /--event needs JavaScript/],
    [["--event"], /--event needs a value/],
  ];
  for (const [args, message] of cases) {
    const result = runPerf([url, ...args]);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.stderr, /^perf: /, args.join(" "));
    assert.match(result.stderr, message, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
  }
});
