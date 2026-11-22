import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProject } from "../skills/game3d/scripts/lib/assets.mjs";
import { checkBudget, resolveBudget } from "../skills/game3d/scripts/lib/glb.mjs";

const templates = fileURLToPath(new URL("../templates/", import.meta.url));
const skill = fileURLToPath(new URL("../skills/game3d/", import.meta.url));

test("JSON templates parse", () => {
  for (const name of fs.readdirSync(templates).filter((file) => file.endsWith(".json.tmpl"))) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(templates, name), "utf8")), name);
  }
});

test("the asset manifest template audits an empty project cleanly", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-template-"));
  try {
    fs.mkdirSync(path.join(project, "public", "assets"), { recursive: true });
    fs.mkdirSync(path.join(project, "docs"), { recursive: true });
    fs.copyFileSync(path.join(templates, "asset-manifest.json.tmpl"), path.join(project, "docs", "asset-manifest.json"));
    const result = auditProject(project, "docs/asset-manifest.json");
    assert.deepEqual(result.fail, []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("the budget template is a valid budget", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(templates, "asset-budget.json.tmpl"), "utf8"));
  const resolved = resolveBudget(budget, "part.glb");
  assert.equal(resolved.maxTriangles, 100000);
  const metrics = { fileBytes: 1, triangles: 1, uniqueTriangles: 1, drawCalls: 1, materials: 1, textures: [], textureBytes: 0, maxTextureSize: 0, missingUVs: [], nonPowerOfTwo: [], unreadableImages: [] };
  assert.deepEqual(checkBudget(metrics, resolved).fail, []);
});

test("every reference the skill names exists", () => {
  const text = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  for (const [, name] of text.matchAll(/references\/([a-z-]+\.md)/g)) {
    assert.equal(fs.existsSync(path.join(skill, "references", name)), true, name);
  }
  for (const [, name] of text.matchAll(/`node <base>\/scripts\/([a-z-]+\.mjs)/g)) {
    assert.equal(fs.existsSync(path.join(skill, "scripts", name)), true, name);
  }
  assert.equal(fs.existsSync(path.join(skill, "..", "..", "templates", "art-brief.md.tmpl")), true, "art brief template");
});
