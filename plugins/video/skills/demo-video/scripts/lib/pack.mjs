import fs from "node:fs";
import path from "node:path";

const MIME = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"],
  [".svg", "image/svg+xml"], [".ico", "image/x-icon"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ttf", "font/ttf"], [".otf", "font/otf"],
]);
const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf"]);
const REMOTE = /^(?:https?:)?\/\//i;

function tagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  return html.length;
}

function parseTag(tag) {
  const nameMatch = /^<\s*(\/?)\s*([^\s/>]+)/.exec(tag);
  if (!nameMatch) return null;
  const closing = nameMatch[1] === "/";
  const name = nameMatch[2].toLowerCase();
  const nameStart = nameMatch.index + nameMatch[0].lastIndexOf(nameMatch[2]);
  const attributes = [];
  if (!closing) {
    let index = nameStart + nameMatch[2].length;
    while (index < tag.length) {
      while (/\s/.test(tag[index] ?? "")) index += 1;
      if (tag[index] === "/" || tag[index] === ">" || index >= tag.length) break;
      const start = index;
      while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1;
      const attrName = tag.slice(start, index);
      while (/\s/.test(tag[index] ?? "")) index += 1;
      let value = null;
      let valueStart = null;
      let valueEnd = null;
      let quote = null;
      if (tag[index] === "=") {
        index += 1;
        while (/\s/.test(tag[index] ?? "")) index += 1;
        if (tag[index] === '"' || tag[index] === "'") {
          quote = tag[index++];
          valueStart = index;
          while (index < tag.length && tag[index] !== quote) index += 1;
          valueEnd = index;
          value = tag.slice(valueStart, valueEnd);
          if (tag[index] === quote) index += 1;
        } else {
          valueStart = index;
          while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1;
          valueEnd = index;
          value = tag.slice(valueStart, valueEnd);
        }
      }
      attributes.push({ name: attrName.toLowerCase(), start, end: index, value, valueStart, valueEnd, quote });
    }
  }
  return { name, closing, nameStart, nameEnd: nameStart + nameMatch[2].length, attributes };
}

function attribute(parsed, name) {
  return parsed.attributes.find((item) => item.name === name);
}

