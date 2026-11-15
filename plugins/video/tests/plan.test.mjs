import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(testDirectory, "..", "skills", "demo-video", "scripts", "plan.mjs");

test("plan prints the resolved relative example", () => {
  const example = path.join(testDirectory, "..", "examples", "basic", "video-relative.json");
  const result = spawnSync(process.execPath, [script, example], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], "0.50-0.85  move  #card-1  point at card 1");
  assert.ok(lines.includes("2.20-3.20  wait    hold the result"));
  assert.ok(lines.includes("7.40-7.75  click  #card-2  open card 2"));
  assert.equal(lines.at(-1), "duration 8.75 s; skipped 1 action(s); skipped groups: none");
});

test("plan prints an action group", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo-video-plan-group-test-"));
  const file = path.join(directory, "grouped.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ page: "x", duration: 2, skipGroups: ["cut"], timeline: [{ at: 0, do: "wait", group: "tour", label: "intro" }, { at: 1, do: "wait", group: "cut" }] }));
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^0\.00-0\.00  wait    intro \[tour\]$/m);
    assert.match(result.stdout, /duration 2\.00 s; skipped 1 action\(s\); skipped groups: cut/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("plan reports validation errors and exits 1", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo-video-plan-test-"));
  const file = path.join(directory, "invalid.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ page: "x", duration: 2, timeline: [{ at: 0, wait: 1, do: "wait" }] }));
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^video\.json: action 0 fields at\/wait:/m);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
