import fs from "node:fs";

export function findFont({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const candidates = [];
  if (env.VIDEO_FONT) candidates.push(env.VIDEO_FONT);
  if (platform === "darwin") {
    candidates.push(
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Arial.ttf",
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    );
  } else if (platform === "win32") candidates.push("C:/Windows/Fonts/arial.ttf");
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

function escapeFilterPath(file) {
  return file.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "'\\''");
}

export function reviewFilter({ fps, width, cols, rows, font }) {
  const filters = [`fps=${fps}`, `scale=${width}:-2`];
  if (font) filters.push(`drawtext=fontfile='${escapeFilterPath(font)}':text='%{pts\\:hms}':x=8:y=8:fontcolor=white:fontsize=24:box=1:boxcolor=black@0.7:boxborderw=6`);
  filters.push(`tile=${cols}x${rows}:padding=4:color=gray`);
  return filters.join(",");
}

export function hasDrawtext(output) {
  return / drawtext /.test(output);
}

export function formatTime(seconds) {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const remainder = hundredths % 6000;
  const wholeSeconds = Math.floor(remainder / 100);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(remainder % 100).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function sheetHtml({ frames, cols, tileWidth }) {
  const tiles = frames.map((frame) => `<div class="tile"><img src="${escapeHtml(frame.src)}" alt=""><span class="label">${formatTime(frame.time)}</span></div>`).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:gray}body{width:max-content}.sheet{display:grid;grid-template-columns:repeat(${cols},${tileWidth}px);gap:4px;background:gray}.tile{position:relative;width:${tileWidth}px}.tile img{display:block;width:${tileWidth}px;height:auto}.label{position:absolute;left:0;top:0;padding:2px 6px;background:rgba(0,0,0,.65);color:white;font:16px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
</style></head><body><div class="sheet">${tiles}</div></body></html>`;
}
