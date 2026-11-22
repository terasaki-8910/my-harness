#!/usr/bin/env node
// Blank-frame check for PNG screenshots.
//
// Usage: frames.mjs <png file or directory>... [--json] [--min-std 0.02] [--max-flat 0.98]
//
// Directories are scanned (not recursively) for .png files. Each file prints
//   PASS <file> mean=<0..1> std=<0..1>
//   FAIL <file> <white|black|uniform> mean=<..> std=<..>
// With --json only a JSON array of { file, stats, blank } is printed.
// Exit 0: no frame is blank. Exit 1: some frame is blank. Exit 2: a file cannot be read or decoded
// (also wins over 1), or the arguments are wrong. Files that cannot be decoded are reported on stderr.
import fs from "node:fs";
import path from "node:path";
import { blankReason, frameStats, toSlash } from "./lib/frames.mjs";
import { decodePng } from "./lib/png.mjs";

const USAGE = "Usage: frames.mjs <png file or directory>... [--json] [--min-std 0.02] [--max-flat 0.98]";

function numberOption(argv, index, name) {
  const value = argv[index + 1];
  const number = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} needs a number between 0 and 1`);
  return number;
}

function parseArguments(argv) {
  const result = { inputs: [], json: false, minStd: 0.02, maxFlat: 0.98 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") result.json = true;
    else if (argument === "--min-std") result.minStd = numberOption(argv, index++, argument);
    else if (argument === "--max-flat") result.maxFlat = numberOption(argv, index++, argument);
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
    else result.inputs.push(argument);
  }
  if (result.inputs.length === 0) throw new Error(USAGE);
  return result;
}

function listFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    let info;
    try { info = fs.statSync(input); } catch { throw new Error(`Not found: ${input}`); }
    if (info.isDirectory()) {
      const names = fs.readdirSync(input).filter((name) => name.toLowerCase().endsWith(".png") && fs.statSync(path.join(input, name)).isFile()).sort();
      if (names.length === 0) throw new Error(`No .png files in ${input}`);
      files.push(...names.map((name) => path.join(input, name)));
    } else {
      files.push(input);
    }
  }
  return files;
}

const fixed = (value) => value.toFixed(3);

function main() {
  const args = parseArguments(process.argv.slice(2));
  const files = listFiles(args.inputs);
  const results = [];
  let undecodable = false;
  for (const file of files) {
    const name = toSlash(file);
    let stats;
    try {
      stats = frameStats(decodePng(fs.readFileSync(file)));
    } catch (error) {
      undecodable = true;
      process.stderr.write(`frames: ${name}: ${error.message}\n`);
      continue;
    }
    results.push({ file: name, stats, blank: blankReason(stats, { minStd: args.minStd, maxFlat: args.maxFlat }) });
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const { file, stats, blank } of results) {
      process.stdout.write(`${blank ? `FAIL ${file} ${blank}` : `PASS ${file}`} mean=${fixed(stats.mean)} std=${fixed(stats.std)}\n`);
    }
  }
  if (undecodable) process.exitCode = 2;
  else if (results.some((item) => item.blank)) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`frames: ${error.message}\n`);
  process.exitCode = 2;
}
