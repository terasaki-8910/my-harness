import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULTS, decide, globToRegExp, loadConfig } from "../hooks/guard-lib.mjs";

const projectDir = "/work/proj";
const defaultRules = [
  ...DEFAULTS.secrets.map((pattern) => ({ kind: "secret", pattern, source: "defaults" })),
  ...DEFAULTS.readOnly.map((pattern) => ({ kind: "readOnly", pattern, source: "defaults" })),
  ...DEFAULTS.allow.map((pattern) => ({ kind: "allow", pattern, source: "defaults" })),
];

function decision(tool_name, tool_input, options = {}) {
  return decide(
    { tool_name, tool_input },
    { projectDir: options.projectDir ?? projectDir, rules: options.rules ?? defaultRules },
  );
}

test("1. default .env read is denied with evidence", () => {
  const result = decision("Read", { file_path: "/work/proj/.env" });
  assert.deepEqual(
    { action: result.action, kind: result.kind, pattern: result.pattern, source: result.source, display: result.display },
    { action: "deny", kind: "secret", pattern: ".env", source: "defaults", display: ".env" },
  );
});

test("2. nested .env.local write is denied", () => {
  const result = decision("Write", { file_path: "/work/proj/config/.env.local" });
  assert.equal(result.action, "deny");
  assert.equal(result.pattern, ".env.*");
});

test("3. documented environment examples are allowed", () => {
  assert.equal(decision("Edit", { file_path: "/work/proj/.env.example" }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/.env.sample" }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/.env.template" }).action, "allow");
});

test("4. similarly named non-secret files are allowed", () => {
  assert.equal(decision("Write", { file_path: "/work/proj/.envrc" }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/src/dotenv.js" }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/src/my.env.ts" }).action, "allow");
});

test("5. .git contents are write-protected but readable", () => {
  const write = decision("Write", { file_path: "/work/proj/.git/config" });
  assert.deepEqual({ action: write.action, kind: write.kind }, { action: "deny", kind: "readOnly" });
  assert.equal(decision("Read", { file_path: "/work/proj/.git/config" }).action, "allow");
});

test("6. .git itself and nested .git directories are write-protected", () => {
  assert.equal(decision("Write", { file_path: "/work/proj/.git" }).action, "deny");
  assert.equal(decision("Write", { file_path: "/work/proj/sub/.git/HEAD" }).action, "deny");
});

