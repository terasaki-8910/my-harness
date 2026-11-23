#!/usr/bin/env node
// Frame-time probe: records requestAnimationFrame intervals of a running page.
//
// Usage: perf.mjs <url> [--seconds 15] [--warmup 3] [--size 1600x900] [--backend default] [--headed] [--dpr 1] [--p95 <ms>] [--ignore-url <substring>]... [--event <js> [--event-at 0.5] [--event-window 4]]
//
// Opens the page, waits --warmup seconds, then records requestAnimationFrame intervals inside the page for
// --seconds and prints frames, p50, p95, p99 and max in ms plus the WebGL renderer string.
// Page errors (console errors, uncaught exceptions, failed resource loads, HTTP status >= 400, Log entries of
// level error; see shots.mjs) make the exit code 1 and print "FAIL page errors", with or without --p95: the
// timing of a page that crashed says nothing. /favicon.ico is ignored and --ignore-url <substring>
// (repeatable) ignores requests whose URL contains it, for known optional assets.
// With --p95 the exit code is also 1 when the measured p95 is above that budget. Exit 2 for setup problems.
//
// --event <js> measures a one-off event, such as the first scene transition after the page has sat idle (a
// looped benchmark after a long warm-up hides the stutter of code that runs for the first time). The JavaScript
// (an expression, or statements) runs once in the page, inside the recording loop, at the first frame at or
// after --event-at seconds (default 0.5) of the recording. After the whole-recording lines an "event" block
// reports the --event-window seconds (default 4) after it: frames, p50, p95, p99, max, how many frames took more
// than 34 ms and the 5 slowest as "+seconds-after-the-event duration". --event-at plus --event-window must fit
// in --seconds (exit 2 otherwise, and for --event-at or --event-window without --event).
// With --event, --p95 judges the event window instead of the whole recording, and the verdict line says so.
// If the code throws, the recording stops, only "FAIL event threw: <message>" is printed (no statistics) and the
// exit code is 1. A syntax error in it fails the run with exit 2, after the warm-up.
//
// Headless timing is not representative of what players see (no real window, different compositing and
// vsync), so measure budgets with --headed. The default backend here is "default", the one players get.
import { intervalStats } from "./lib/frames.mjs";
import { BACKENDS, evaluate, openGamePage, parseNumber, parseSize, sleep, takeValue } from "./lib/page.mjs";
import { eventLines, recordExpression, summariseEvent } from "./lib/recording.mjs";

const USAGE = "Usage: perf.mjs <url> [--seconds 15] [--warmup 3] [--size 1600x900] [--backend default] [--headed] [--dpr 1] [--p95 <ms>] [--ignore-url <substring>]... [--event <js> [--event-at 0.5] [--event-window 4]]";
const DEFAULT_EVENT_AT = 0.5;
const DEFAULT_EVENT_WINDOW = 4;

function parseArguments(argv) {
  const result = { url: null, seconds: 15, warmup: 3, size: "1600x900", backend: "default", headed: false, dpr: 1, p95: null, ignoreUrl: [], event: null, eventAt: null, eventWindow: null };
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
    else if (argument === "--event") result.event = takeValue(argv, index++, argument);
    else if (argument === "--event-at") result.eventAt = parseNumber(takeValue(argv, index++, argument), argument, { min: 0 });
    else if (argument === "--event-window") result.eventWindow = parseNumber(takeValue(argv, index++, argument), argument, { min: 0, exclusiveMin: true });
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
    else if (result.url === null) result.url = argument;
    else throw new Error(`Unexpected argument: ${argument}\n${USAGE}`);
  }
  if (!result.url) throw new Error(USAGE);
  try { new URL(result.url); } catch { throw new Error(`Not a URL: ${result.url} (serve local files over http first)`); }
  if (!BACKENDS.includes(result.backend)) throw new Error(`Unknown backend "${result.backend}". Use one of: ${BACKENDS.join(", ")}`);
  if (result.event === null) {
    if (result.eventAt !== null) throw new Error("--event-at needs --event");
    if (result.eventWindow !== null) throw new Error("--event-window needs --event");
  } else {
    if (result.event.trim() === "") throw new Error("--event needs JavaScript to run in the page");
    result.eventAt ??= DEFAULT_EVENT_AT;
    result.eventWindow ??= DEFAULT_EVENT_WINDOW;
    // The small allowance keeps --event-at 0.1 --event-window 0.2 within --seconds 0.3.
    if (result.eventAt + result.eventWindow > result.seconds + 1e-9) {
      throw new Error(`--event-at ${result.eventAt} plus --event-window ${result.eventWindow} is ${result.eventAt + result.eventWindow} s, longer than --seconds ${result.seconds}`);
    }
  }
  return { ...result, ...parseSize(result.size) };
}

