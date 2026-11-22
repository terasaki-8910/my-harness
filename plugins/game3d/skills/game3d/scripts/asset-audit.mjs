#!/usr/bin/env node
// asset-audit.mjs: check that every game asset has a recorded source and an allowed licence.
//
// Usage: node asset-audit.mjs [<project-dir, default .>] [--manifest <path relative to the project, default assets/manifest.json>] [--json]
//
// Manifest (JSON):
//   { "schema": "game3d/assets@1", "roots": ["public/assets"], "ignore": ["public/assets/README.md"],
//     "allowLicenses": ["CC0-1.0", "CC-BY-4.0", "MIT", "own"],
//     "assets": [ { "path": "public/assets/gate.glb", "license": "own", "source": "art/blender/gen_gate.py",
//                   "author": "...", "tool": "Blender 4.4", "attribution": "" } ] }
// A path in assets[] or ignore that ends with "/" covers every file below that directory;
// any other path is one exact file. Paths are relative to the project directory, use
// forward slashes and are compared case-sensitively. Symbolic links and Windows junctions to
// directories are followed (also when a root is itself a link); files are named by their path
// under the root, not by the link target, and a link back up the tree is not followed again.
//
// FAIL: a file under a root is neither covered by an asset entry nor ignored; an exact-file
// entry does not exist, or a directory entry covers no file; a license is not in
// allowLicenses; a license starting with CC-BY has an empty attribution; source is empty.
// WARN: a file is covered by more than one entry.
// --json prints { project, manifest, files, entries, fail, warn } instead of the lines.
//
// Exit codes: 0 no FAIL; 1 at least one FAIL; 2 the audit could not run (missing or
// invalid manifest, wrong schema, a root that does not exist, bad command line).
import { auditProject, formatAssetAudit, parseAssetArguments } from "./lib/assets.mjs";

function main() {
  const args = parseAssetArguments(process.argv.slice(2));
  const project = args.project.replace(/\\/g, "/");
  const result = auditProject(args.project, args.manifest);
  if (args.json) process.stdout.write(`${JSON.stringify({ project, manifest: args.manifest, ...result }, null, 2)}\n`);
  else process.stdout.write(formatAssetAudit(`${project} (manifest ${args.manifest})`, result));
  if (result.fail.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`asset-audit: ${error.message}\n`);
  process.exitCode = 2;
}
