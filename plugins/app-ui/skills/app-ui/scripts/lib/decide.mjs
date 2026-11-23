// Pure decisions: raw page data (from collect.js and the browser diagnostics) -> FAIL, WARN and info findings.
// Nothing here touches a browser or the file system, so every code is unit-tested with synthetic data.
import { composite, contrastRatio, describeColor, sameRgb, toHex } from "./color.mjs";
import { dimensionToPx } from "./designmd.mjs";

export const MAX_TARGET_LINES = 20;
export const ICON_FONTS = Object.freeze([
  "Material Symbols Outlined", "Material Symbols Rounded", "Material Symbols Sharp",
  "Material Icons", "Material Icons Outlined", "Material Icons Round", "Material Icons Sharp",
]);

const PLACEHOLDER_TEXT = [
  /lorem ipsum/i, /\b(john|jane) doe\b/i, /\byour name\b/i, /\bexample\.(com|org|net)\b/i, /\bacme\b/i,
  /ダミー/, /テキストテキスト/, /ここに(テキスト|文字|タイトル)/, /[〇○]{2,}/, /\bx{3,}\b/i,
];
const PLACEHOLDER_IMAGE = /placeholder|placehold\.co|via\.placeholder\.com|picsum\.photos|dummyimage/i;
const EMOJI_IGNORED = /[©®™]/gu;
const EMOJI = /\p{Extended_Pictographic}/u;

export function formatFinding(level, finding) {
  return `${level} ${finding.code}: ${finding.message}`;
}

