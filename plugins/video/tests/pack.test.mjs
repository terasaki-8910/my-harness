import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackedCheck, packPage } from "../skills/demo-video/scripts/lib/pack.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packScript = path.join(testDirectory, "..", "skills", "demo-video", "scripts", "pack.mjs");

async function fixture(files) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-pack-test-"));
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const file = path.join(directory, name);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content);
  }));
  return directory;
}

test("pack inlines CSS assets, scripts, images and icon while preserving placement rules", async () => {
  const directory = await fixture({
    "index.html": '<!DOCTYPE html>\n<HTML><head><link rel="icon" href="icon.ico"><link rel="stylesheet" href="css/app.css"><script type="module" src="module.js"></script><script defer src="first.js"></script></head><body><p data-keep="byte identical" style="background:url(bg.png)">Hello</p><a href="#local">Local</a><picture><source src="pic.webp"><img src="photo.jpg"></picture><svg><image href="vector.svg"></image></svg><script async src="second.js"></script></body></HTML>',
    "css/app.css": '@font-face{font-family:x;src:url("font.woff2")}body{background:url(../css-bg.png)}',
    "module.js": "window.moduleLoaded=true;", "first.js": "window.first=true;", "second.js": "window.second=true;",
    "icon.ico": Buffer.from([1]), "bg.png": Buffer.from([2]), "pic.webp": Buffer.from([3]), "photo.jpg": Buffer.from([4]),
    "vector.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "css/font.woff2": Buffer.from([5]), "css-bg.png": Buffer.from([6]),
  });
  try {
    const result = await packPage(path.join(directory, "index.html"));
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.counts, { stylesheets: 1, scripts: 3, images: 6, fonts: 1 });
    assert.match(result.html, /<style\s*>@font-face/);
    assert.match(result.html, /data:font\/woff2;base64/);
    assert.match(result.html, /data:image\/jpeg;base64/);
    assert.match(result.html, /data:image\/svg\+xml;base64/);
    assert.match(result.html, /data-keep="byte identical"/);
    assert.match(result.html, /^<!DOCTYPE html>\n<HTML>/);
    const moduleAt = result.html.indexOf("window.moduleLoaded=true;");
    const bodyAt = result.html.indexOf("<body>");
    const firstAt = result.html.indexOf("window.first=true;");
    const secondAt = result.html.indexOf("window.second=true;");
    const bodyEnd = result.html.indexOf("</body>");
    assert.ok(moduleAt < bodyAt, "module stays in place");
    assert.ok(bodyAt < firstAt && firstAt < secondAt && secondAt < bodyEnd, "classic defer/async scripts move in document order to body end");
    assert.match(result.html.slice(0, bodyAt), /<script type="module"\s*>window\.moduleLoaded/);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("pack reports every prohibited reference and missing input without producing a usable result", async () => {
  const cases = [
    ["remote src", '<img src="https://example.com/a.png">', /remote URL/],
    ["remote href", '<link rel="icon" href="//example.com/a.ico">', /remote URL/],
    ["remote CSS url", '<p style="background:url(http://example.com/a.png)">x</p>', /remote URL/],
    ["srcset", '<img src="data:image/png;base64,AA==" srcset="a.png 1x">', /srcset cannot be inlined/],
    ["video", '<video src="movie.mp4"></video>', /video with a source/],
    ["audio", '<audio src="sound.mp3"></audio>', /audio with a source/],
    ["iframe", '<iframe src="frame.html"></iframe>', /iframe with a source/],
    ["embed", '<embed src="thing.bin">', /embed with a source/],
    ["object", '<object data="thing.bin"></object>', /object with a source/],
    ["media source", '<video><source src="movie.mp4"></video>', /source outside picture/],
    ["local link", '<a href="other.html">other</a>', /another local file/],
    ["missing", '<img src="missing.png">', /cannot read local file/],
    ["CSS import", '<style>@import "more.css";</style>', /CSS @import/],
  ];
  for (const [name, body, expected] of cases) {
    const directory = await fixture({ "index.html": `<!doctype html><body>${body}</body>` });
    try {
      const result = await packPage(path.join(directory, "index.html"));
      assert.ok(result.problems.some((problem) => expected.test(problem)), `${name}: ${result.problems.join(" | ")}`);
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  }
});

test("packed-page check decision is pure and reports each failure", () => {
  const good = evaluatePackedCheck({ fileUrl: "file:///tmp/out.html", requests: ["file:///tmp/out.html", "data:image/png;base64,AA=="] });
  assert.equal(good.fail.length, 0);
  assert.equal(good.pass.length, 4);
  const bad = evaluatePackedCheck({
    fileUrl: "file:///tmp/out.html", requests: ["file:///tmp/out.html", "https://example.com/x"],
    brokenImages: ["bad.png"], pageErrors: ["boom"], consoleErrors: ["bad log"],
  });
  for (const prefix of ["request", "image", "page error", "console error"]) assert.ok(bad.fail.some((message) => message.startsWith(prefix)), prefix);
});

test("pack CLI exits 1 and leaves an existing output byte-identical on failure", async () => {
  const directory = await fixture({ "index.html": '<img src="missing.png">', "out.html": "keep me" });
  try {
    const result = spawnSync(process.execPath, [packScript, path.join(directory, "index.html"), path.join(directory, "out.html")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^FAIL /m);
    assert.equal(await fs.promises.readFile(path.join(directory, "out.html"), "utf8"), "keep me");
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
