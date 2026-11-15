import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const starter = fileURLToPath(new URL("../skills/html-slides/starter/", import.meta.url));
const html = fs.readFileSync(path.join(starter, "index.html"), "utf8");
const css = fs.readFileSync(path.join(starter, "style.css"), "utf8");
const js = fs.readFileSync(path.join(starter, "app.js"), "utf8");

test("starter is content-free and uses no external or image files", () => {
  const files = fs.readdirSync(starter, { withFileTypes: true });
  assert.deepEqual(files.filter((entry) => entry.isFile()).map((entry) => entry.name).toSorted(), ["app.js", "index.html", "style.css"]);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(html, /<(?:img|picture|video)\b/i);
  assert.equal((html.match(/<section\s+class="[^"]*slide[^"]*"\s+id="(?:title|figure|list|message|closing)"/g) ?? []).length, 5);
  assert.match(html, /<svg\b/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.doesNotMatch(html, /\beyebrow\b/);
  assert.doesNotMatch(css, /\.eyebrow\b/);
  const sections = [...html.matchAll(/<section\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 5);
  for (const section of sections) assert.match(section[1], /^\s*<h[12]\b/);
});

test("every literal CSS color is defined in the first root block", () => {
  const root = css.match(/:root\s*\{[\s\S]*?\}/);
  assert.ok(root);
  const outsideRoot = css.slice(0, root.index) + css.slice(root.index + root[0].length);
  const literalColor = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color)\s*\(/gi;
  assert.deepEqual(outsideRoot.match(literalColor) ?? [], []);
  assert.ok((root[0].match(/#[0-9a-f]{6}\b/gi) ?? []).length >= 6);
});

test("starter includes the required responsive and interaction contracts", () => {
  assert.match(html, /<html lang="ja">/);
  assert.match(css, /word-break:\s*auto-phrase/);
  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /p, dd, li\s*\{\s*text-wrap:\s*pretty/);
  assert.match(css, /h1, h2\s*\{\s*text-wrap:\s*balance/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*scroll-snap-type:\s*y proximity/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*--gutter:\s*16px/);
  const accentSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--color-accent\)[^{}]*\}/g)].map((match) => match[1].trim());
  assert.deepEqual(accentSelectors, [":focus-visible", '.topnav a[aria-current="true"]', ".figure-node-accent"]);
  assert.match(css, /\.point-list span\s*\{\s*color:\s*var\(--color-muted\)/);
  assert.match(js, /var DURATION = 450/);
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", "ArrowLeft", "ArrowUp", "PageUp", "Home", "End"]) assert.match(js, new RegExp(key));
  assert.match(js, /history\.replaceState/);
  assert.match(js, /window\.__slidesReady = true/);
});