const collapse = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clip = (value, length = 80) => {
  const text = collapse(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};
const quoted = (value) => `"${clip(value, 40)}"`;
const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
const shown = (value) => (Number.isInteger(round(value)) ? String(round(value)) : round(value).toFixed(1));

function isAutomaticFavicon(url, hasDeclaredIcon) {
  if (hasDeclaredIcon || typeof url !== "string") return false;
  try {
    return new URL(url).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * The colour a text sits on: composited from its element stack over white, or { unknown: true } when an image is in
 * the way or the text could not be sampled. A sample taken inside the viewport always contains at least the root
 * element, so an empty stack means "not sampled" (text in an inner scroll container, or outside the viewport).
 */
export function backgroundOf(stack) {
  if (!stack || stack.length === 0) return { unknown: true };
  const layers = [];
  for (const layer of stack ?? []) {
    if (layer.image) return { unknown: true };
    const colour = layer.bg ?? { r: 0, g: 0, b: 0, a: 0 };
    layers.push(colour);
    if (colour.a >= 0.999) break;
  }
  let result = { r: 255, g: 255, b: 255, a: 1 };
  for (let index = layers.length - 1; index >= 0; index -= 1) result = composite(layers[index], result);
  return { color: result };
}

export function isLargeText(fontSize, fontWeight) {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

function designTokens(designMd, collected) {
  if (!designMd) return null;
  const colors = (collected.tokens ?? []).map((token) => token.rgba).filter(Boolean);
  const families = new Set();
  const sizes = [];
  for (const entry of Object.values(designMd.typography ?? {})) {
    for (const family of String(entry.fontFamily ?? "").split(",")) {
      const name = family.trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (name) families.add(name);
    }
    const size = dimensionToPx(entry.fontSize);
    if (size !== null) sizes.push(size);
  }
  const radii = Object.values(designMd.rounded ?? {}).map(dimensionToPx).filter((value) => value !== null);
  return { colors, families, sizes, radii };
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function usedColors(colors) {
  const totals = new Map();
  for (const entry of colors) {
    if (!entry.rgba) continue;
    const label = describeColor(entry.rgba);
    totals.set(label, (totals.get(label) ?? 0) + entry.count);
  }
  return [...totals.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
}

/**
 * Decide one screen.
 * raw: { loadError, diagnostics: { consoleErrors, exceptions, failedRequests: [{ url, error }], httpErrors: [{ url, status }],
 *        requests, hasDeclaredIcon }, page }   (`page` is what collect.js returned, null when the screen did not load)
 * context: { device: { minTarget, safeTop, safeBottom }, minText, screen: { tap, tapText }, designMd, ownOrigins }
 * Returns { fail, warn, info } with findings { code, message } and an info object keyed by what it reports.
 */
export function decideScreen(raw, context) {
  const fail = [];
  const warn = [];
  const device = context.device;
  const minText = context.minText ?? 11;
  const diagnostics = raw.diagnostics ?? {};
  const info = { origins: [], contrastUnknown: { count: 0, examples: [] }, colors: [], fonts: [], fontSizes: [], radii: [] };

  const addFail = (code, message) => fail.push({ code, message });
  const addWarn = (code, message) => warn.push({ code, message });

  if (raw.loadError) {
    addFail("load", clip(raw.loadError, 300));
    return { fail, warn, info };
  }

  const page = raw.page;
  const doc = page.doc ?? {};
  const viewportWidth = doc.clientWidth ?? doc.innerWidth;
  const viewportHeight = doc.clientHeight ?? doc.innerHeight;
  const hasIcon = Boolean(diagnostics.hasDeclaredIcon);

  // FAIL
  for (const text of diagnostics.consoleErrors ?? []) addFail("console", `console.error: ${clip(text, 200)}`);
  for (const text of diagnostics.logErrors ?? []) addFail("console", `browser log: ${clip(text, 200)}`);
  for (const text of diagnostics.exceptions ?? []) addFail("console", `uncaught exception: ${clip(text, 200)}`);
  const seenRequests = new Set();
  for (const entry of diagnostics.failedRequests ?? []) {
    if (isAutomaticFavicon(entry.url, hasIcon)) continue;
    const key = `${entry.url} ${entry.error}`;
    if (seenRequests.has(key)) continue;
    seenRequests.add(key);
    addFail("request", `${entry.url} failed (${entry.error})`);
  }
  for (const entry of diagnostics.httpErrors ?? []) {
    if (isAutomaticFavicon(entry.url, hasIcon)) continue;
    const key = `${entry.url} ${entry.status}`;
    if (seenRequests.has(key)) continue;
    seenRequests.add(key);
    addFail("request", `${entry.url} returned HTTP ${entry.status}`);
  }
  for (const image of page.images ?? []) {
    if (image.complete && image.naturalWidth === 0 && image.src) addFail("image", `${image.src} did not load (naturalWidth 0)`);
  }
  if (typeof doc.scrollWidth === "number" && typeof viewportWidth === "number" && doc.scrollWidth > viewportWidth + 1) {
    addFail("overflow", `the page scrolls sideways: content is ${doc.scrollWidth}px wide in a ${viewportWidth}px viewport`);
  }
  if (doc.viewportMeta === null || doc.viewportMeta === undefined) addFail("viewport-meta", 'no <meta name="viewport">; a phone lays the page out at 980px');
  else if (!/\bwidth\s*=\s*device-width\b/i.test(doc.viewportMeta)) addFail("viewport-meta", `the viewport meta ("${clip(doc.viewportMeta, 60)}") does not set width=device-width`);
  if (context.screen?.tap || context.screen?.tapText) {
    const tap = page.tap ?? { count: 0, visibleCount: 0 };
    const what = context.screen.tap ? `tap selector "${context.screen.tap}"` : `tapText "${context.screen.tapText}"`;
    if (tap.error) addFail("tap", `${what} is not usable: ${clip(tap.error, 100)}`);
    else if (tap.visibleCount !== 1) addFail("tap", `${what} matches ${tap.visibleCount} visible elements (${tap.count} in all); it must match exactly 1`);
  }

  // WARN: touch targets (at most 20 lines)
  const targetLines = [];
  for (const item of page.interactive ?? []) {
    if (item.disabled || item.inline) continue;
    const { width, height } = item.rect;
    if (width < device.minTarget || height < device.minTarget) {
      targetLines.push(`${item.tag} ${quoted(item.text || "(no text)")} is ${shown(width)}x${shown(height)}px; the minimum is ${device.minTarget}x${device.minTarget}`);
    }
  }
  for (const message of targetLines.slice(0, MAX_TARGET_LINES)) addWarn("target", message);
  if (targetLines.length > MAX_TARGET_LINES) addWarn("target", `+${targetLines.length - MAX_TARGET_LINES} more`);

  // WARN: text size and contrast
  const unknown = [];
  for (const text of page.texts ?? []) {
    if (text.fontSize < minText) addWarn("text-size", `${shown(text.fontSize)}px is below ${minText}px: ${quoted(text.text)}`);
    const colour = text.color;
    if (!colour) continue;
    const alpha = colour.a * (text.opacity ?? 1);
    if (alpha <= 0) continue;
    const background = backgroundOf(text.stack);
    if (background.unknown) {
      unknown.push(`${text.tag}: ${clip(text.text, 30)}`);
      continue;
    }
    const foreground = composite({ ...colour, a: alpha }, background.color);
    const ratio = contrastRatio(foreground, background.color);
    const needed = isLargeText(text.fontSize, text.fontWeight) ? 3 : 4.5;
    if (ratio < needed) addWarn("contrast", `${ratio.toFixed(2)}:1 is below ${needed}:1 for ${quoted(text.text)} (${toHex(foreground)} on ${toHex(background.color)})`);
  }
  info.contrastUnknown = { count: unknown.length, examples: unknown.slice(0, 3) };

  // WARN: bars, safe areas
  for (const item of page.covered ?? []) addWarn("fixed-cover", `${item.tag} ${quoted(item.text || "(no text)")} is hidden under the ${item.edge} bar when scrolled to the ${item.edge === "top" ? "top" : "end"}`);
  for (const item of page.interactive ?? []) {
    if (item.rect.y < device.safeTop) addWarn("safe-area", `${item.tag} ${quoted(item.text || "(no text)")} starts ${shown(item.rect.y)}px from the top; the status bar needs ${device.safeTop}px`);
    const bottom = item.rect.y + item.rect.height;
    const centre = item.rect.y + item.rect.height / 2;
    if (item.inFixed && typeof viewportHeight === "number" && centre >= viewportHeight / 2 && bottom > viewportHeight - device.safeBottom) {
      addWarn("safe-area", `${item.tag} ${quoted(item.text || "(no text)")} in a bottom bar ends ${shown(viewportHeight - bottom)}px above the screen edge; keep ${device.safeBottom}px clear`);
    }
  }
  const primaries = page.primaries ?? [];
  if (primaries.length >= 2) addWarn("primary", `${primaries.length} filled primary buttons compete in the first screen: ${primaries.map((item) => quoted(item.text || "(no text)")).join(", ")}`);

  // WARN: DESIGN.md tokens
  const tokens = designTokens(context.designMd, page);
  if (tokens) {
    if (tokens.colors.length > 0) {
      const outside = (page.colors ?? []).filter((entry) => entry.rgba && entry.rgba.a > 0 && !tokens.colors.some((token) => sameRgb(entry.rgba, token)));
      for (const entries of groupBy(outside, (entry) => describeColor(entry.rgba)).values()) {
        const props = [...groupBy(entries, (entry) => entry.prop).entries()].map(([prop, list]) => `${prop} x${list.reduce((sum, entry) => sum + entry.count, 0)}`);
        const examples = [...new Set(entries.flatMap((entry) => entry.examples ?? []))].slice(0, 2).join("; ");
        addWarn("token-color", `${describeColor(entries[0].rgba)} ${props.join(", ")}${examples ? ` (${clip(examples, 60)})` : ""} is not a DESIGN.md color`);
      }
    }
    const textsOutsideIcons = (page.texts ?? []).filter((text) => !ICON_FONTS.includes(text.family));
    if (tokens.families.size > 0) {
      const outside = (page.texts ?? []).filter((text) => !tokens.families.has(String(text.family).toLowerCase()) && !ICON_FONTS.includes(text.family));
      for (const [family, list] of groupBy(outside, (text) => text.family)) {
        addWarn("token-font", `"${family}" x${list.length} is not a DESIGN.md font (${clip(`${list[0].tag}: ${list[0].text}`, 50)})`);
      }
    }
    if (tokens.sizes.length > 0) {
      const outside = textsOutsideIcons.filter((text) => !tokens.sizes.some((size) => Math.abs(size - text.fontSize) <= 0.5));
      for (const [size, list] of groupBy(outside, (text) => round(text.fontSize, 1))) {
        addWarn("token-size", `${size}px x${list.length} is not a DESIGN.md font size (${clip(`${list[0].tag}: ${list[0].text}`, 50)})`);
      }
    }
    if (tokens.radii.length > 0) {
      for (const radius of page.radii ?? []) {
        if (radius.px === 0 || radius.full) continue;
        if (tokens.radii.some((value) => Math.abs(value - radius.px) <= 0.5)) continue;
        addWarn("token-radius", `${shown(radius.px)}px x${radius.count} is not a DESIGN.md radius (${clip((radius.examples ?? []).slice(0, 2).join("; "), 60)})`);
      }
    }
  }

  // WARN: placeholders and emoji
  for (const text of page.texts ?? []) {
    if (PLACEHOLDER_TEXT.some((pattern) => pattern.test(text.text))) addWarn("placeholder", `placeholder text ${quoted(text.text)}`);
  }
  for (const image of page.images ?? []) {
    if (PLACEHOLDER_IMAGE.test(image.src ?? "")) addWarn("placeholder", `placeholder image ${image.src}`);
  }
  for (const text of page.texts ?? []) {
    if ((text.kind === "heading" || text.kind === "control") && EMOJI.test(String(text.text).replace(EMOJI_IGNORED, ""))) {
      addWarn("emoji", `emoji in ${text.kind} text ${quoted(text.text)}`);
    }
  }

  // info
  const own = new Set(context.ownOrigins ?? []);
  info.origins = [...new Set((diagnostics.requests ?? []).map(originOf).filter((origin) => origin && !own.has(origin)))].sort();
  info.colors = usedColors(page.colors ?? []);
  info.fonts = countBy((page.texts ?? []).map((text) => text.family));
  info.fontSizes = countBy((page.texts ?? []).map((text) => round(text.fontSize, 1))).sort((a, b) => a.name - b.name).map(({ name, count }) => ({ px: name, count }));
  info.radii = (page.radii ?? []).filter((radius) => radius.px > 0).map((radius) => ({ px: radius.px, full: radius.full, count: radius.count })).sort((a, b) => a.px - b.px);
  return { fail, warn, info };
}

/** Info lines ("info <code>: <message>") for one screen's info object. */
export function infoLines(info) {
  const lines = [];
  lines.push(`info origins: ${info.origins.length > 0 ? info.origins.join(", ") : "none besides the local server"}`);
  if (info.contrastUnknown.count > 0) {
    lines.push(`info contrast-unknown: ${info.contrastUnknown.count} text(s) over an image or gradient, or outside the sampled viewport, were not measured (${info.contrastUnknown.examples.join("; ")})`);
  }
  lines.push(`info colors: ${info.colors.map((entry) => `${entry.color} x${entry.count}`).join(", ") || "none"}`);
  lines.push(`info fonts: ${info.fonts.map((entry) => `${entry.name} x${entry.count}`).join(", ") || "none"}`);
  lines.push(`info font-sizes: ${info.fontSizes.map((entry) => `${entry.px}px x${entry.count}`).join(", ") || "none"}`);
  lines.push(`info radii: ${info.radii.map((entry) => `${entry.full ? "full" : `${shown(entry.px)}px`} x${entry.count}`).join(", ") || "none"}`);
  return lines;
}

/**
 * One line when the screens differ in the fonts or the colours they use, else null.
 * screens: [{ id, info }]
 */
export function crossScreenLine(screens) {
  const usable = screens.filter((screen) => screen.info);
  if (usable.length < 2) return null;
  const parts = [];
  const differences = (name, pick) => {
    const sets = usable.map((screen) => new Set(pick(screen.info)));
    const all = new Set(sets.flatMap((set) => [...set]));
    const partial = [...all].filter((value) => !sets.every((set) => set.has(value)));
    if (partial.length === 0) return;
    const where = partial.slice(0, 6).map((value) => `${value} only on ${usable.filter((screen, index) => sets[index].has(value)).map((screen) => screen.id).join("/")}`);
    parts.push(`${name} differ (${where.join("; ")}${partial.length > 6 ? `; +${partial.length - 6} more` : ""})`);
  };
  differences("fonts", (info) => info.fonts.map((entry) => entry.name));
  differences("colors", (info) => info.colors.map((entry) => entry.color));
  if (parts.length === 0) return null;
  return `info cross-screen: ${parts.join("; ")}`;
}
