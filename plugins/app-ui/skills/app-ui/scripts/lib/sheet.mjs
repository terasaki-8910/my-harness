// The flow sheet: the screens of a flow side by side, in order, with the tapped element outlined and an arrow
// where one screen leads to the next. Pure HTML generation; shots.mjs renders it with Chrome.

export const PER_ROW = 5;
export const TILE_WIDTH = 300;

export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Colours are defined once, here: one grey scale and one accent. Nothing below :root uses a colour literal.
const STYLE = `:root {
  --grey-0: #ffffff;
  --grey-1: #f3f3f3;
  --grey-2: #dedede;
  --grey-3: #b5b5b5;
  --grey-5: #6b6b6b;
  --grey-9: #1c1c1c;
  --accent: #b4441e;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--grey-1); color: var(--grey-9); }
body { width: max-content; padding: 32px; font: 14px/1.4 "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Segoe UI", system-ui, sans-serif; }
header { margin-bottom: 24px; }
h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
header p { margin: 0; color: var(--grey-5); }
.row { display: flex; align-items: flex-start; margin-bottom: 40px; }
.tile { margin: 0; flex: none; }
.name { display: block; margin-bottom: 8px; font-weight: 700; overflow-wrap: anywhere; }
.name span { font-weight: 400; color: var(--grey-5); }
.shot { position: relative; background: var(--grey-0); outline: 1px solid var(--grey-3); }
.shot img { display: block; width: 100%; height: auto; }
.ring { position: absolute; outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
.missing { display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; color: var(--grey-5); background: var(--grey-2); }
.flag { margin-top: 8px; color: var(--accent); font-weight: 700; }
.note { margin-top: 8px; color: var(--grey-5); font-size: 12px; }
.gap { flex: none; width: 56px; align-self: stretch; display: flex; align-items: center; justify-content: center; padding-top: 28px; color: var(--accent); }
.gap svg { width: 32px; height: 32px; }
.cont { margin-top: 8px; color: var(--accent); font-weight: 700; }`;

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>';

const percent = (value, whole) => `${Math.round((value / whole) * 10000) / 100}%`;

function tileHtml(tile, viewport, tileWidth, continues) {
  const name = `<span class="name">${escapeHtml(tile.label)} <span>(${escapeHtml(tile.id)})</span></span>`;
  let shot;
  if (tile.src) {
    const ring = tile.tap
      ? `<span class="ring" style="left:${percent(tile.tap.x, viewport.width)};top:${percent(tile.tap.y, viewport.height)};width:${percent(tile.tap.width, viewport.width)};height:${percent(tile.tap.height, viewport.height)}"></span>`
      : "";
    shot = `<div class="shot"><img src="${escapeHtml(tile.src)}" alt="">${ring}</div>`;
  } else {
    shot = `<div class="shot missing" style="aspect-ratio:${viewport.width}/${viewport.height}">${escapeHtml(tile.error || "no screenshot")}</div>`;
  }
  const flag = tile.blank ? `<div class="flag">blank: ${escapeHtml(tile.blank)}</div>` : "";
  const note = tile.scrollY > 0 ? `<div class="note">scrolled ${escapeHtml(Math.round(tile.scrollY))}px to show the tapped element</div>` : "";
  const cont = continues ? `<div class="cont">&darr; next: ${escapeHtml(continues)}</div>` : "";
  return `<figure class="tile" style="width:${tileWidth}px">${name}${shot}${flag}${note}${cont}</figure>`;
}

/**
 * tiles: [{ id, label, src, tap: { x, y, width, height } | null, scrollY, blank, error, nextIsFollowing }]
 * `src` is a URL or data: URI of the screenshot; `tap` is in viewport CSS px; `nextIsFollowing` is true when the
 * screen's "next" names the screen after it in the flow.
 */
export function sheetHtml({ flowName, device, width, height, date, tiles, perRow = PER_ROW, tileWidth = TILE_WIDTH }) {
  const viewport = { width, height };
  const rows = [];
  for (let start = 0; start < tiles.length; start += perRow) rows.push(tiles.slice(start, start + perRow));
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((tile, index) => {
      const last = index === row.length - 1;
      const globalIndex = rowIndex * perRow + index;
      const continues = last && tile.nextIsFollowing && globalIndex < tiles.length - 1 ? tiles[globalIndex + 1].id : null;
      const gap = last ? "" : `<div class="gap">${tile.nextIsFollowing ? ARROW : ""}</div>`;
      return tileHtml(tile, viewport, tileWidth, continues) + gap;
    });
    return `<section class="row">${cells.join("")}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(flowName)}</title><style>
${STYLE}
</style></head><body>
<header><h1>${escapeHtml(flowName)}</h1><p>${escapeHtml(device)} &middot; ${width}x${height} &middot; ${escapeHtml(date)} &middot; ${tiles.length} screen${tiles.length === 1 ? "" : "s"}</p></header>
${body}
</body></html>
`;
}
