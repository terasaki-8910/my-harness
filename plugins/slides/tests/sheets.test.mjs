import assert from "node:assert/strict";
import test from "node:test";
import { safeFilePart, sheetHtml } from "../skills/html-slides/scripts/lib/sheets.mjs";

test("sheet HTML labels and escapes every tile", () => {
  const html = sheetHtml({ title: "400x860", tiles: [{ id: "one < two", src: '400x860/a&b".png' }], columns: 2, tileWidth: 320 });
  assert.match(html, /repeat\(2,320px\)/);
  assert.match(html, /one &lt; two/);
  assert.match(html, /a&amp;b&quot;\.png/);
  assert.doesNotMatch(html, /one < two/);
});

test("safeFilePart keeps useful IDs and removes path separators", () => {
  assert.equal(safeFilePart("結論/次", "slide-1"), "結論-次");
  assert.equal(safeFilePart("", "slide-1"), "slide-1");
});
