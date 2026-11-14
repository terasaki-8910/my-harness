import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mimeType, parseRange, resolveSafe } from "../skills/demo-video/scripts/lib/server.mjs";

test("resolveSafe accepts files under root and rejects traversal and unsafe paths", () => {
  const root = path.resolve("site");
  assert.equal(resolveSafe(root, "/assets/app.js?x=1"), path.join(root, "assets", "app.js"));
  for (const unsafe of ["/../secret", "/%2e%2e/secret", "/..%2fsecret", "/%2Fetc/passwd", "/a%5cb", "/x%00y", "//server/share"]) assert.equal(resolveSafe(root, unsafe), null, unsafe);
});

test("mimeType covers supported extensions", () => {
  const expected = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", txt: "text/plain; charset=utf-8" };
  for (const [extension, type] of Object.entries(expected)) assert.equal(mimeType(extension), type, extension);
  assert.equal(mimeType("bin"), "application/octet-stream");
});

test("parseRange handles bounded, open and suffix ranges", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=100-", 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange("bytes=-50", 1000), { start: 950, end: 999 });
  assert.deepEqual(parseRange("bytes=900-1200", 1000), { start: 900, end: 999 });
  for (const invalid of ["bytes=", "bytes=20-10", "bytes=1000-", "items=0-1", "bytes=0-1,4-5"]) assert.equal(parseRange(invalid, 1000), null, invalid);
});
