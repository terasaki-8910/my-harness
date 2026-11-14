import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(repositoryRoot, "hooks", "guard.mjs");

function run(input, projectDir, includeEnvironment = true) {
  const env = { ...process.env };
  if (includeEnvironment) env.CLAUDE_PROJECT_DIR = projectDir;
  else delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [script], { input, env, encoding: "utf8" });
}

test("guard CLI cases a-f", async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "core-guard-cli-"));
  try {
    await t.test("a. a protected read exits 2 with a reason only on stderr", () => {
      const result = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: path.join(temporaryDirectory, ".env") } }), temporaryDirectory);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Blocked by core guard/);
      assert.match(result.stderr, /\.env/);
      assert.equal(result.stdout, "");
    });

    await t.test("b. an ordinary read exits cleanly without output", () => {
      const result = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: path.join(temporaryDirectory, "src", "a.ts") } }), temporaryDirectory);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    });

    await t.test("c. invalid hook JSON is visible and fails open", () => {
      const result = run("not json", temporaryDirectory);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /core guard/);
    });

    fs.mkdirSync(path.join(temporaryDirectory, ".claude"));
    const configPath = path.join(temporaryDirectory, ".claude", "guard.json");
    await t.test("d. invalid guard config warns on allows and still enforces defaults", () => {
      fs.writeFileSync(configPath, "{");
      const allowed = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: path.join(temporaryDirectory, "src", "a.ts") } }), temporaryDirectory);
      assert.equal(allowed.status, 1);
      assert.match(allowed.stderr, /guard\.json/);
      const denied = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: path.join(temporaryDirectory, ".env") } }), temporaryDirectory);
      assert.equal(denied.status, 2);
    });

    await t.test("e. stdin cwd is used when the environment variable is absent", () => {
      fs.rmSync(configPath);
      const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(temporaryDirectory, ".git", "config") }, cwd: temporaryDirectory });
      const result = run(input, temporaryDirectory, false);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /\.git\/config/);
      assert.equal(result.stderr.includes(temporaryDirectory), false);
    });

    await t.test("f. project readOnly additions name their source", () => {
      fs.writeFileSync(configPath, JSON.stringify({ readOnly: ["assets/**"] }));
      const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(temporaryDirectory, "assets", "a.png") } });
      const result = run(input, temporaryDirectory);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /\.claude\/guard\.json/);
    });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
