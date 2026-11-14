import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(repositoryRoot, "scripts", "init-project.mjs");
const templateRoot = path.join(repositoryRoot, "templates", "project");
const templateFiles = [
  "AGENTS.md.tmpl",
  "CLAUDE.md.tmpl",
  path.join(".claude", "settings.json.tmpl"),
  ".gitattributes.tmpl",
  path.join("docs", "quality-gates.md.tmpl"),
];

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function allFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

test("init-project creates exact template copies and never overwrites", () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "core-init-project-"));
  try {
    const first = run([temporaryDirectory]);
    assert.equal(first.status, 0);

    for (const templateRelative of templateFiles) {
      const destinationRelative = templateRelative.replace(/\.tmpl$/, "");
      const destination = path.join(temporaryDirectory, destinationRelative);
      assert.equal(fs.existsSync(destination), true);
      assert.equal(fs.readFileSync(destination, "utf8"), fs.readFileSync(path.join(templateRoot, templateRelative), "utf8"));
    }
    assert.equal(allFiles(temporaryDirectory).some((file) => file.endsWith(".tmpl")), false);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(temporaryDirectory, ".claude", "settings.json"), "utf8")));

    const second = run([temporaryDirectory]);
    assert.equal(second.status, 0);
    assert.equal(second.stdout.match(/^skip /gm)?.length, templateFiles.length);

    const agentsPath = path.join(temporaryDirectory, "AGENTS.md");
    fs.writeFileSync(agentsPath, "kept\n");
    const third = run([temporaryDirectory]);
    assert.equal(third.status, 0);
    assert.equal(fs.readFileSync(agentsPath, "utf8"), "kept\n");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("init-project with no argument exits 1", () => {
  const result = run([]);
  assert.equal(result.status, 1);
});

test("init-project rejects a target that does not exist", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "core-init-missing-"));
  try {
    const result = run([path.join(parent, "missing")]);
    assert.equal(result.status, 1);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
