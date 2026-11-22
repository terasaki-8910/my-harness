#!/usr/bin/env node
// Frame-time probe: records requestAnimationFrame intervals of a running page.
//
// Usage: perf.mjs <url> [--seconds 15] [--warmup 3] [--size 1600x900] [--backend default] [--headed] [--dpr 1] [--p95 <ms>] [--ignore-url <substring>]...
//
// Opens the page, waits --warmup seconds, then records requestAnimationFrame intervals inside the page for
// --seconds and prints frames, p50, p95, p99 and max in ms plus the WebGL renderer string.
// Page errors (console errors, uncaught exceptions, failed resource loads, HTTP status >= 400, Log entries of
// level error; see shots.mjs) make the exit code 1 and print "FAIL page errors", with or without --p95: the
// timing of a page that crashed says nothing. /favicon.ico is ignored and --ignore-url <substring>
// (repeatable) ignores requests whose URL contains it, for known optional assets.
// With --p95 the exit code is also 1 when the measured p95 is above that budget. Exit 2 for setup problems.
//
// Headless timing is not representative of what players see (no real window, different compositing and
// vsync), so measure budgets with --headed. The default backend here is "default", the one players get.
import { intervalStats } from "./lib/frames.mjs";
import { BACKENDS, evaluate, openGamePage, parseNumber, parseSize, sleep, takeValue } from "./lib/page.mjs";

const USAGE = "Usage: perf.mjs <url> [--seconds 15] [--warmup 3] [--size 1600x900] [--backend default] [--headed] [--dpr 1] [--p95 <ms>] [--ignore-url <substring>]...";

function parseArguments(argv) {
  const result = { url: null, seconds: 15, warmup: 3, size: "1600x900", backend: "default", headed: false, dpr: 1, p95: null, ignoreUrl: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headed") result.headed = true;
    else if (argument === "--seconds") result.seconds = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument === "--warmup") result.warmup = parseNumber(takeValue(argv, index++, argument), argument, { min: 0 });
    else if (argument === "--size") result.size = takeValue(argv, index++, argument);
    else if (argument === "--backend") result.backend = takeValue(argv, index++, argument);
    else if (argument === "--dpr") result.dpr = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument === "--p95") result.p95 = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument === "--ignore-url") result.ignoreUrl.push(takeValue(argv, index++, argument));
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
    else if (result.url === null) result.url = argument;
    else throw new Error(`Unexpected argument: ${argument}\n${USAGE}`);
  }
  if (!result.url) throw new Error(USAGE);
  try { new URL(result.url); } catch { throw new Error(`Not a URL: ${result.url} (serve local files over http first)`); }
  if (!BACKENDS.includes(result.backend)) throw new Error(`Unknown backend "${result.backend}". Use one of: ${BACKENDS.join(", ")}`);
  return { ...result, ...parseSize(result.size) };
}

const recordExpression = (seconds) => `new Promise((resolve) => {
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

const ms = (value) => value.toFixed(1);

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const opened = await openGamePage({ url: args.url, width: args.width, height: args.height, backend: args.backend, headed: args.headed, dpr: args.dpr, ignoreUrl: args.ignoreUrl });
  const { errors } = opened.diagnostics;
  let intervals;
  try {
    await sleep(args.warmup * 1000);
    // The CDP call must outlive the in-page recording, so give it the recording time plus a margin.
    intervals = await evaluate(opened.chrome.cdp, opened.sessionId, recordExpression(args.seconds), args.seconds + 30);
  } finally {
    await opened.chrome.close();
  }
  const reportErrors = () => {
    for (const error of errors) process.stderr.write(`perf: page error: ${error.split(/\r?\n/, 1)[0]}\n`);
  };
  if (!Array.isArray(intervals) || intervals.length === 0) {
    reportErrors();
    throw new Error("The page delivered no animation frames while recording (is the page hidden or throttled?)");
  }
  const stats = intervalStats(intervals);
  process.stdout.write(`frames: ${stats.frames}\np50: ${ms(stats.p50)} ms\np95: ${ms(stats.p95)} ms\np99: ${ms(stats.p99)} ms\nmax: ${ms(stats.max)} ms\nrenderer: ${opened.renderer}\n`);
  if (!args.headed) process.stdout.write("note: headless timing is not representative; measure budgets with --headed\n");
  reportErrors();
  if (errors.length > 0) {
    process.stdout.write(`FAIL page errors: ${errors.length} (listed on stderr)\n`);
    process.exitCode = 1;
  }
  if (args.p95 !== null) {
    const over = stats.p95 > args.p95;
    process.stdout.write(`${over ? "FAIL" : "PASS"} p95 ${ms(stats.p95)} ms ${over ? "is above" : "is within"} the ${ms(args.p95)} ms budget\n`);
    if (over) process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`perf: ${error.message}\n`);
  process.exitCode = 2;
}
