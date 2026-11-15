#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { actionDuration, resolveVariant, validate } from "./lib/timeline.mjs";

function detail(action) {
  if (action.to) return action.to;
  if (action.key) return action.key;
  if (action.fn) return action.fn;
  if (Number.isFinite(action.x) || Number.isFinite(action.y)) return [action.x, action.y].map((value) => Number.isFinite(value) ? value : "-").join(",");
  return "";
}

async function main() {
  const args = process.argv.slice(2);
  let file;
  let variant = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--variant") {
      variant = args[++index];
      if (!variant) throw new Error("--variant needs a name");
    } else if (!file) file = args[index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!file) throw new Error("Usage: plan.mjs <video.json> [--variant name]");
  const configPath = path.resolve(file);
  const raw = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
  const resolved = resolveVariant(raw, variant);
  const { spec, errors } = validate(resolved);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`video.json: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  for (const action of spec.timeline) {
    const end = action.at + actionDuration(action);
    const annotation = [action.label, action.group ? `[${action.group}]` : null].filter(Boolean).join(" ");
    process.stdout.write(`${action.at.toFixed(2)}-${end.toFixed(2)}  ${action.do}  ${detail(action)}  ${annotation}\n`);
  }
  const skippedGroups = new Set(spec.skipGroups);
  const skipped = (resolved.timeline ?? []).filter((action) => action && typeof action === "object" && !Array.isArray(action) && (action.skip === true || skippedGroups.has(action.group))).length;
  process.stdout.write(`duration ${spec.duration.toFixed(2)} s; skipped ${skipped} action(s); skipped groups: ${spec.skipGroups.join(", ") || "none"}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`plan: ${error.message}\n`);
  process.exitCode = 1;
}
