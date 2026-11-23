// Reader for the DESIGN.md subset this plugin needs (the design.md format of google-labs-code/design.md, version alpha).
// `npx @google/design.md lint` stays the check for the full format; this parser reads only
// block mappings with scalar leaves and throws an Error naming the line for anything else.

const SUPPORTED = "key: value lines, nested mappings by indentation, quoted or plain scalars and # comments";

function fail(line, message) {
  return new Error(`DESIGN.md line ${line}: ${message}`);
}

/** Remove a trailing comment: a # at the start of the text or after whitespace, outside quotes. */
function stripComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (char === "\\") index += 1;
      else if (char === '"') quote = null;
    } else if (quote === "'") {
      if (char === "'") {
        if (text[index + 1] === "'") index += 1;
        else quote = null;
      }
    } else if (char === '"' || char === "'") {
      if (index === 0 || /\s/.test(text[index - 1])) quote = char;
    } else if (char === "#" && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index);
    }
  }
  return text;
}

/** Parse a quoted scalar that starts at text[0]. Returns { value, rest }. */
function parseQuoted(text, line) {
  const quote = text[0];
  let value = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (char === "\\") {
        const next = text[index + 1];
        if (next === '"' || next === "\\") {
          value += next;
          index += 1;
        } else {
          throw fail(line, `unsupported escape \\${next ?? ""} in a double-quoted string (only \\" and \\\\)`);
        }
      } else if (char === '"') {
        return { value, rest: text.slice(index + 1) };
      } else {
        value += char;
      }
    } else if (char === "'") {
      if (text[index + 1] === "'") {
        value += "'";
        index += 1;
      } else {
        return { value, rest: text.slice(index + 1) };
      }
    } else {
      value += char;
    }
  }
  throw fail(line, "unterminated quoted string");
}

function parseKey(content, line) {
  if (content === "-" || content.startsWith("- ")) throw fail(line, `sequences ("- ") are not supported; supported: ${SUPPORTED}`);
  if (content[0] === '"' || content[0] === "'") {
    const { value, rest } = parseQuoted(content, line);
    const after = rest.trimStart();
    if (!after.startsWith(":")) throw fail(line, "expected ':' after the quoted key");
    return { key: value, rest: after.slice(1) };
  }
  const match = /^([^:\s][^:]*?)\s*:(?=\s|$)/.exec(content);
  if (!match) throw fail(line, "expected 'key: value'");
  return { key: match[1], rest: content.slice(match[0].length) };
}

function parseValue(rest, line) {
  const text = rest.trim();
  if (text === "") return null;
  const first = text[0];
  if (first === '"' || first === "'") {
    const { value, rest: after } = parseQuoted(text, line);
    if (after.trim() !== "") throw fail(line, "unexpected text after a quoted string");
    return value;
  }
  if (first === "{" || first === "[") throw fail(line, "flow collections ({...} or [...]) are not supported");
  if (first === "&") throw fail(line, "anchors (&) are not supported");
  if (first === "*") throw fail(line, "aliases (*) are not supported");
  if (first === "!") throw fail(line, "tags (!) are not supported");
  if (first === "|" || first === ">") throw fail(line, `block scalars (${first}) are not supported`);
  if (text.startsWith("- ") || text === "-") throw fail(line, 'sequences ("- ") are not supported');
  if (/:(\s|$)/.test(text)) throw fail(line, "a plain value cannot contain ': '; put it in quotes");
  return text;
}

/**
 * Parse the YAML front matter of a DESIGN.md string.
 * Returns { tree, lines } where `tree` is nested plain objects with string leaves and `lines` maps a
 * dotted path to its line number.
 */
