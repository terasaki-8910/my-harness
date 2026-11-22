const GAP = 16;
const PAD = 16;

export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Make a shot id usable inside a file name: reserved characters become "-", trailing dots and spaces go. */
export function safeFilePart(value, fallback) {
  const cleaned = String(value ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-").replace(/[. ]+$/u, "").trim().slice(0, 80);
  return cleaned || fallback;
}

export function pngDataUri(buffer) {
  return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
}

/** Pair shots by id: the order of `after` first, then ids that only `before` has. */
export function pairShots(before, after) {
  const beforeById = new Map(before.map((shot) => [shot.id, shot]));
  const afterIds = new Set(after.map((shot) => shot.id));
  return [
    ...after.map((shot) => ({ id: shot.id, before: beforeById.get(shot.id) ?? null, after: shot })),
    ...before.filter((shot) => !afterIds.has(shot.id)).map((shot) => ({ id: shot.id, before: shot, after: null })),
  ];
}

const STYLE = `*{box-sizing:border-box}html,body{margin:0;background:#d9d9d9;color:#161616;font:14px/1.35 "Segoe UI",system-ui,-apple-system,Arial,sans-serif}
body{padding:${PAD}px}h1{margin:0 0 4px;font-size:20px;font-weight:700;overflow-wrap:anywhere}.meta{margin:0 0 ${GAP}px;color:#4d4d4d;overflow-wrap:anywhere}
.grid{display:grid;gap:${GAP}px;align-items:start}.tile{margin:0;background:#fff;border:1px solid #a6a6a6;min-width:0}
.tile img{display:block;width:100%;height:auto}.cap{padding:8px 10px;border-top:1px solid #a6a6a6;overflow-wrap:anywhere}
.cap b{font-size:15px}.cap span{color:#4d4d4d;margin-left:8px}.cap .bad{color:#b00020;font-weight:700;margin-left:8px}
.row{grid-column:1/-1;margin-top:8px;padding-top:8px;border-top:2px solid #8c8c8c;font-size:15px;overflow-wrap:anywhere}.row span{color:#4d4d4d;margin-left:8px}
.head{font-size:16px;font-weight:700}.head small{display:block;font-weight:400;color:#4d4d4d;font-size:12px;overflow-wrap:anywhere}
.missing{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;background:#eee;border:1px dashed #8c8c8c;color:#666;font-size:18px;font-weight:700}`;

function page(title, width, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
${STYLE}body{width:${width}px}
</style></head><body>${body}</body></html>`;
}

function captionHtml({ id, label, note }) {
  const text = label && label !== id ? `<span>${escapeHtml(label)}</span>` : "";
  return `<figcaption class="cap"><b>${escapeHtml(id)}</b>${text}${note ? `<span class="bad">${escapeHtml(note)}</span>` : ""}</figcaption>`;
}

/** Contact sheet. tiles: [{ id, label?, src, note? }]; `note` is shown in red (for example "FAIL white"). */
export function sheetHtml({ title, subtitle = "", tiles, columns = 3, tileWidth = 480 }) {
  const count = Math.max(1, Math.min(columns, tiles.length));
  const items = tiles.map((tile) => `<figure class="tile"><img src="${escapeHtml(tile.src)}" alt="">${captionHtml(tile)}</figure>`).join("");
  const width = count * tileWidth + (count - 1) * GAP + 2 * PAD;
  return page(title, width, `<h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="meta">${escapeHtml(subtitle)}</p>` : ""}<main class="grid" style="grid-template-columns:repeat(${count},${tileWidth}px)">${items}</main>`);
}

function sideHtml(side) {
  if (!side) return `<div class="tile"><div class="missing">missing</div></div>`;
  return `<figure class="tile"><img src="${escapeHtml(side.src)}" alt="">${side.note ? `<figcaption class="cap"><span class="bad" style="margin:0">${escapeHtml(side.note)}</span></figcaption>` : ""}</figure>`;
}

/**
 * Before | after grid. rows: [{ id, label?, before: { src, note? } | null, after: { src, note? } | null }];
 * a null side shows the word "missing". meta: { before?, after? } is small text under the column titles.
 */
export function compareHtml({ title, rows, meta = {}, tileWidth = 560 }) {
  const width = 2 * tileWidth + GAP + 2 * PAD;
  const heading = (name) => `<div class="head">${name}${meta[name.toLowerCase()] ? `<small>${escapeHtml(meta[name.toLowerCase()])}</small>` : ""}</div>`;
  const items = rows.map((row) => `<div class="row"><b>${escapeHtml(row.id)}</b>${row.label && row.label !== row.id ? `<span>${escapeHtml(row.label)}</span>` : ""}</div>${sideHtml(row.before)}${sideHtml(row.after)}`).join("");
  return page(title, width, `<h1>${escapeHtml(title)}</h1><main class="grid" style="grid-template-columns:repeat(2,${tileWidth}px)">${heading("Before")}${heading("After")}${items}</main>`);
}
