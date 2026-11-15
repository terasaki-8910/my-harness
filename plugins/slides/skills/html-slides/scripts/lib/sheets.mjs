function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function sheetHtml({ title, tiles, columns = 3, tileWidth = 360 }) {
  const items = tiles.map((tile) => `<figure class="tile"><img src="${escapeHtml(tile.src)}" alt=""><figcaption>${escapeHtml(tile.id)}</figcaption></figure>`).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#d8d8d8;color:#111;font-family:Arial,sans-serif}body{width:max-content;padding:16px}.sheet{display:grid;grid-template-columns:repeat(${columns},${tileWidth}px);gap:16px;align-items:start}.tile{margin:0;background:#fff;border:1px solid #aaa}.tile img{display:block;width:${tileWidth}px;height:auto}.tile figcaption{padding:8px 10px;border-top:1px solid #aaa;font:700 16px/1.25 Arial,sans-serif}
</style></head><body><main class="sheet">${items}</main></body></html>`;
}

export function safeFilePart(value, fallback) {
  const cleaned = String(value ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-").trim();
  return cleaned || fallback;
}
