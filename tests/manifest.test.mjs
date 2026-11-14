import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function filesUnder(relativeDirectory) {
  const root = path.join(repositoryRoot, relativeDirectory);
  if (!fs.existsSync(root)) return [];
  const results = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile()) results.push(fullPath);
    }
  }
  visit(root);
  return results;
}

test("manifest and JSON template files parse as JSON", () => {
  const files = [
    path.join(repositoryRoot, ".claude-plugin", "plugin.json"),
    path.join(repositoryRoot, ".claude-plugin", "marketplace.json"),
    path.join(repositoryRoot, "hooks", "hooks.json"),
    ...filesUnder("templates").filter((file) => file.endsWith(".json.tmpl")),
  ];
  for (const file of files) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")), file);
  }
});

test("hook commands under CLAUDE_PLUGIN_ROOT point to repository files", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "hooks", "hooks.json"), "utf8"));
  for (const eventHooks of Object.values(manifest.hooks)) {
    for (const group of eventHooks) {
      for (const hook of group.hooks) {
        const matches = hook.command?.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g) ?? [];
        for (const match of matches) {
          assert.equal(fs.existsSync(path.join(repositoryRoot, ...match[1].split("/"))), true, match[1]);
        }
      }
    }
  }
});

test("agent and optional skill descriptions are one line and at most 200 characters", () => {
  const markdownFiles = [
    ...filesUnder("agents").filter((file) => file.endsWith(".md")),
    ...filesUnder("skills").filter((file) => path.basename(file) === "SKILL.md"),
  ];
  for (const file of markdownFiles) {
    const text = fs.readFileSync(file, "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    assert.ok(frontmatter, `${file} has frontmatter`);
    const description = frontmatter[1].match(/^description:\s*(.*)$/m);
    assert.ok(description, `${file} has a description`);
    assert.equal(description[1].includes("\n"), false, `${file} description is one line`);
    assert.ok(description[1].length <= 200, `${file} description is at most 200 characters`);
  }
});