const ms = (value) => value.toFixed(1);

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const withEvent = args.event !== null;
  const opened = await openGamePage({ url: args.url, width: args.width, height: args.height, backend: args.backend, headed: args.headed, dpr: args.dpr, ignoreUrl: args.ignoreUrl });
  const { errors } = opened.diagnostics;
  let recorded;
  try {
    await sleep(args.warmup * 1000);
    const expression = recordExpression({ seconds: args.seconds, event: args.event, eventAt: args.eventAt ?? undefined, eventWindow: args.eventWindow ?? undefined });
    // The CDP call must outlive the in-page recording, so give it the recording time plus a margin.
    recorded = await evaluate(opened.chrome.cdp, opened.sessionId, expression, args.seconds + 30);
  } finally {
    await opened.chrome.close();
  }
  const reportErrors = () => {
    for (const error of errors) process.stderr.write(`perf: page error: ${error.split(/\r?\n/, 1)[0]}\n`);
  };
  // Without --event the page returns the intervals; with it, { samples: [[time, interval]...], eventTime, eventError }.
  const eventError = withEvent && typeof recorded?.eventError === "string" ? recorded.eventError : null;
  let stats = null;
  let eventSummary = null;
  if (eventError === null) {
    const samples = withEvent ? recorded?.samples : null;
    const intervals = withEvent ? (Array.isArray(samples) ? samples.map((sample) => sample[1]) : null) : recorded;
    if (!Array.isArray(intervals) || intervals.length === 0) {
      reportErrors();
      throw new Error("The page delivered no animation frames while recording (is the page hidden or throttled?)");
    }
    stats = intervalStats(intervals);
    if (withEvent) {
      try {
        eventSummary = summariseEvent(samples, { eventTime: recorded.eventTime, windowMs: args.eventWindow * 1000 });
      } catch (error) {
        reportErrors();
        throw error;
      }
    }
    process.stdout.write(`frames: ${stats.frames}\np50: ${ms(stats.p50)} ms\np95: ${ms(stats.p95)} ms\np99: ${ms(stats.p99)} ms\nmax: ${ms(stats.max)} ms\nrenderer: ${opened.renderer}\n`);
    if (eventSummary) process.stdout.write(`${eventLines(eventSummary, args.eventWindow).join("\n")}\n`);
    if (!args.headed) process.stdout.write("note: headless timing is not representative; measure budgets with --headed\n");
  }
  reportErrors();
  if (eventError !== null) {
    process.stdout.write(`FAIL event threw: ${eventError}\n`);
    process.exitCode = 1;
  }
  if (errors.length > 0) {
    process.stdout.write(`FAIL page errors: ${errors.length} (listed on stderr)\n`);
    process.exitCode = 1;
  }
  if (args.p95 !== null && stats !== null) {
    // With --event the budget judges the event window, not the whole recording.
    const judged = (eventSummary ?? { stats }).stats;
    const over = judged.p95 > args.p95;
    process.stdout.write(`${over ? "FAIL" : "PASS"} ${eventSummary ? "event window p95" : "p95"} ${ms(judged.p95)} ms ${over ? "is above" : "is within"} the ${ms(args.p95)} ms budget\n`);
    if (over) process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`perf: ${error.message}\n`);
  process.exitCode = 2;
}
