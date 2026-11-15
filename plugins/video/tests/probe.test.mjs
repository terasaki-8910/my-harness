import assert from "node:assert/strict";
import test from "node:test";
import { mp4BoxOrder, parseAnalysis, parseMp4Boxes, summarizeFfprobe, verdict } from "../skills/demo-video/scripts/lib/probe.mjs";

function box(type, payloadSize = 0, wide = false) {
  const header = wide ? 16 : 8;
  const buffer = Buffer.alloc(header + payloadSize);
  buffer.writeUInt32BE(wide ? 1 : buffer.length, 0);
  buffer.write(type, 4, 4, "ascii");
  if (wide) buffer.writeBigUInt64BE(BigInt(buffer.length), 8);
  return buffer;
}

test("ffprobe summary parses streams, size, duration and fractional rate", () => {
  const summary = summarizeFfprobe(JSON.stringify({ format: { duration: "6.02", size: "12345" }, streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, r_frame_rate: "30000/1000" }, { codec_type: "audio" }] }));
  assert.deepEqual(summary, { codec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080, frameRate: 30, duration: 6.02, size: 12345, audioStreams: 1 });
});

test("MP4 box parser preserves top-level order including 64-bit boxes", async () => {
  const buffer = Buffer.concat([box("ftyp", 4), box("moov", 8, true), box("mdat", 3)]);
  assert.deepEqual(parseMp4Boxes(buffer).map(({ type, headerSize }) => [type, headerSize]), [["ftyp", 8], ["moov", 16], ["mdat", 8]]);
  assert.deepEqual(await mp4BoxOrder(buffer), ["ftyp", "moov", "mdat"]);
  const handle = {
    async stat() { return { size: buffer.length }; },
    async read(target, offset, length, position) {
      const bytesRead = buffer.copy(target, offset, position, Math.min(buffer.length, position + length));
      return { bytesRead, buffer: target };
    },
  };
  assert.deepEqual(await mp4BoxOrder(handle), ["ftyp", "moov", "mdat"]);
});

test("analysis parser finds black segments and closes an unfinished freeze at duration", () => {
  const parsed = parseAnalysis(`black_start:0.1 black_end:0.7 black_duration:0.6\n[freezedetect] lavfi.freezedetect.freeze_start: 1.0\n[freezedetect] lavfi.freezedetect.freeze_duration: 1.5\n[freezedetect] lavfi.freezedetect.freeze_end: 2.5\n[freezedetect] lavfi.freezedetect.freeze_start: 4.0`, 6);
  assert.deepEqual(parsed.black, [{ start: 0.1, end: 0.7, duration: 0.6 }]);
  assert.deepEqual(parsed.freezes, [{ start: 1, duration: 1.5, end: 2.5 }, { start: 4, end: 6, duration: 2 }]);
});

const spec = { viewport: { width: 1920, height: 1080 }, fps: 30, checks: { duration: [5.8, 6.2], maxBytes: 1000, blackMax: 0.5, maxStaticShare: 0.7, audio: "none" } };
const goodSummary = { codec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080, frameRate: 30, duration: 6, size: 900, audioStreams: 0 };

test("verdict reports pass, warn and fail conditions", () => {
  const good = verdict({ summary: goodSummary, boxes: ["ftyp", "moov", "mdat"], analysis: { black: [], freezes: [] }, spec, render: { mustShow: [{ selector: "#x", min: 1, visibleSec: 1.2 }], actions: [], capture: { maxGap: 0.1 }, console: [] } });
  assert.deepEqual(good.fail, []);
  assert.deepEqual(good.warn, []);
  const bad = verdict({ summary: { ...goodSummary, codec: "hevc", pixFmt: "rgb24", width: 1, frameRate: 25, duration: 8, size: 2000, audioStreams: 1 }, boxes: ["ftyp", "mdat", "moov"], analysis: { black: [{ duration: 0.5 }], freezes: [{ duration: 7 }] }, spec, render: { mustShow: [{ selector: "#x", min: 2, visibleSec: 1 }], actions: [{ index: 0, do: "click", at: 1, startedAt: 1.2, error: "failed" }], capture: { maxGap: 0.3 }, console: [{ text: "bad" }] } });
  for (const item of ["codec", "pixel format", "size", "frame rate", "duration", "file size", "faststart", "black video", "mustShow", "action 0"]) assert.ok(bad.fail.some((message) => message.startsWith(item)), item);
  for (const item of ["audio", "static share", "action 0", "capture gap", "console"]) assert.ok(bad.warn.some((message) => message.startsWith(item)), item);
  const missing = verdict({ fileError: "missing", summary: {}, spec });
  assert.deepEqual(missing.fail, ["file: missing"]);
});

test("missing render report is a warning", () => {
  const result = verdict({ summary: goodSummary, boxes: ["moov", "mdat"], analysis: { black: [], freezes: [] }, spec, render: null });
  assert.ok(result.warn.some((message) => message.startsWith("render report")));
});

test("low motion frame rate is a warning", () => {
  const result = verdict({ summary: goodSummary, boxes: ["moov", "mdat"], analysis: { black: [], freezes: [] }, spec, render: { actions: [], mustShow: [], capture: { maxGap: 0.1, motionFps: 19.9 }, console: [] } });
  assert.ok(result.warn.some((message) => message.startsWith("motion frame rate")));
});

test("each slow capture window produces a warning with its time range", () => {
  const result = verdict({ summary: goodSummary, boxes: ["moov", "mdat"], analysis: { black: [], freezes: [] }, spec, render: { actions: [], mustShow: [], capture: { maxGap: 0.3, motionFps: 30, windows: [{ from: 1.1, to: 1.9, maxGap: 0.3 }] }, console: [] } });
  assert.ok(result.warn.includes("capture window 1.100-1.900 s: 0.300 s gap exceeds 0.2 s"));
});
