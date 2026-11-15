function quote(file) {
  return `'${file.replaceAll("'", "'\\''")}'`;
}

export function buildConcat(frames, { start, duration }) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("No frames to concatenate");
  if (!(duration > 0)) throw new Error("duration must be greater than 0");
  const sorted = frames.filter((frame) => Number.isFinite(frame.ts)).toSorted((a, b) => a.ts - b.ts);
  if (sorted.length === 0) throw new Error("No timestamped frames to concatenate");
  const before = sorted.filter((frame) => frame.ts <= start).at(-1) ?? sorted[0];
  const chosen = [{ ...before, time: 0 }];
  for (const frame of sorted) {
    if (frame.ts !== before.ts && frame.ts > start && frame.ts < start + duration) chosen.push({ ...frame, time: frame.ts - start });
  }
  const unique = [];
  for (const frame of chosen) {
    if (unique.length === 0 || frame.time > unique.at(-1).time) unique.push(frame);
  }
  const segments = unique.map((frame, index) => ({ frame, duration: (index + 1 < unique.length ? unique[index + 1].time : duration) - frame.time })).filter((segment) => segment.duration > 0);
  const lines = ["ffconcat version 1.0"];
  let written = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const frameDuration = index === segments.length - 1 ? Number((duration - written).toFixed(6)) : Number(segments[index].duration.toFixed(6));
    if (frameDuration <= 0) continue;
    written += frameDuration;
    lines.push(`file ${quote(segments[index].frame.file)}`, `duration ${frameDuration.toFixed(6)}`);
  }
  const lastFile = lines.filter((line) => line.startsWith("file ")).at(-1);
  if (!lastFile) throw new Error("No positive-duration frames to concatenate");
  lines.push(lastFile);
  return `${lines.join("\n")}\n`;
}

// Gaps are measured in the middle 80% of each move, targeted click, or scroll: at the eased ends the page moves
// less than a pixel per frame, and the screencast sends frames only when the page changes.
export function captureMotionMetrics(frames, { start, actions }) {
  const inside = (time, window) => time >= window.from - 1e-9 && time <= window.to + 1e-9;
  const windows = actions
    .map((action) => ({ action, length: Number.isFinite(action.dur) ? action.dur : action.endedAt - action.startedAt }))
    .filter(({ action, length }) => (action.do === "move" || action.do === "scroll" || (action.do === "click" && action.dur > 0)) && Number.isFinite(action.startedAt) && Number.isFinite(length) && length > 0)
    .map(({ action, length }) => {
      return { index: action.index, do: action.do, from: action.startedAt + 0.1 * length, to: action.startedAt + 0.9 * length };
    });
  const relativeTimes = frames.map((frame) => frame.ts - start).filter(Number.isFinite);
  const stats = windows.map((window) => {
    const times = relativeTimes.filter((time) => inside(time, window));
    const bounded = [window.from, ...times, window.to].toSorted((a, b) => a - b);
    let maxGap = 0;
    for (let index = 1; index < bounded.length; index += 1) maxGap = Math.max(maxGap, bounded[index] - bounded[index - 1]);
    const duration = window.to - window.from;
    return { ...window, frames: times.length, fps: times.length / duration, maxGap };
  });
  const motionDuration = stats.reduce((sum, window) => sum + window.to - window.from, 0);
  if (motionDuration === 0) return { maxGap: 0, motionFps: null, windows: [] };
  const motionFrames = relativeTimes.filter((time) => stats.some((window) => inside(time, window))).length;
  return { maxGap: Math.max(0, ...stats.map((window) => window.maxGap)), motionFps: motionFrames / motionDuration, windows: stats };
}
