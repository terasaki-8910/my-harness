import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(testDirectory, "..", "skills", "demo-video", "scripts");

test("all four video commands resolve --variant through the shared timeline helper", () => {
  for (const name of ["plan.mjs", "render.mjs", "check.mjs", "review.mjs"]) {
    const source = fs.readFileSync(path.join(scripts, name), "utf8");
    assert.match(source, /resolveVariant\(/, name);
    assert.match(source, /--variant/, name);
    assert.doesNotMatch(source, /\.variants\s*\[/, name);
  }
});
