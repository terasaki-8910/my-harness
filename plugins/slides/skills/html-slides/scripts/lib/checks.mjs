export const DEFAULT_WIDTHS = Object.freeze([
  Object.freeze({ width: 1920, height: 1080, label: "1920x1080" }),
  Object.freeze({ width: 1280, height: 800, label: "1280x800" }),
  Object.freeze({ width: 400, height: 860, label: "400x860" }),
]);

export function parseWidths(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("--widths needs a comma-separated WIDTHxHEIGHT list");
  return value.split(",").map((part) => {
    const match = /^(\d+)x(\d+)$/i.exec(part.trim());
    if (!match) throw new Error(`Invalid viewport: ${part}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error(`Invalid viewport: ${part}`);
    return { width, height, label: `${width}x${height}` };
  });
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} needs a value`);
  return value;
}

export function parseCheckArguments(argv) {
  const result = { page: null, widths: DEFAULT_WIDTHS.map((item) => ({ ...item })), slides: "section.slide", report: null, baseline: null, dupMin: 12 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--widths") result.widths = parseWidths(takeValue(argv, index++, argument));
    else if (argument === "--slides") result.slides = takeValue(argv, index++, argument);
    else if (argument === "--report") result.report = takeValue(argv, index++, argument);
    else if (argument === "--baseline") result.baseline = takeValue(argv, index++, argument);
    else if (argument === "--dup-min") {
      const raw = takeValue(argv, index++, argument);
      result.dupMin = Number(raw);
      if (!Number.isSafeInteger(result.dupMin) || result.dupMin < 1) throw new Error("--dup-min needs a positive integer");
    } else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else if (result.page === null) result.page = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!result.page) throw new Error('Usage: check.mjs <page.html | URL> [--widths 1920x1080,1280x800,400x860] [--slides "section.slide"] [--report file.json] [--baseline file.json] [--dup-min 12]');
  if (typeof result.slides !== "string" || result.slides.trim() === "") throw new Error("--slides needs a non-empty selector");
  return result;
}

export function parseShotsArguments(argv) {
  const result = { page: null, widths: DEFAULT_WIDTHS.map((item) => ({ ...item })), slides: "section.slide", out: "slides-shots" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--widths") result.widths = parseWidths(takeValue(argv, index++, argument));
    else if (argument === "--slides") result.slides = takeValue(argv, index++, argument);
    else if (argument === "--out") result.out = takeValue(argv, index++, argument);
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else if (result.page === null) result.page = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!result.page) throw new Error('Usage: shots.mjs <page.html | URL> [--widths 1920x1080,1280x800,400x860] [--slides "section.slide"] [--out dir]');
  if (result.slides.trim() === "") throw new Error("--slides needs a non-empty selector");
  if (result.out.trim() === "") throw new Error("--out needs a non-empty directory");
  return result;
}

export function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function countCharacters(value) {
  return String(value ?? "").replace(/\s/gu, "").length;
}

export function slideCounts(slides) {
  return slides.map((slide, index) => ({ id: slide.id || `slide-${index + 1}`, chars: countCharacters(slide.text) }));
}

export function baselineDiff(current, baseline) {
  const currentMap = new Map((current ?? []).map((item) => [item.id, item.chars]));
  const baselineMap = new Map((baseline ?? []).map((item) => [item.id, item.chars]));
  const ids = [...currentMap.keys(), ...[...baselineMap.keys()].filter((id) => !currentMap.has(id))];
  const slides = ids.map((id) => {
    const before = baselineMap.get(id) ?? 0;
    const after = currentMap.get(id) ?? 0;
    return { id, before, after, difference: after - before };
  });
  const before = slides.reduce((sum, item) => sum + item.before, 0);
  const after = slides.reduce((sum, item) => sum + item.after, 0);
  return { slides, total: { before, after, difference: after - before } };
}

export function groupDuplicates(blocks, minimum = 12) {
  const groups = new Map();
  for (const block of blocks ?? []) {
    const text = collapseWhitespace(block.text);
    if (countCharacters(text) < minimum || !block.slideId) continue;
    const ids = groups.get(text) ?? new Set();
    ids.add(block.slideId);
    groups.set(text, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .map(([text, ids]) => ({ text, ids: [...ids] }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

export function isAutomaticFaviconRequest(url, hasDeclaredIcon) {
  if (hasDeclaredIcon || typeof url !== "string") return false;
  try {
    return new URL(url).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

export function isInvisibleText(element) {
  return !element.rendered || element.colorAlphaZero || element.ancestorOpacityZero || element.visibilityHidden;
}

export function textOverflowWarnings(elements, tolerance = 1) {
  const warnings = [];
  for (const element of elements ?? []) {
    if (isInvisibleText(element)) continue;
    const outside = (element.textRects ?? []).some((rect) => rect.left < element.paddingBox.left - tolerance || rect.right > element.paddingBox.right + tolerance);
    if (outside) warnings.push({ kind: "text-overflow", slideId: element.slideId, path: element.path, text: collapseWhitespace(element.text).slice(0, 30) });
  }
  return warnings;
}

export function clippedTextWarnings(elements, tolerance = 1) {
  const clippedValues = new Set(["hidden", "clip", "auto"]);
  const warnings = [];
  for (const element of elements ?? []) {
    if (isInvisibleText(element) || collapseWhitespace(element.text) === "") continue;
    const clippedX = clippedValues.has(element.overflowX) && element.scrollWidth > element.clientWidth + tolerance;
    const clippedY = clippedValues.has(element.overflowY) && element.scrollHeight > element.clientHeight + tolerance;
    if (clippedX || clippedY) warnings.push({ kind: "clipped-text", slideId: element.slideId, path: element.path, text: collapseWhitespace(element.text).slice(0, 30) });
  }
  return warnings;
}

export function decideWidth(raw, tolerance = 1) {
  const fail = [];
  for (const message of raw.consoleErrors ?? []) fail.push(`console error: ${message}`);
  for (const message of raw.pageErrors ?? []) fail.push(`page error: ${message}`);
  for (const request of raw.failedRequests ?? []) {
    if (!isAutomaticFaviconRequest(request.url, raw.hasDeclaredIcon)) fail.push(`failed request: ${request.url}${request.error ? ` (${request.error})` : ""}`);
  }
  for (const response of raw.httpErrors ?? []) {
    if (!isAutomaticFaviconRequest(response.url, raw.hasDeclaredIcon)) fail.push(`HTTP ${response.status}: ${response.url}`);
  }
  for (const image of raw.images ?? []) if (image.naturalWidth === 0) fail.push(`image has naturalWidth 0: ${image.src || "(empty src)"}`);
  if (raw.scrollWidth > raw.innerWidth) fail.push(`horizontal overflow: ${raw.scrollWidth}px > ${raw.innerWidth}px`);
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) fail.push("no slide found");
  const warn = [...textOverflowWarnings(raw.elements, tolerance), ...clippedTextWarnings(raw.elements, tolerance)];
  return { fail, warn };
}
