import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(pluginRoot, "skills", "html-slides", "scripts", "new.mjs");
const starter = path.join(pluginRoot, "skills", "html-slides", "starter");
const names = ["app.js", "index.html", "style.css"];

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("new.mjs creates exact starter copies in a missing directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "slides-new-"));
  const destination = path.join(parent, "deck");
  try {
    const result = run([destination]);
    assert.equal(result.status, 0, result.stderr);
    for (const name of names) {
      assert.equal(fs.readFileSync(path.join(destination, name), "utf8"), fs.readFileSync(path.join(starter, name), "utf8"));
      assert.match(result.stdout, new RegExp(name.replace(".", "\\.")));
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("new.mjs refuses all writes when any destination file exists and lists conflicts", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "slides-new-existing-"));
  try {
    fs.writeFileSync(path.join(destination, "index.html"), "keep me\n");
    const result = run([destination]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /index\.html/);
    assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), "keep me\n");
    assert.equal(fs.existsSync(path.join(destination, "app.js")), false);
    assert.equal(fs.existsSync(path.join(destination, "style.css")), false);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("new.mjs needs exactly one target", () => {
  assert.equal(run([]).status, 1);
  assert.equal(run(["a", "b"]).status, 1);
});