function editTag(tag, parsed, { name = null, remove = [], values = new Map() } = {}) {
  const edits = name === null ? [] : [{ start: parsed.nameStart, end: parsed.nameEnd, text: name }];
  for (const attr of parsed.attributes) {
    if (remove.includes(attr.name)) edits.push({ start: attr.start, end: attr.end, text: "" });
    else if (values.has(attr.name) && attr.valueStart !== null) edits.push({ start: attr.valueStart, end: attr.valueEnd, text: values.get(attr.name) });
  }
  return edits.toSorted((a, b) => b.start - a.start).reduce((result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`, tag);
}

function localPath(baseDirectory, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  return decoded.startsWith("/") ? path.resolve(baseDirectory, `.${decoded}`) : path.resolve(baseDirectory, decoded);
}

function isLocal(reference) {
  return Boolean(reference) && !reference.startsWith("#") && !reference.startsWith("data:") && !REMOTE.test(reference) && !/^[a-z][a-z\d+.-]*:/i.test(reference);
}

function labelReference(reference, context) {
  return `${context}: ${reference}`;
}

export async function packPage(pagePath) {
  const absolutePage = path.resolve(pagePath);
  const pageDirectory = path.dirname(absolutePage);
  const original = await fs.promises.readFile(absolutePage, "utf8");
  const problems = [];
  const counts = { stylesheets: 0, scripts: 0, images: 0, fonts: 0 };
  const movedScripts = [];

  async function dataUri(reference, baseDirectory, context) {
    if (REMOTE.test(reference)) {
      problems.push(labelReference(reference, `${context} uses a remote URL`));
      return null;
    }
    if (!isLocal(reference)) return reference;
    const file = localPath(baseDirectory, reference);
    const extension = path.extname(file).toLowerCase();
    const mime = MIME.get(extension);
    if (!mime) {
      problems.push(labelReference(reference, `${context} has an unsupported file type`));
      return null;
    }
    try {
      const content = await fs.promises.readFile(file);
      if (FONT_EXTENSIONS.has(extension)) counts.fonts += 1;
      else counts.images += 1;
      return `data:${mime};base64,${content.toString("base64")}`;
    } catch (error) {
      problems.push(labelReference(reference, `${context} cannot read local file (${error.code ?? error.message})`));
      return null;
    }
  }

  async function cssText(css, baseDirectory, context) {
    if (/@import\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) problems.push(`${context} contains CSS @import`);
    const matches = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi)];
    let result = css;
    for (const match of matches.toReversed()) {
      const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
      const uri = await dataUri(reference, baseDirectory, `${context} url()`);
      if (uri === null) continue;
      const quote = match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : "";
      const replacement = `url(${quote}${uri}${quote})`;
      result = `${result.slice(0, match.index)}${replacement}${result.slice(match.index + match[0].length)}`;
    }
    return result;
  }

  async function transformTag(tag, parsed, state) {
    const srcset = attribute(parsed, "srcset");
    if (srcset) problems.push(`${parsed.name} srcset cannot be inlined: ${srcset.value ?? ""}`);
    for (const name of ["src", "href"]) {
      const attr = attribute(parsed, name);
      if (attr?.value && REMOTE.test(attr.value)) problems.push(labelReference(attr.value, `${parsed.name} ${name} uses a remote URL`));
    }
    const style = attribute(parsed, "style");
    const values = new Map();
    if (style?.value !== null && style?.value !== undefined) values.set("style", await cssText(style.value, pageDirectory, `${parsed.name} style`));

    const sourceAttr = attribute(parsed, "src");
    if (["video", "audio", "iframe", "embed"].includes(parsed.name) && sourceAttr) {
      problems.push(`${parsed.name} with a source cannot be inlined: ${sourceAttr.value ?? ""}`);
      return editTag(tag, parsed, { values });
    }
    if (parsed.name === "object" && attribute(parsed, "data")) {
      problems.push(`object with a source cannot be inlined: ${attribute(parsed, "data").value ?? ""}`);
      return editTag(tag, parsed, { values });
    }
    if (parsed.name === "source" && sourceAttr && state.pictureDepth === 0) {
      problems.push(`source outside picture cannot be inlined: ${sourceAttr.value ?? ""}`);
      return editTag(tag, parsed, { values });
    }

    const href = attribute(parsed, "href");
    const rel = (attribute(parsed, "rel")?.value ?? "").toLowerCase().split(/\s+/);
    if (parsed.name === "a" && href?.value && isLocal(href.value)) problems.push(labelReference(href.value, "a href points to another local file"));

    const imageReference = parsed.name === "img" || parsed.name === "image" || (parsed.name === "source" && state.pictureDepth > 0)
      ? sourceAttr ?? (parsed.name === "image" ? href : null)
      : parsed.name === "link" && rel.includes("icon") ? href : null;
    if (imageReference?.value) {
      const uri = await dataUri(imageReference.value, pageDirectory, `${parsed.name} ${imageReference.name}`);
      if (uri !== null) values.set(imageReference.name, uri);
    } else if (parsed.name === "link" && href?.value && !rel.includes("stylesheet") && !href.value.startsWith("#") && isLocal(href.value)) {
      problems.push(labelReference(href.value, "link href cannot be inlined"));
    } else if (sourceAttr?.value && isLocal(sourceAttr.value) && !["script"].includes(parsed.name)) {
      problems.push(labelReference(sourceAttr.value, `${parsed.name} src cannot be inlined`));
    } else if (href?.value && isLocal(href.value) && parsed.name !== "a") {
      problems.push(labelReference(href.value, `${parsed.name} href cannot be inlined`));
    }
    const poster = attribute(parsed, "poster");
    if (poster?.value) problems.push(labelReference(poster.value, `${parsed.name} poster cannot be inlined`));
    return editTag(tag, parsed, { values });
  }

  let output = "";
  let position = 0;
  let pictureDepth = 0;
  while (position < original.length) {
    const start = original.indexOf("<", position);
    if (start === -1) { output += original.slice(position); break; }
    output += original.slice(position, start);
    if (original.startsWith("<!--", start)) {
      const end = original.indexOf("-->", start + 4);
      const stop = end === -1 ? original.length : end + 3;
      output += original.slice(start, stop);
      position = stop;
      continue;
    }
    const end = tagEnd(original, start);
    const tag = original.slice(start, end);
    const parsed = parseTag(tag);
    if (!parsed) { output += tag; position = end; continue; }

    if (parsed.closing) {
      if (parsed.name === "picture") pictureDepth = Math.max(0, pictureDepth - 1);
      output += tag;
      position = end;
      continue;
    }
    const selfClosing = /\/\s*>$/.test(tag);
    const state = { pictureDepth };
    if (parsed.name === "picture" && !selfClosing) pictureDepth += 1;

    if (parsed.name === "style") {
      const close = /<\/style\s*>/gi;
      close.lastIndex = end;
      const match = close.exec(original);
      if (!match) { problems.push("style element is missing </style>"); output += tag; position = end; continue; }
      const content = original.slice(end, match.index);
      output += `${await transformTag(tag, parsed, state)}${await cssText(content, pageDirectory, "style element")}${match[0]}`;
      position = match.index + match[0].length;
      continue;
    }

    if (parsed.name === "link" && (attribute(parsed, "rel")?.value ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      const href = attribute(parsed, "href")?.value;
      if (!href) problems.push("stylesheet link is missing href");
      else if (REMOTE.test(href)) problems.push(labelReference(href, "stylesheet href uses a remote URL"));
      else if (!isLocal(href)) problems.push(labelReference(href, "stylesheet href cannot be inlined"));
      else {
        const file = localPath(pageDirectory, href);
        try {
          const css = await fs.promises.readFile(file, "utf8");
          counts.stylesheets += 1;
          const opening = editTag(tag, parsed, { name: "style", remove: ["rel", "href"] });
          output += `${opening}${await cssText(css, path.dirname(file), `stylesheet ${href}`)}</style>`;
          position = end;
          continue;
        } catch (error) {
          problems.push(labelReference(href, `stylesheet cannot read local file (${error.code ?? error.message})`));
        }
      }
      output += tag;
      position = end;
      continue;
    }

    if (parsed.name === "script") {
      const close = /<\/script\s*>/gi;
      close.lastIndex = end;
      const match = close.exec(original);
      if (!match) { problems.push("script element is missing </script>"); output += tag; position = end; continue; }
      const src = attribute(parsed, "src")?.value;
      if (!src) {
        output += original.slice(start, match.index + match[0].length);
      } else if (REMOTE.test(src)) {
        problems.push(labelReference(src, "script src uses a remote URL"));
        output += original.slice(start, match.index + match[0].length);
      } else if (!isLocal(src)) {
        problems.push(labelReference(src, "script src cannot be inlined"));
        output += original.slice(start, match.index + match[0].length);
      } else {
        const file = localPath(pageDirectory, src);
        try {
          const code = await fs.promises.readFile(file, "utf8");
          counts.scripts += 1;
          const module = (attribute(parsed, "type")?.value ?? "").toLowerCase() === "module";
          const move = !module && (attribute(parsed, "defer") || attribute(parsed, "async"));
          const opening = editTag(tag, parsed, { remove: module ? ["src"] : ["src", "defer", "async"] });
          const inlined = `${opening}${code}${match[0]}`;
          if (move) movedScripts.push(inlined);
          else output += inlined;
        } catch (error) {
          problems.push(labelReference(src, `script cannot read local file (${error.code ?? error.message})`));
          output += original.slice(start, match.index + match[0].length);
        }
      }
      position = match.index + match[0].length;
      continue;
    }

    output += await transformTag(tag, parsed, state);
    position = end;
  }

  if (movedScripts.length > 0) {
    const matches = [...output.matchAll(/<\/body\s*>/gi)];
    const closingBody = matches.at(-1);
    if (!closingBody) problems.push("deferred or async script cannot move because </body> is missing");
    else output = `${output.slice(0, closingBody.index)}${movedScripts.join("")}${output.slice(closingBody.index)}`;
  }
  return { html: output, problems, counts };
}

export function evaluatePackedCheck({ fileUrl, requests = [], brokenImages = [], pageErrors = [], consoleErrors = [] }) {
  const fail = [];
  const pass = [];
  const external = requests.filter((url) => url !== fileUrl && !url.startsWith("data:"));
  if (external.length > 0) for (const url of external) fail.push(`request left packed file: ${url}`);
  else pass.push("requests stay within the packed file and data URLs");
  if (brokenImages.length > 0) for (const image of brokenImages) fail.push(`image has naturalWidth 0: ${image}`);
  else pass.push("all images have a natural width");
  if (pageErrors.length > 0) for (const error of pageErrors) fail.push(`page error: ${error}`);
  else pass.push("no page errors");
  if (consoleErrors.length > 0) for (const error of consoleErrors) fail.push(`console error: ${error}`);
  else pass.push("no console errors");
  return { pass, fail };
}
