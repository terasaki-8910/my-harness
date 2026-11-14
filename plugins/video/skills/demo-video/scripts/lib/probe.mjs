export function fraction(value) {
  if (typeof value !== "string") return Number.NaN;
  const match = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(value);
  if (!match) return Number.NaN;
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  return denominator === 0 ? Number.NaN : Number(match[1]) / denominator;
}

export function summarizeFfprobe(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") ?? {};
  const duration = Number(data?.format?.duration ?? video.duration);
  return {
    codec: video.codec_name,
    pixFmt: video.pix_fmt,
    width: Number(video.width),
    height: Number(video.height),
    frameRate: fraction(video.r_frame_rate),
    duration,
    size: Number(data?.format?.size),
    audioStreams: streams.filter((stream) => stream.codec_type === "audio").length,
  };
}

export function parseMp4Boxes(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("MP4 input must be a Buffer");
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      if (offset + 16 > buffer.length) break;
      const wide = buffer.readBigUInt64BE(offset + 8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MP4 box is too large");
      size = Number(wide);
      headerSize = 16;
    } else if (size32 === 0) size = buffer.length - offset;
    if (size < headerSize || offset + size > buffer.length) break;
    boxes.push({ type, offset, size, headerSize });
    offset += size;
  }
  return boxes;
}

export async function mp4BoxOrder(input) {
  if (Buffer.isBuffer(input)) return parseMp4Boxes(input).map((box) => box.type);
  const stat = await input.stat();
  const boxes = [];
  let offset = 0;
  const header = Buffer.alloc(16);
  while (offset + 8 <= stat.size) {
    const { bytesRead } = await input.read(header, 0, 16, offset);
    if (bytesRead < 8) break;
    const size32 = header.readUInt32BE(0);
    const type = header.toString("ascii", 4, 8);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      if (bytesRead < 16) break;
      const wide = header.readBigUInt64BE(8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MP4 box is too large");
      size = Number(wide);
      headerSize = 16;
    } else if (size32 === 0) size = stat.size - offset;
    if (size < headerSize || offset + size > stat.size) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

export function parseAnalysis(stderr, totalDuration) {
  const black = [];
  const blackPattern = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  for (const match of stderr.matchAll(blackPattern)) black.push({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) });

  const freezes = [];
  let current = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /freeze_start:\s*([\d.]+)/.exec(line);
    if (start) current = { start: Number(start[1]) };
    const duration = /freeze_duration:\s*([\d.]+)/.exec(line);
    if (duration && current) current.duration = Number(duration[1]);
    const end = /freeze_end:\s*([\d.]+)/.exec(line);
    if (end && current) {
      current.end = Number(end[1]);
      current.duration ??= current.end - current.start;
      freezes.push(current);
      current = null;
    }
  }
  if (current) {
    current.end = totalDuration;
    current.duration ??= Math.max(0, totalDuration - current.start);
    freezes.push(current);
  }
  return { black, freezes };
}

export function verdict({ fileError, summary, boxes = [], analysis = { black: [], freezes: [] }, spec, render }) {
  const pass = [];
  const warn = [];
  const fail = [];
  const check = (condition, message, ok) => (condition ? fail.push(message) : pass.push(ok));
  if (fileError) {
    fail.push(`file: ${fileError}`);
    return { pass, warn, fail };
  }
  check(summary.codec !== "h264", `codec: expected h264, got ${summary.codec ?? "missing"}`, "codec: h264");
  check(summary.pixFmt !== "yuv420p", `pixel format: expected yuv420p, got ${summary.pixFmt ?? "missing"}`, "pixel format: yuv420p");
  check(summary.width !== spec.viewport.width || summary.height !== spec.viewport.height, `size: expected ${spec.viewport.width}x${spec.viewport.height}, got ${summary.width}x${summary.height}`, `size: ${summary.width}x${summary.height}`);
  check(!Number.isFinite(summary.frameRate) || Math.abs(summary.frameRate - spec.fps) > 0.01, `frame rate: expected ${spec.fps}, got ${summary.frameRate}`, `frame rate: ${summary.frameRate}`);
  const [minimum, maximum] = spec.checks.duration;
  check(!Number.isFinite(summary.duration) || summary.duration < minimum || summary.duration > maximum, `duration: ${summary.duration} is outside ${minimum}-${maximum} s`, `duration: ${summary.duration} s`);
  if (spec.checks.maxBytes !== undefined) check(summary.size > spec.checks.maxBytes, `file size: ${summary.size} exceeds ${spec.checks.maxBytes} bytes`, `file size: ${summary.size} bytes`);
  const moov = boxes.indexOf("moov");
  const mdat = boxes.indexOf("mdat");
  check(moov !== -1 && mdat !== -1 && moov > mdat, "faststart: moov box is after mdat", "faststart: moov precedes mdat");
  if (spec.checks.blackMax !== null) {
    const longest = Math.max(0, ...analysis.black.map((segment) => segment.duration));
    check(longest >= spec.checks.blackMax, `black video: ${longest.toFixed(3)} s segment exceeds limit`, "black video: no long segment");
  }
  if (summary.audioStreams > 0 && spec.checks.audio !== "allowed") warn.push(`audio: ${summary.audioStreams} stream(s) present`);
  else pass.push(summary.audioStreams > 0 ? "audio: allowed" : "audio: none");
  const freezeTime = analysis.freezes.reduce((sum, item) => sum + Math.max(0, item.duration || 0), 0);
  const staticShare = summary.duration > 0 ? freezeTime / summary.duration : 0;
  if (staticShare > spec.checks.maxStaticShare) warn.push(`static share: ${(staticShare * 100).toFixed(1)}% exceeds ${(spec.checks.maxStaticShare * 100).toFixed(1)}%`);
  else pass.push(`static share: ${(staticShare * 100).toFixed(1)}%`);
  if (!render) {
    warn.push("render report: missing; skipped action, mustShow, console, and capture timing checks");
  } else {
    for (const item of render.mustShow ?? []) if (item.visibleSec < item.min) fail.push(`mustShow ${item.label ?? item.selector}: ${item.visibleSec.toFixed(2)} s is below ${item.min} s`);
    for (const action of render.actions ?? []) {
      if (action.error) fail.push(`action ${action.index} ${action.do}: ${action.error}`);
      if (action.startedAt - action.at > 0.15) warn.push(`action ${action.index} ${action.do}: started ${(action.startedAt - action.at).toFixed(3)} s late`);
    }
    if ((render.capture?.maxGap ?? 0) > 0.2) warn.push(`capture gap: ${render.capture.maxGap.toFixed(3)} s exceeds 0.2 s`);
    if (Number.isFinite(render.capture?.motionFps) && render.capture.motionFps < 20) warn.push(`motion frame rate: ${render.capture.motionFps.toFixed(1)} fps is below 20 fps`);
    if ((render.console ?? []).length > 0) warn.push(`console: ${(render.console ?? []).length} error(s)`);
  }
  return { pass, warn, fail };
}