export function parseFrontMatter(text) {
  const source = String(text).replace(/^﻿/, "").split(/\r?\n/);
  if (source[0]?.trim() !== "---") throw new Error('DESIGN.md has no YAML front matter: the first line must be "---"');
  let end = -1;
  for (let index = 1; index < source.length; index += 1) {
    if (source[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) throw new Error('DESIGN.md front matter is not closed: no second "---" line');

  const tree = {};
  const lines = {};
  const frames = [{ indent: 0, object: tree, fresh: false, path: [] }];
  for (let index = 1; index < end; index += 1) {
    const lineNumber = index + 1;
    const raw = source[index];
    const indentation = /^[ \t]*/.exec(raw)[0];
    if (indentation.includes("\t")) throw fail(lineNumber, "tabs are not allowed in indentation");
    const content = stripComment(raw.slice(indentation.length)).trimEnd();
    if (content === "") continue;
    const indent = indentation.length;

    for (;;) {
      const top = frames[frames.length - 1];
      if (top.fresh) {
        if (indent > frames[frames.length - 2].indent) {
          top.indent = indent;
          top.fresh = false;
          break;
        }
        frames.pop();
        continue;
      }
      if (indent === top.indent) break;
      if (indent < top.indent) {
        frames.pop();
        if (frames.length === 0) throw fail(lineNumber, "inconsistent indentation");
        continue;
      }
      throw fail(lineNumber, "unexpected indentation");
    }

    const frame = frames[frames.length - 1];
    const { key, rest } = parseKey(content, lineNumber);
    if (Object.hasOwn(frame.object, key)) throw fail(lineNumber, `duplicate key "${key}"`);
    const value = parseValue(rest, lineNumber);
    const keyPath = [...frame.path, key];
    lines[keyPath.join(".")] = lineNumber;
    if (value === null) {
      const child = {};
      frame.object[key] = child;
      frames.push({ indent: 0, object: child, fresh: true, path: keyPath });
    } else {
      frame.object[key] = value;
    }
  }
  return { tree, lines };
}

/** Headings of the Markdown body (the text after the front matter) that start with exactly "## ", in order. */
export function bodySections(text) {
  const source = String(text).replace(/^﻿/, "").split(/\r?\n/);
  let index = 1;
  while (index < source.length && source[index].trim() !== "---") index += 1;
  const sections = [];
  let fence = null;
  for (index += 1; index < source.length; index += 1) {
    const line = source[index];
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^## (?!#)(.+?)\s*#*\s*$/.exec(line);
    if (heading) sections.push(heading[1].trim());
  }
  return sections;
}

/** "12px" -> 12, "1.5rem" or "1em" -> times 16, "13" -> 13, anything else -> null. */
export function dimensionToPx(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/.exec(value.trim());
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  return match[2] === "rem" || match[2] === "em" ? number * 16 : number;
}

const REFERENCE = /\{([^{}]+)\}/g;
const MAX_REFERENCE_DEPTH = 10;

function lookup(tree, dotted) {
  let node = tree;
  for (const part of dotted.split(".")) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

function resolveReference(tree, lines, value, where, depth = 0) {
  if (typeof value !== "string" || !value.includes("{")) return value;
  if (depth > MAX_REFERENCE_DEPTH) throw fail(lines[where] ?? "?", `references nest deeper than ${MAX_REFERENCE_DEPTH} (a loop?) at ${where}`);
  const whole = /^\{([^{}]+)\}$/.exec(value.trim());
  if (whole) {
    const target = lookup(tree, whole[1]);
    if (target === undefined) throw fail(lines[where] ?? "?", `${where} refers to {${whole[1]}}, which does not exist`);
    if (typeof target === "object") return { ...target };
    return resolveReference(tree, lines, target, whole[1], depth + 1);
  }
  return value.replace(REFERENCE, (_, dotted) => {
    const target = lookup(tree, dotted);
    if (target === undefined) throw fail(lines[where] ?? "?", `${where} refers to {${dotted}}, which does not exist`);
    if (typeof target === "object") throw fail(lines[where] ?? "?", `${where} embeds {${dotted}}, which is not a single value`);
    return resolveReference(tree, lines, target, dotted, depth + 1);
  });
}

function stringMap(section, tree, lines) {
  const result = {};
  const source = tree[section];
  if (!source || typeof source !== "object") return result;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") result[key] = resolveReference(tree, lines, value, `${section}.${key}`);
  }
  return result;
}

/**
 * Parse a DESIGN.md string.
 * Returns { name, description, colors, typography, rounded, spacing, components, sections }.
 * References such as "{colors.primary}" are resolved (at most 10 hops; a missing target throws); a reference to
 * a mapping, such as "{typography.label-lg}", becomes a copy of that mapping.
 */
export function parseDesignMd(text) {
  const { tree, lines } = parseFrontMatter(text);
  const typography = {};
  if (tree.typography && typeof tree.typography === "object") {
    for (const [name, entry] of Object.entries(tree.typography)) {
      if (!entry || typeof entry !== "object") continue;
      const resolved = {};
      for (const [prop, value] of Object.entries(entry)) {
        if (typeof value === "string") resolved[prop] = resolveReference(tree, lines, value, `typography.${name}.${prop}`);
      }
      typography[name] = resolved;
    }
  }
  const components = {};
  if (tree.components && typeof tree.components === "object") {
    for (const [name, entry] of Object.entries(tree.components)) {
      if (!entry || typeof entry !== "object") continue;
      const resolved = {};
      for (const [prop, value] of Object.entries(entry)) {
        if (typeof value === "string") resolved[prop] = resolveReference(tree, lines, value, `components.${name}.${prop}`);
      }
      components[name] = resolved;
    }
  }
  return {
    name: typeof tree.name === "string" ? tree.name : "",
    description: typeof tree.description === "string" ? tree.description : "",
    colors: stringMap("colors", tree, lines),
    typography,
    rounded: stringMap("rounded", tree, lines),
    spacing: stringMap("spacing", tree, lines),
    components,
    sections: bodySections(text),
  };
}
