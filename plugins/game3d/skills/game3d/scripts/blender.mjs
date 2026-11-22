#!/usr/bin/env node
// blender.mjs: run a Blender Python script headless, or locate Blender.
//
// Usage:
//   node blender.mjs --which [--blender <path>]
//   node blender.mjs <script.py> [--blender <path>] [--timeout <seconds, default 600>] [--log <file>] [-- <script arguments>]
//
// --which prints two lines: the executable path (forward slashes) and its version.
// A script runs as: <blender> --background --factory-startup --python-exit-code 1
//   --python <script.py> -- <script arguments>   (read them in Python after "--" in sys.argv)
// Blender's stdout and stderr stream to the terminal and, with --log, to that file too.
// Search order: --blender, env BLENDER_BIN, platform defaults (Windows: every
// "Program Files/Blender Foundation/Blender *" folder, newest first), then PATH.
//
// Exit codes: 0 success; 1 Blender exited non-zero or its output contained a Python
// traceback; 124 timeout (the whole process tree is killed); 2 Blender was not found
// (every path tried is listed), the script file is missing or the command line is wrong.
// The last line on stderr is "blender: exit <code> in <seconds>s".
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { findBlender, parseBlenderArguments, parseBlenderVersion, runBlender } from "./lib/blender.mjs";

function readVersion(executable) {
  const output = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 60000, windowsHide: true });
  const version = output.error ? null : parseBlenderVersion(output.stdout);
  if (!version) throw new Error(`cannot read the version from "${executable} --version"${output.error ? `: ${output.error.message}` : ""}`);
  return version;
}

async function main() {
  let args;
  try {
    args = parseBlenderArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`blender: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const found = findBlender({ flag: args.blender });
  if (!found.path) {
    process.stderr.write(`blender: Blender not found. Tried:\n${found.tried.map((item) => `  ${item}`).join("\n")}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.which) {
    process.stdout.write(`${found.path}\n${readVersion(found.path)}\n`);
    return;
  }
  if (!fs.existsSync(args.script)) {
    process.stderr.write(`blender: script not found: ${args.script}\n`);
    process.exitCode = 2;
    return;
  }
  const outcome = await runBlender({ blender: found.path, script: args.script, args: args.args, timeoutSec: args.timeoutSec, log: args.log });
  process.stderr.write(`blender: exit ${outcome.code} in ${outcome.seconds.toFixed(1)}s\n`);
  process.exitCode = outcome.code;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`blender: ${error.message}\n`);
  process.exitCode = 1;
}
