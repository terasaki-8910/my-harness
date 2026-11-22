#!/usr/bin/env node
// glb-audit.mjs: check GLB 2.0 files against a budget.
//
// Usage: node glb-audit.mjs <file.glb>... [--budget <budget.json>] [--json]
//
//   --budget  JSON with any of maxFileBytes, maxTriangles, maxDrawCalls, maxMaterials,
//             maxTextureSize, maxTextureBytes, requireUVs (default true) and
//             requirePowerOfTwo (default false). Either a flat object or
//             { "default": {...}, "files": { "<basename>": {...} } }, where the
//             per-file object overrides the default. The budget is strict (exit 2): an
//             unknown key anywhere (a typo such as "maxTris"), limit keys next to "default"
//             or "files" (put them under "default"), or a "files" key that contains "/" or
//             "\" (keys are file basenames, matched against the audited file's name).
//   --json    print only a JSON array of { file, metrics, fail, warn } on stdout
//             (a file that cannot be read adds { file, error, metrics: null }).
//
// Metrics: triangles and drawCalls follow the default scene (EXT_mesh_gpu_instancing
// multiplies triangles, not draw calls); uniqueTriangles counts every entry of meshes[]
// once; missingUVs lists primitives whose material samples TEXCOORD_n they do not have.
//
// Images: an image whose bytes cannot be obtained (missing or unreadable external file,
// undecodable data: URI, bufferView out of range) is a FAIL "missing image <index> <uri>"
// whatever the budget. An image that is present but in an unknown format only warns
// ("unknown image format"); an http(s) image is not fetched and warns that it is unchecked.
//
// Exit codes: 0 every file passes; 1 a budget check failed; 2 a file or the budget could
// not be read or parsed (not a GLB, wrong version, truncated chunks, invalid JSON, invalid
// budget), or the command line is wrong. Reasons go to stderr as "glb-audit: <message>".
import fs from "node:fs";
import path from "node:path";
import { auditGlb, checkBudget, formatAudit, parseAuditArguments, parseGlb, resolveBudget } from "./lib/glb.mjs";

function readBudget(file) {
  if (file === null) return null;
  let budget;
  try {
    budget = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read budget ${file}: ${error.message}`);
  }
  try {
    resolveBudget(budget, "");
  } catch (error) {
    throw new Error(`invalid budget ${file}: ${error.message}`);
  }
  return budget;
}

function auditFile(file, budget) {
  const buffer = fs.readFileSync(file);
  const metrics = auditGlb(parseGlb(buffer), { fileBytes: buffer.length, dir: path.dirname(path.resolve(file)) });
  return { metrics, ...checkBudget(metrics, resolveBudget(budget, path.basename(file))) };
}

function main() {
  const args = parseAuditArguments(process.argv.slice(2));
  const budget = readBudget(args.budget);
  const results = [];
  let unreadable = 0;
  let failed = 0;
  for (const original of args.files) {
    const file = original.replace(/\\/g, "/");
    try {
      const result = auditFile(original, budget);
      results.push({ file, metrics: result.metrics, fail: result.fail, warn: result.warn });
      if (result.fail.length > 0) failed += 1;
      if (!args.json) process.stdout.write(`${results.length > 1 ? "\n" : ""}${formatAudit(file, result.metrics, result)}`);
    } catch (error) {
      unreadable += 1;
      results.push({ file, error: error.message, metrics: null, fail: [], warn: [] });
      process.stderr.write(`glb-audit: ${file}: ${error.message}\n`);
    }
  }
  if (args.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  if (unreadable > 0) process.exitCode = 2;
  else if (failed > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`glb-audit: ${error.message}\n`);
  process.exitCode = 2;
}