test("7. .github and .gitignore are not confused with .git", () => {
  assert.equal(decision("Write", { file_path: "/work/proj/.github/workflows/ci.yml" }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/.gitignore" }).action, "allow");
});

test("8. Windows paths are normalized as strings and compared case-insensitively", () => {
  const options = { projectDir: "C:\\work\\proj" };
  const envResult = decision("Write", { file_path: "C:\\work\\proj\\.env" }, options);
  assert.deepEqual({ action: envResult.action, display: envResult.display }, { action: "deny", display: ".env" });
  assert.equal(decision("Write", { file_path: "C:\\work\\proj\\.git\\HEAD" }, options).action, "deny");
  assert.equal(decision("Write", { file_path: "c:\\work\\proj\\src\\a.ts" }, options).action, "allow");
});

test("9. NotebookEdit uses notebook_path", () => {
  assert.equal(decision("NotebookEdit", { notebook_path: "/work/proj/.git/x.ipynb" }).action, "deny");
});

test("10. MultiEdit uses file_path", () => {
  assert.equal(decision("MultiEdit", { file_path: "/work/proj/.env" }).action, "deny");
});

test("11. Grep checks its path and allows a missing path", () => {
  assert.equal(decision("Grep", { path: "/work/proj/.env" }).action, "deny");
  assert.equal(decision("Grep", { path: "/work/proj/src" }).action, "allow");
  assert.equal(decision("Grep", {}).action, "allow");
});

test("12. guard.json is write-protected but readable", () => {
  const write = decision("Write", { file_path: "/work/proj/.claude/guard.json" });
  assert.deepEqual({ action: write.action, kind: write.kind }, { action: "deny", kind: "readOnly" });
  assert.equal(decision("Read", { file_path: "/work/proj/.claude/guard.json" }).action, "allow");
});

test("13. matching ignores case", () => {
  assert.equal(decision("Read", { file_path: "/work/proj/.ENV" }).action, "deny");
});

test("14. Bash is outside guard scope", () => {
  assert.equal(decision("Bash", { command: "cat .env" }).action, "allow");
});

test("15. Write without a path is allowed", () => {
  assert.equal(decision("Write", {}).action, "allow");
});

test("16. parent segments are normalized before matching", () => {
  const result = decision("Read", { file_path: "/work/proj/src/../.env" });
  assert.deepEqual({ action: result.action, display: result.display }, { action: "deny", display: ".env" });
});

test("17. portable patterns protect matching files outside the project", () => {
  const secret = decision("Read", { file_path: "/home/u/.env" });
  assert.deepEqual({ action: secret.action, display: secret.display }, { action: "deny", display: "/home/u/.env" });
  assert.equal(decision("Write", { file_path: "/other/repo/.git/config" }).action, "deny");
});

test("18. project rules append to defaults and obey their path scope", () => {
  const rules = [
    ...defaultRules,
    { kind: "secret", pattern: "*.pem", source: ".claude/guard.json" },
    { kind: "readOnly", pattern: "assets/master/**", source: ".claude/guard.json" },
    { kind: "allow", pattern: ".env.test", source: ".claude/guard.json" },
  ];
  const pem = decision("Read", { file_path: "/work/proj/certs/server.pem" }, { rules });
  assert.deepEqual({ action: pem.action, source: pem.source }, { action: "deny", source: ".claude/guard.json" });
  assert.equal(decision("Write", { file_path: "/work/proj/assets/master/hero.png" }, { rules }).action, "deny");
  assert.equal(decision("Read", { file_path: "/work/proj/assets/master/hero.png" }, { rules }).action, "allow");
  assert.equal(decision("Write", { file_path: "/work/proj/assets/other/hero.png" }, { rules }).action, "allow");
  assert.equal(decision("Read", { file_path: "/work/proj/.env.test" }, { rules }).action, "allow");
  assert.equal(decision("Read", { file_path: "/work/proj/.env.local" }, { rules }).action, "deny");
  assert.equal(decision("Write", { file_path: "/elsewhere/assets/master/x.png" }, { rules }).action, "allow");
  assert.equal(decision("Read", { file_path: "/elsewhere/a.pem" }, { rules }).action, "deny");
});

test("19. globToRegExp implements globstar, star and question mark", () => {
  assert.equal(globToRegExp("**/x").test("x"), true);
  assert.equal(globToRegExp("**/x").test("a/b/x"), true);
  assert.equal(globToRegExp("a/**").test("a/b"), true);
  assert.equal(globToRegExp("a/**").test("a/b/c"), true);
  assert.equal(globToRegExp("a/**").test("a"), false);
  assert.equal(globToRegExp("*.md").test("a/b.md"), false);
  assert.equal(globToRegExp("?.txt").test("a.txt"), true);
  assert.equal(globToRegExp("?.txt").test("ab.txt"), false);
});

test("20. loadConfig validates a real project config", () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "core-guard-lib-"));
  try {
    const missing = loadConfig(temporaryDirectory);
    assert.deepEqual(missing, { rules: defaultRules, warnings: [] });

    fs.mkdirSync(path.join(temporaryDirectory, ".claude"));
    const configPath = path.join(temporaryDirectory, ".claude", "guard.json");
    fs.writeFileSync(configPath, "{");
    const invalidJson = loadConfig(temporaryDirectory);
    assert.equal(invalidJson.rules.length, defaultRules.length);
    assert.equal(invalidJson.warnings.length, 1);
    assert.match(invalidJson.warnings[0], /guard\.json/);

    fs.writeFileSync(configPath, JSON.stringify({ secrets: "x" }));
    const wrongType = loadConfig(temporaryDirectory);
    assert.equal(wrongType.warnings.length, 1);
    assert.equal(wrongType.rules.some((rule) => rule.source === ".claude/guard.json"), false);

    fs.writeFileSync(configPath, JSON.stringify({ secrets: ["*.pem"], extra: 1 }));
    const partlyValid = loadConfig(temporaryDirectory);
    assert.equal(partlyValid.warnings.length, 1);
    assert.equal(partlyValid.rules.some((rule) => rule.kind === "secret" && rule.pattern === "*.pem" && rule.source === ".claude/guard.json"), true);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
