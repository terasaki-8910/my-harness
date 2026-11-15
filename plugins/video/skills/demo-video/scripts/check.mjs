#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { findFfmpeg, runProcess } from "./lib/chrome.mjs";
import { mp4BoxOrder, parseAnalysis, summarizeFfprobe, verdict } from "./lib/probe.mjs";
import { findFont, hasDrawtext, reviewFilter } from "./lib/review.mjs";
import { resolveVariant, validate } from "./lib/timeline.mjs";

function parseArguments(argv) {
  const result = { config: null, file: null, variant: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--file") {
      result.file = argv[++index];
      if (!result.file) throw new Error("--file needs an MP4 path");
    } else if (argv[index] === "--variant") {
      result.variant = argv[++index];
      if (!result.variant) throw new Error("--variant needs a name");
    } else if (!result.config) result.config = argv[index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!result.config) throw new Error("Usage: check.mjs <video.json> [--variant name] [--file mp4]");
  return result;
}

async function readJsonIfPresent(file) {
  try { return JSON.parse(await fs.promises.readFile(file, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const configDirectory = path.dirname(configPath);
  const raw = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
  const { spec, errors } = validate(resolveVariant(raw, args.variant));
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`video.json: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  const file = path.resolve(configDirectory, args.file ?? spec.out);
  const base = file.toLowerCase().endsWith(".mp4") ? file.slice(0, -4) : file;
  await fs.promises.mkdir(path.dirname(base), { recursive: true });
  const tools = await findFfmpeg({ env: process.env });
  let drawtext = false;
  try {
    const filters = await runProcess(tools.ffmpeg, ["-hide_banner", "-filters"]);
    drawtext = hasDrawtext(`${filters.stdout}\n${filters.stderr}`);
  } catch {}
  const reviewFont = drawtext ? findFont() : null;
  let fileError;
  let summary = {};
  let boxes = [];
  let analysis = { black: [], freezes: [] };
  let render = null;
  try {
    await fs.promises.access(file, fs.constants.R_OK);
    const probe = await runProcess(tools.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
    summary = summarizeFfprobe(probe.stdout);
    const handle = await fs.promises.open(file, "r");
    try { boxes = await mp4BoxOrder(handle); } finally { await handle.close(); }
    const result = await runProcess(tools.ffmpeg, [
      "-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.1:pix_th=0.10,freezedetect=n=-70dB:d=1", "-an", "-f", "null", "-",
    ]);
    analysis = parseAnalysis(result.stderr, summary.duration);
  } catch (error) {
    fileError = error.message;
  }
  try { render = await readJsonIfPresent(`${base}.render.json`); } catch (error) { fileError ??= `render report unreadable: ${error.message}`; }
  const result = verdict({ fileError, summary, boxes, analysis, spec, render });

  const tiles = Array.from({ length: 20 }, (_, index) => Number((index * (summary.duration / 20)).toFixed(3)));
  if (!fileError) {
    const interval = summary.duration / 20;
    try {
      await runProcess(tools.ffmpeg, [
        "-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf",
        reviewFilter({ fps: `1/${interval}`, width: 384, cols: 5, rows: 4, font: reviewFont }), "-frames:v", "1", `${base}.contact.png`,
      ]);
      result.pass.push("contact sheet: 20 tiles, left to right then top to bottom");
    } catch (error) {
      result.fail.push(`contact sheet: ${error.message}`);
    }

    const directory = `${base}.frames`;
    await fs.promises.rm(directory, { recursive: true, force: true });
    await fs.promises.mkdir(directory, { recursive: true });
    if (render) {
      const priorities = new Map([["click", 0], ["key", 1], ["call", 2], ["scroll", 3], ["move", 4]]);
      const selected = (render.actions ?? []).filter((action) => priorities.has(action.do) && Number.isFinite(action.endedAt))
        .toSorted((a, b) => priorities.get(a.do) - priorities.get(b.do) || a.index - b.index).slice(0, 5);
      for (let index = 0; index < selected.length; index += 1) {
        const action = selected[index];
        const time = Math.max(0, Math.min(summary.duration - 0.001, action.endedAt + 0.5));
        const target = path.join(directory, `${String(index + 1).padStart(2, "0")}-${action.do}.png`);
        try {
          await runProcess(tools.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", file, "-frames:v", "1", target]);
        } catch (error) {
          result.fail.push(`action frame ${path.basename(target)}: ${error.message}`);
        }
      }
    }
  }

  const human = [
    "legibility at real size (play at 100% on a laptop)",
    "pacing (every text stays long enough to read)",
    "privacy (no names, e-mail addresses, booking numbers, browser tabs or bookmarks)",
    "the operation flow is understandable without sound",
    ...spec.checks.human,
  ];
  const report = { file, summary, boxes, analysis, checks: result, tiles, human };
  await fs.promises.writeFile(`${base}.check.json`, `${JSON.stringify(report, null, 2)}\n`);
  for (const message of result.pass) process.stdout.write(`PASS ${message}\n`);
  for (const message of result.warn) process.stdout.write(`WARN ${message}\n`);
  for (const message of result.fail) process.stdout.write(`FAIL ${message}\n`);
  process.stdout.write("Contact sheet tiles run left to right, top to bottom.\n");
  process.stdout.write(`tiles: ${tiles.map((time, index) => `${index + 1}=${Number.isFinite(time) ? time.toFixed(2) : "n/a"}`).join(" ")}\n`);
  process.stdout.write("NEEDS HUMAN\n");
  for (const item of human) process.stdout.write(`- ${item}\n`);
  if (result.fail.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`check: ${error.message}\n`);
  process.exitCode = 1;
}
