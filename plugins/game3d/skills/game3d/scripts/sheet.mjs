#!/usr/bin/env node
// Before/after comparison sheet of two shots.mjs output directories.
//
// Usage: sheet.mjs --before <dir> --after <dir> --out <file.png> [--title <text>]
//
// Reads <dir>/shots.json of both runs and pairs the shots by id, in the order of the after list (then any ids
// only in before). Each row shows id and label with the before image on the left and the after image on the
// right; a side that has no such shot shows the word "missing". Renders the grid in Chrome and saves it as PNG.
// Exit 0: sheet written. Exit 2: a shots.json is missing or invalid, Chrome is unavailable or the arguments are wrong.
import fs from "node:fs";
import path from "node:path";
import { toSlash } from "./lib/frames.mjs";
import { htmlToPng, takeValue } from "./lib/page.mjs";
import { compareHtml, pairShots, pngDataUri } from "./lib/sheet.mjs";

const USAGE = "Usage: sheet.mjs --before <dir> --after <dir> --out <file.png> [--title <text>]";

function parseArguments(argv) {
  const result = { before: null, after: null, out: null, title: "Before / after" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--before") result.before = takeValue(argv, index++, argument);
    else if (argument === "--after") result.after = takeValue(argv, index++, argument);
    else if (argument === "--out") result.out = takeValue(argv, index++, argument);
    else if (argument === "--title") result.title = takeValue(argv, index++, argument);
    else throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
  }
  if (!result.before || !result.after || !result.out) throw new Error(USAGE);
  return result;
}

function readReport(directory) {
  const file = path.join(directory, "shots.json");
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(error.code === "ENOENT" ? `${toSlash(file)} not found` : `${toSlash(file)} is not valid JSON: ${error.message}`);
  }
  if (!report || !Array.isArray(report.shots) || report.shots.some((shot) => !shot || typeof shot.id !== "string" || typeof shot.file !== "string")) {
    throw new Error(`${toSlash(file)} is not a shots.mjs report (it needs a "shots" array of { id, file })`);
  }
  return report;
}

function side(directory, shot) {
  if (!shot) return null;
  const file = path.join(directory, path.basename(shot.file));
  let image;
  try { image = fs.readFileSync(file); } catch { throw new Error(`${toSlash(file)} listed in shots.json is missing`); }
  return { src: pngDataUri(image), note: shot.blank ? `FAIL ${shot.blank}` : "" };
}

function describe(report) {
  const parts = [report.renderer, Array.isArray(report.size) ? `${report.size[0]}x${report.size[1]}` : null, report.dpr ? `@${report.dpr}x` : null, report.date];
  return parts.filter(Boolean).join(" | ");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const before = readReport(args.before);
  const after = readReport(args.after);
  const rows = pairShots(before.shots, after.shots).map((pair) => ({
    id: pair.id,
    label: pair.after?.label ?? pair.before?.label ?? pair.id,
    before: side(args.before, pair.before),
    after: side(args.after, pair.after),
  }));
  const html = compareHtml({ title: args.title, rows, meta: { before: describe(before), after: describe(after) } });
  const out = path.resolve(args.out);
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await fs.promises.writeFile(out, await htmlToPng(html));
  process.stdout.write(`${toSlash(out)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`sheet: ${error.message}\n`);
  process.exitCode = 2;
}
