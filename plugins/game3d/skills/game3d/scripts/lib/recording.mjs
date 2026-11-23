import { intervalStats } from "./frames.mjs";

// Pure parts of perf.mjs (which runs main() on import): the in-page recording expression, the selection of the
// frames after a one-off event, and the report lines for them.

/** A frame is counted as dropped ("slow") above this many ms: a missed 60 Hz frame is 33.3 ms. */
export const SLOW_FRAME_MS = 34;
/** How many of the slowest frames of the event window are listed. */
export const SLOWEST_COUNT = 5;

/**
 * The expression perf.mjs evaluates in the page; it resolves when the recording is over.
 *
 * Without `event` it resolves to the array of requestAnimationFrame intervals in ms, for `seconds` seconds.
 *
 * With `event` (JavaScript source: an expression, or statements separated by semicolons) it resolves to
 * { samples, eventTime, eventError }: `samples` are [time, interval] pairs in ms, `time` being the frame timestamp
 * counted from the start of the recording; `eventTime` is the timestamp of the frame in whose requestAnimationFrame
 * callback the event ran, the first one at or after `eventAt` seconds; `eventError` is the message of what the
 * event threw, or null (the recording then stops at once). The recording is extended, if needed, to
 * `eventAt` + `eventWindow` seconds after the frame the event ran in, so the window is never cut short.
 *
 * The event source is embedded as the body of a function created outside the recorder, not evaluated from a
 * string: a page's Content-Security-Policy cannot block it, and a bare name in it (start, now, end, last ...)
 * means the page's global, never one of the recorder's own variables. The newline before the closing brace keeps
 * a trailing // comment in the event from swallowing it.
 */
export function recordExpression({ seconds, event = null, eventAt = 0.5, eventWindow = 4 }) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("seconds must be a number above 0");
  if (event === null) {
    return `new Promise((resolve) => {
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
  }
  if (typeof event !== "string" || event.trim() === "") throw new Error("event must be a non-empty JavaScript source string");
  if (!Number.isFinite(eventAt) || eventAt < 0) throw new Error("eventAt must be a number of at least 0");
  if (!Number.isFinite(eventWindow) || eventWindow <= 0) throw new Error("eventWindow must be a number above 0");
  return `((__perfEvent) => new Promise((resolve) => {
  const samples = [];
  const start = performance.now();
  const eventDue = start + ${eventAt * 1000};
  let end = start + ${seconds * 1000};
  let last = null;
  let eventTime = null;
  const finish = (eventError) => resolve({ samples, eventTime, eventError });
  const tick = (now) => {
    if (last !== null) samples.push([now - start, now - last]);
    last = now;
    if (eventTime === null && now >= eventDue) {
      eventTime = now - start;
      end = Math.max(end, now + ${eventWindow * 1000});
      try { __perfEvent(); } catch (error) { finish(String((error && error.message) || error)); return; }
    }
    if (now >= end) finish(null); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}))(() => {
${event}
})`;
}

/**
 * The frames after an event, from [time, interval] samples (ms; the time of a sample is that of the frame that
 * ended the interval). A frame belongs to the window when `from` < time <= `from` + `length`: the frame that
 * the event ran in (time == `from`) ended an interval that was over before the event, so it is not counted;
 * the first frame that can show the event's cost is the next one. Returns [{ time, interval }] with `time`
 * counted from `from`. Throws when no frame falls inside.
 */
export function windowSamples(samples, { from, length }) {
  if (!Array.isArray(samples)) throw new Error("samples must be an array of [time, interval] pairs");
  if (!Number.isFinite(from) || !Number.isFinite(length) || length <= 0) throw new Error("the window needs a finite start and a length above 0");
  const frames = [];
  for (const [time, interval] of samples) {
    if (time > from && time <= from + length) frames.push({ time: time - from, interval });
  }
  if (frames.length === 0) throw new Error("no frame fell inside the event window");
  return frames;
}

/** How many intervals (numbers, ms) are longer than `threshold`; a frame of exactly the threshold does not count. */
export function countOver(intervals, threshold = SLOW_FRAME_MS) {
  return intervals.filter((interval) => interval > threshold).length;
}

/** The `count` slowest frames ({ time, interval }), longest first, earlier first among equals. */
export function slowestFrames(frames, count = SLOWEST_COUNT) {
  return [...frames].sort((a, b) => b.interval - a.interval || a.time - b.time).slice(0, count);
}

/** Statistics of the window after the event: { eventTime, stats, over, slowest } (see the functions above). */
export function summariseEvent(samples, { eventTime, windowMs }) {
  if (!Number.isFinite(eventTime)) throw new Error("the event never ran: no animation frame arrived after --event-at");
  const frames = windowSamples(samples, { from: eventTime, length: windowMs });
  const intervals = frames.map((frame) => frame.interval);
  return { eventTime, stats: intervalStats(intervals), over: countOver(intervals), slowest: slowestFrames(frames) };
}

const ms = (value) => value.toFixed(1);

/** The event block of perf.mjs's report, one line per entry, without line breaks. */
export function eventLines(summary, windowSeconds) {
  const { stats } = summary;
  const slowest = summary.slowest.map((frame) => `+${(frame.time / 1000).toFixed(2)}s ${ms(frame.interval)} ms`).join(", ");
  return [
    `event: ran ${(summary.eventTime / 1000).toFixed(2)} s into the recording, judged for the next ${windowSeconds} s`,
    `event frames: ${stats.frames}`,
    `event p50: ${ms(stats.p50)} ms`,
    `event p95: ${ms(stats.p95)} ms`,
    `event p99: ${ms(stats.p99)} ms`,
    `event max: ${ms(stats.max)} ms`,
    `event frames over ${SLOW_FRAME_MS} ms: ${summary.over}`,
    `event slowest: ${slowest}`,
  ];
}
