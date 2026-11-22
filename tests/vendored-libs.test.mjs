import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const video = path.join(repositoryRoot, "plugins", "video", "skills", "demo-video", "scripts", "lib");
const slides = path.join(repositoryRoot, "plugins", "slides", "skills", "html-slides", "scripts", "lib");
const game3d = path.join(repositoryRoot, "plugins", "game3d", "skills", "game3d", "scripts", "lib");

test("slides browser libraries are byte-for-byte copies of video originals", () => {
  for (const name of ["chrome.mjs", "cdp.mjs", "server.mjs"]) {
    assert.deepEqual(fs.readFileSync(path.join(slides, name)), fs.readFileSync(path.join(video, name)), name);
  }
});

test("game3d browser libraries are byte-for-byte copies of video originals", () => {
  for (const name of ["chrome.mjs", "cdp.mjs", "server.mjs"]) {
    assert.deepEqual(fs.readFileSync(path.join(game3d, name)), fs.readFileSync(path.join(video, name)), name);
  }
});
