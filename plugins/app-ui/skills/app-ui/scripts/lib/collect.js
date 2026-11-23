// Browser script. browser.mjs evaluates it as `(<this file>)(options)` inside the page, so this file is one function
// expression with no imports. It returns plain JSON and changes nothing in the page except the scroll position,
// which it restores to 0 before it returns.
//
// options: { tap, tapText, tokenColors: [{ name, value }] }
// All rects are { x, y, width, height } in CSS px, measured at scrollY 0 (so document and viewport coordinates agree)
// unless stated. "Viewport" below means the layout viewport (clientWidth x clientHeight of the scrolling element),
// not window.innerWidth: a mobile-emulated page that is wider than the screen is zoomed out and then reports a
// larger innerWidth.
(function collect(options) {
  "use strict";
  const opts = options || {};
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option], [onclick], [tabindex]:not([tabindex="-1"])';
  const SKIP_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "DESC", "OPTION", "OPTGROUP"]);
  const IMAGE_LAYER = /^(img|video|canvas|svg|picture|iframe)$/i;
  const SVG_SHAPES = "svg path, svg rect, svg circle, svg ellipse, svg line, svg polyline, svg polygon";
  const scroller = document.scrollingElement || document.documentElement;
  const root = document.documentElement;
  const round = (value) => Math.round(value * 100) / 100;
  const collapse = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const clip = (value, length) => collapse(value).slice(0, length || 60);

  // ---- colour: numeric parse for rgb(), rgba(), hex and color(srgb); a 1x1 canvas only for everything else ----
  // A canvas stores premultiplied alpha, so a low-alpha colour read back from it loses its RGB values.
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context2d = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();
  const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)%?";
  const channel = (text) => {
    const number = parseFloat(text);
    const value = /%$/.test(text) ? (number / 100) * 255 : number;
    return Math.min(255, Math.max(0, Math.round(value)));
  };
  const alphaOf = (text) => {
    if (text === undefined || text === "") return 1;
    const number = /%$/.test(text) ? parseFloat(text) / 100 : parseFloat(text);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1;
  };
  function parseNumeric(text) {
    let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
    if (match) {
      let digits = match[1];
      if (digits.length <= 4) digits = digits.split("").map((digit) => digit + digit).join("");
      const pair = (index) => parseInt(digits.slice(index, index + 2), 16);
      return { r: pair(0), g: pair(2), b: pair(4), a: digits.length === 8 ? Math.round((pair(6) / 255) * 1000) / 1000 : 1 };
    }
    match = new RegExp("^rgba?\\(\\s*(" + NUMBER + ")[\\s,]+(" + NUMBER + ")[\\s,]+(" + NUMBER + ")(?:\\s*[,/]\\s*(" + NUMBER + "))?\\s*\\)$").exec(text);
    if (match) return { r: channel(match[1]), g: channel(match[2]), b: channel(match[3]), a: alphaOf(match[4]) };
    match = new RegExp("^color\\(\\s*srgb\\s+(" + NUMBER + ")\\s+(" + NUMBER + ")\\s+(" + NUMBER + ")(?:\\s*/\\s*(" + NUMBER + "))?\\s*\\)$").exec(text);
    if (match) {
      const unit = (value) => Math.min(255, Math.max(0, Math.round(parseFloat(value) * 255)));
      return { r: unit(match[1]), g: unit(match[2]), b: unit(match[3]), a: alphaOf(match[4]) };
    }
    return null;
  }
  function viaCanvas(text) {
    context2d.fillStyle = "rgb(1, 2, 3)";
    context2d.fillStyle = text;
    if (context2d.fillStyle === "#010203" && text.replace(/\s+/g, "").toLowerCase() !== "rgb(1,2,3)") return null;
    context2d.clearRect(0, 0, 1, 1);
    context2d.fillRect(0, 0, 1, 1);
    const data = context2d.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: Math.round((data[3] / 255) * 1000) / 1000 };
  }
  function resolveColor(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().toLowerCase();
    if (text === "") return null;
    if (colorCache.has(text)) return colorCache.get(text);
    let result = text === "transparent" ? { r: 0, g: 0, b: 0, a: 0 } : parseNumeric(text);
    if (!result) {
      try { result = viaCanvas(text); } catch (error) { result = null; }
    }
    colorCache.set(text, result);
    return result;
  }
  const rgbaKey = (c) => c.r + "," + c.g + "," + c.b + "," + c.a;

  // ---- element helpers ----
  const styles = new Map();
  const style = (element) => {
    let value = styles.get(element);
    if (!value) { value = getComputedStyle(element); styles.set(element, value); }
    return value;
  };
  const opacities = new Map();
  function opacityOf(element) {
    if (!element) return 1;
    if (opacities.has(element)) return opacities.get(element);
    const own = parseFloat(style(element).opacity);
    const value = opacityOf(element.parentElement) * (Number.isFinite(own) ? own : 1);
    opacities.set(element, value);
    return value;
  }
  const rectOf = (rect) => ({ x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) });
  function isVisible(element) {
    const computed = style(element);
    if (computed.display === "none" || computed.visibility !== "visible") return false;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    return opacityOf(element) > 0;
  }
  const tagOf = (element) => element.localName;
  function exampleOf(element, withText) {
    let label = tagOf(element);
    const first = element.classList && element.classList[0];
    if (first) label += "." + first;
    const text = withText ? clip(element.innerText || element.textContent, 24) : "";
    return text ? label + ": " + text : label;
  }
  function labelText(element) {
    if (element.localName === "input" && /^(submit|button|reset)$/i.test(element.type)) return clip(element.value);
    const own = clip(element.innerText);
    if (own) return own;
    return clip(element.getAttribute("aria-label") || element.getAttribute("title") || "");
  }
  function fixedAncestor(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const position = style(node).position;
      if (position === "fixed" || position === "sticky") return node;
    }
    return null;
  }
  function firstFamily(value) {
    const first = String(value || "").split(",")[0] || "";
    return first.trim().replace(/^["']|["']$/g, "");
  }
  function textRectOf(element) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !/\S/.test(node.nodeValue)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!(rect.width > 0 && rect.height > 0)) continue;
        left = Math.min(left, rect.left); top = Math.min(top, rect.top);
        right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
      }
    }
    return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  }

  // ---- start from a known scroll position ----
  const scrollTo = (top) => window.scrollTo({ top: top, left: 0, behavior: "instant" });
  scrollTo(0);
  const viewportWidth = scroller.clientWidth || window.innerWidth;
  const viewportHeight = scroller.clientHeight || window.innerHeight;
  const maxScroll = Math.max(0, scroller.scrollHeight - viewportHeight);
  const viewportMeta = document.querySelector('meta[name="viewport" i]');
  const doc = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: viewportWidth,
    clientHeight: viewportHeight,
    scrollWidth: scroller.scrollWidth,
    scrollHeight: scroller.scrollHeight,
    viewportMeta: viewportMeta ? viewportMeta.getAttribute("content") || "" : null,
  };

  const images = Array.from(document.images).map((image) => ({
    src: image.currentSrc || image.getAttribute("src") || "",
    complete: image.complete,
    naturalWidth: image.naturalWidth,
  }));

  // ---- interactive elements ----
  const interactiveRecords = [];
  for (const element of document.querySelectorAll(INTERACTIVE)) {
    if (!isVisible(element)) continue;
    const computed = style(element);
    let rect = element.getBoundingClientRect();
    if (element.localName === "input" && /^(checkbox|radio)$/i.test(element.type)) {
      const labels = Array.from(element.labels || []);
      const closest = element.closest("label");
      if (closest && !labels.includes(closest)) labels.push(closest);
      for (const label of labels) {
        const labelRect = label.getBoundingClientRect();
        if (labelRect.width * labelRect.height > rect.width * rect.height) rect = labelRect;
      }
    }
    let inline = false;
    if (element.localName === "a" && computed.display === "inline") {
      let block = element.parentElement;
      while (block && /^inline/.test(style(block).display) && block !== document.body) block = block.parentElement;
      if (block) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && !inline; node = walker.nextNode()) {
          if (!/\S/.test(node.nodeValue)) continue;
          const parent = node.parentElement;
          if (parent && !parent.closest(INTERACTIVE)) inline = true;
        }
      }
    }
    interactiveRecords.push({
      element: element,
      data: {
        tag: tagOf(element),
        text: labelText(element),
        rect: rectOf(rect),
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        inline: inline,
        inFixed: fixedAncestor(element) !== null,
        bg: resolveColor(computed.backgroundColor),
      },
    });
  }

  // ---- texts ----
  const textRecords = [];
  const headingSelector = "h1, h2, h3, h4, h5, h6, [role=heading]";
  const controlSelector = INTERACTIVE + ", label, nav, [role=tab]";
  for (const element of document.body ? document.body.querySelectorAll("*") : []) {
    if (SKIP_TEXT_TAGS.has(element.tagName)) continue;
    let hasText = false;
    for (const node of element.childNodes) if (node.nodeType === 3 && /\S/.test(node.nodeValue)) { hasText = true; break; }
    if (!hasText || !isVisible(element)) continue;
    const rect = textRectOf(element);
    if (!rect) continue;
    const computed = style(element);
    const direct = Array.from(element.childNodes).filter((node) => node.nodeType === 3 && /\S/.test(node.nodeValue)).map((node) => node.nodeValue).join(" ");
    const weight = parseInt(computed.fontWeight, 10);
    textRecords.push({
      element: element,
      rect: rect,
      fixed: fixedAncestor(element),
      data: {
        tag: tagOf(element),
        text: clip(direct),
        rect: rectOf(rect),
        fontSize: round(parseFloat(computed.fontSize)),
        fontWeight: Number.isFinite(weight) ? weight : 400,
        family: firstFamily(computed.fontFamily),
        color: resolveColor(computed.color),
        opacity: round(opacityOf(element)),
        kind: element.closest(headingSelector) ? "heading" : element.closest(controlSelector) ? "control" : "text",
        stack: [],
      },
    });
  }

  // ---- background stack under each text, sampled with the point inside the viewport ----
  function stackAt(record) {
    const rect = record.rect;
    const x = rect.left + rect.width / 2;
    const docY = rect.top + rect.height / 2;
    let y;
    if (record.fixed) {
      scrollTo(0);
      y = docY;
    } else if (docY < viewportHeight - 1) {
      scrollTo(0);
      y = docY;
    } else {
      scrollTo(Math.min(maxScroll, Math.max(0, docY - viewportHeight / 2)));
      y = docY - window.scrollY;
    }
    if (x < 0 || x >= viewportWidth || y < 0 || y >= viewportHeight) return [];
    const list = document.elementsFromPoint(x, y);
    let start = list.indexOf(record.element);
    for (let node = record.element.parentElement; start < 0 && node; node = node.parentElement) start = list.indexOf(node);
    if (start < 0) return [];
    const stack = [];
    for (let index = start; index < list.length; index += 1) {
      const layer = list[index];
      const computed = style(layer);
      const bg = resolveColor(computed.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
      const image = computed.backgroundImage !== "none" || IMAGE_LAYER.test(layer.localName);
      stack.push({ bg: bg, image: image });
      if (image || bg.a >= 0.999) break;
    }
    return stack;
  }
  for (const record of textRecords) record.data.stack = stackAt(record);
  scrollTo(0);

  // ---- colours ----
  const colorMap = new Map();
  function addColor(prop, color, element, withText) {
    if (!color) return;
    const key = prop + "|" + rgbaKey(color);
    let entry = colorMap.get(key);
    if (!entry) { entry = { prop: prop, rgba: color, count: 0, examples: [] }; colorMap.set(key, entry); }
    entry.count += 1;
    if (entry.examples.length < 3) {
      const example = exampleOf(element, withText);
      if (!entry.examples.includes(example)) entry.examples.push(example);
    }
  }
  for (const record of textRecords) addColor("color", record.data.color, record.element, true);

  const radiusMap = new Map();
  const everything = Array.from(document.querySelectorAll("html, body, body *"));
  for (const element of everything) {
    if (SKIP_TEXT_TAGS.has(element.tagName) || !isVisible(element)) continue;
    const computed = style(element);
    const background = resolveColor(computed.backgroundColor);
    const hasBackground = Boolean(background && background.a > 0);
    if (hasBackground) addColor("background", background, element, true);
    let hasBorder = false;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const borderStyle = computed["border" + side + "Style"];
      if (!(parseFloat(computed["border" + side + "Width"]) > 0) || borderStyle === "none" || borderStyle === "hidden") continue;
      const color = resolveColor(computed["border" + side + "Color"]);
      if (color && color.a > 0) { hasBorder = true; addColor("border", color, element, false); }
    }
    const isImage = element.localName === "img";
    if (hasBackground || computed.backgroundImage !== "none" || hasBorder || isImage) {
      const box = element.getBoundingClientRect();
      let px = 0;
      for (const corner of ["TopLeft", "TopRight", "BottomRight", "BottomLeft"]) {
        const first = String(computed["border" + corner + "Radius"]).trim().split(/\s+/)[0] || "0";
        const value = /%$/.test(first) ? (parseFloat(first) / 100) * box.width : parseFloat(first);
        if (Number.isFinite(value)) px = Math.max(px, value);
      }
      px = round(px);
      let entry = radiusMap.get(px);
      if (!entry) {
        entry = { px: px, full: px > 0 && px >= Math.min(box.width, box.height) / 2 - 1, count: 0, examples: [] };
        radiusMap.set(px, entry);
      }
      entry.count += 1;
      if (entry.examples.length < 3) {
        const example = exampleOf(element, true);
        if (!entry.examples.includes(example)) entry.examples.push(example);
      }
    }
  }
  for (const element of document.querySelectorAll(SVG_SHAPES)) {
    if (!isVisible(element)) continue;
    const computed = style(element);
    for (const prop of ["fill", "stroke"]) {
      const value = computed[prop];
      if (!value || value === "none" || /^url\(/i.test(value)) continue;
      addColor(prop, resolveColor(value), element, false);
    }
  }

  // ---- primaries: filled, saturated, button-sized controls in the first screen ----
  function hsl(color) {
    const r = color.r / 255, g = color.g / 255, b = color.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const delta = max - min;
    return { s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l: l };
  }
  const primaries = [];
  for (const record of interactiveRecords) {
    const data = record.data;
    if (!data.bg || data.bg.a < 0.9) continue;
    if (!(data.rect.y < viewportHeight && data.rect.y + data.rect.height > 0)) continue;
    if (data.rect.width < 44 || data.rect.height < 32) continue;
    const color = hsl(data.bg);
    if (color.s >= 0.35 && color.l >= 0.15 && color.l <= 0.85) primaries.push({ text: data.text, rect: data.rect, rgba: data.bg });
  }

  // ---- fixed and sticky bars ----
  const bars = [];
  const fixed = [];
  const viewportArea = viewportWidth * viewportHeight;
  for (const element of everything) {
    const position = style(element).position;
    if (position !== "fixed" && position !== "sticky") continue;
    if (element.parentElement && fixedAncestor(element.parentElement)) continue;
    if (!isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (!(area > 0 && area < viewportArea * 0.6)) continue;
    const edge = rect.top < viewportHeight / 2 ? "top" : "bottom";
    fixed.push({ rect: rectOf(rect), edge: edge });
    bars.push({ element: element, edge: edge });
  }

  // ---- content hidden under a bar: top bars at scroll 0, bottom bars at the end of the page ----
  const covered = [];
  const candidates = new Map();
  for (const record of interactiveRecords) candidates.set(record.element, { kind: "box", tag: record.data.tag, text: record.data.text });
  for (const record of textRecords) if (!candidates.has(record.element)) candidates.set(record.element, { kind: "text", tag: record.data.tag, text: record.data.text });
  for (const bar of bars) {
    scrollTo(bar.edge === "top" ? 0 : maxScroll);
    const barRect = bar.element.getBoundingClientRect();
    for (const [element, info] of candidates) {
      if (bar.element.contains(element) || element.contains(bar.element)) continue;
      const rect = info.kind === "text" ? textRectOf(element) : element.getBoundingClientRect();
      if (!rect) continue;
      const left = Math.max(rect.left, barRect.left), right = Math.min(rect.right, barRect.right);
      const top = Math.max(rect.top, barRect.top), bottom = Math.min(rect.bottom, barRect.bottom);
      if (right - left < 4 || bottom - top < 4) continue;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (hit && (hit === bar.element || bar.element.contains(hit))) covered.push({ tag: info.tag, text: info.text, edge: bar.edge });
    }
  }
  scrollTo(0);

  // ---- the element the flow taps ----
  let tap;
  if (opts.tap || opts.tapText) {
    tap = { count: 0, visibleCount: 0, rect: null };
    let matches = [];
    try {
      if (opts.tap) {
        const found = Array.from(document.querySelectorAll(opts.tap));
        tap.count = found.length;
        matches = found.filter(isVisible);
      } else {
        const wanted = collapse(opts.tapText);
        const all = Array.from(document.querySelectorAll(INTERACTIVE));
        const texts = (element) => [labelText(element), collapse(element.getAttribute("aria-label"))];
        const equal = all.filter((element) => texts(element).includes(wanted));
        const chosen = equal.length > 0 ? equal : all.filter((element) => texts(element).some((text) => text.includes(wanted)));
        tap.count = chosen.length;
        matches = chosen.filter(isVisible);
      }
      tap.visibleCount = matches.length;
      if (matches.length === 1) {
        tap.rect = rectOf(matches[0].getBoundingClientRect());
        tap.inFixed = fixedAncestor(matches[0]) !== null;
      }
    } catch (error) {
      tap.error = String(error && error.message ? error.message : error);
    }
  }

  const tokens = (opts.tokenColors || []).map((token) => ({ name: token.name, value: token.value, rgba: resolveColor(token.value) }));

  scrollTo(0);
  return {
    doc: doc,
    images: images,
    interactive: interactiveRecords.map((record) => record.data),
    texts: textRecords.map((record) => record.data),
    colors: Array.from(colorMap.values()),
    radii: Array.from(radiusMap.values()),
    primaries: primaries,
    fixed: fixed,
    covered: covered,
    tap: tap,
    tokens: tokens,
  };
})
