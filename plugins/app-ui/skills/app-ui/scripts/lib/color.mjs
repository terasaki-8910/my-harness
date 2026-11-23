// Pure colour math: parsing, compositing, WCAG 2 contrast, HSL. Colours are { r, g, b, a } with r, g, b in 0..255 and a in 0..1.

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function channel(text) {
  const value = text.trim();
  if (value.endsWith("%")) return clamp(Math.round((Number.parseFloat(value) / 100) * 255), 0, 255);
  return clamp(Math.round(Number.parseFloat(value)), 0, 255);
}

function alphaOf(text) {
  if (text === undefined) return 1;
  const value = text.trim();
  const number = value.endsWith("%") ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 1;
}

/**
 * Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space separated, "/" or "," before alpha,
 * numbers or percentages), color(srgb ...) and "transparent". Returns null for anything else
 * (named colours, hsl(), oklch(), color-mix()): the page resolves those in a canvas.
 */
export function parseColor(input) {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let digits = match[1];
    if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join("");
    const pair = (index) => Number.parseInt(digits.slice(index, index + 2), 16);
    return { r: pair(0), g: pair(2), b: pair(4), a: digits.length === 8 ? Math.round((pair(6) / 255) * 1000) / 1000 : 1 };
  }
  match = /^rgba?\(\s*([^)]*)\)$/.exec(text);
  if (match) {
    const [colourPart, slashAlpha] = match[1].split("/");
    const parts = colourPart.trim().split(/\s*,\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4 || (parts.length === 4 && slashAlpha !== undefined)) return null;
    const numbers = parts.slice(0, 3);
    if (!numbers.every((part) => /^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(part))) return null;
    const alphaText = parts.length === 4 ? parts[3] : slashAlpha;
    if (alphaText !== undefined && !/^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(alphaText.trim())) return null;
    return { r: channel(numbers[0]), g: channel(numbers[1]), b: channel(numbers[2]), a: alphaOf(alphaText) };
  }
  match = /^color\(\s*srgb\s+([^)]*)\)$/.exec(text);
  if (match) {
    const [colourPart, slashAlpha] = match[1].split("/");
    const parts = colourPart.trim().split(/\s+/);
    if (parts.length !== 3 || !parts.every((part) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part))) return null;
    const [r, g, b] = parts.map((part) => clamp(Math.round(Number.parseFloat(part) * 255), 0, 255));
    return { r, g, b, a: alphaOf(slashAlpha) };
  }
  return null;
}

const hex2 = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

/** "#rrggbb" in lower case; alpha is ignored. */
export function toHex(color) {
  return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
}

/** "#rrggbb", or "#rrggbb@0.5" when the colour is not opaque. */
export function describeColor(color) {
  return color.a < 1 ? `${toHex(color)}@${Math.round(color.a * 100) / 100}` : toHex(color);
}

/** `top` over `bottom` (Porter-Duff source-over). Returns an opaque colour when `bottom` is opaque. */
export function composite(top, bottom) {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (a, b) => (a * top.a + b * bottom.a * (1 - top.a)) / alpha;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: alpha };
}

const linear = (value) => {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance of an sRGB colour (alpha ignored). */
export function relativeLuminance(color) {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2 contrast ratio of two opaque colours, 1..21. */
export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** { h: 0..360, s: 0..1, l: 0..1 } */
export function rgbToHsl(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** True when every RGB channel differs by `tolerance` or less. Alpha is ignored. */
export function sameRgb(first, second, tolerance = 3) {
  return Math.abs(first.r - second.r) <= tolerance && Math.abs(first.g - second.g) <= tolerance && Math.abs(first.b - second.b) <= tolerance;
}
