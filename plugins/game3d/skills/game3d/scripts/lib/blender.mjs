import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_SECONDS = 600;
export const TIMEOUT_EXIT_CODE = 124;
const MAX_TIMER_MS = 2 ** 31 - 1;
const TRACEBACK = "Traceback (most recent call last)";

function slashes(value) {
  return value.replace(/\\/g, "/");
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function listDirectory(directory) {
  try {
    return fs.readdirSync(directory);
  } catch {
    return [];
  }
}

function envValue(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function versionParts(name) {
  const match = /\d+(?:\.\d+)*/.exec(name);
  return match ? match[0].split(".").map(Number) : [];
}

function compareVersionsDescending(a, b) {
  const left = versionParts(a.name);
  const right = versionParts(b.name);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? -1) - (left[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function windowsDefaults(env, readdir) {
  const roots = [envValue(env, "PROGRAMFILES"), envValue(env, "PROGRAMFILES(X86)")].filter(Boolean).map((root) => `${slashes(root).replace(/\/+$/, "")}/Blender Foundation`);
  const installs = [];
  for (const root of [...new Set(roots)]) {
    for (const name of readdir(root)) {
      if (/^blender/i.test(name)) installs.push({ name, executable: `${root}/${name}/blender.exe` });
    }
  }
  return installs.sort(compareVersionsDescending).map((install) => install.executable);
}

function platformDefaults(platform, env, readdir) {
  if (platform === "win32") return windowsDefaults(env, readdir);
  if (platform === "darwin") {
    const home = envValue(env, "HOME");
    return ["/Applications/Blender.app/Contents/MacOS/Blender", ...(home ? [`${slashes(home).replace(/\/+$/, "")}/Applications/Blender.app/Contents/MacOS/Blender`] : [])];
  }
  return ["/snap/bin/blender", "/usr/bin/blender", "/usr/local/bin/blender"];
}

function defaultPathDirs(env, platform) {
  const value = envValue(env, "PATH") ?? "";
  return value.split(platform === "win32" ? ";" : ":").map((entry) => entry.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
}

// Search order: flag, BLENDER_BIN, platform defaults, PATH. Every candidate checked is
// listed in `tried` (the match, if any, is the last entry); `path` is null when none exists.
export function findBlender({ flag, env = process.env, platform = process.platform, exists = isFile, readdir = listDirectory, pathDirs } = {}) {
  const tried = [];
  const check = (candidate) => {
    const normalized = slashes(candidate);
    if (!tried.includes(normalized)) tried.push(normalized);
    return exists(normalized) ? normalized : null;
  };
  for (const explicit of [flag, envValue(env, "BLENDER_BIN")]) {
    if (explicit) {
      const found = check(explicit);
      if (found) return { path: found, tried };
    }
  }
  for (const candidate of platformDefaults(platform, env, readdir)) {
    const found = check(candidate);
    if (found) return { path: found, tried };
  }
  const executable = platform === "win32" ? "blender.exe" : "blender";
  for (const directory of pathDirs ?? defaultPathDirs(env, platform)) {
    const found = check(`${slashes(directory).replace(/\/+$/, "")}/${executable}`);
    if (found) return { path: found, tried };
  }
  return { path: null, tried };
}

// The version is on the first line of `blender --version`, e.g. "Blender 4.4.3".
export function parseBlenderVersion(text) {
  const firstLine = String(text ?? "").split(/\r?\n/).find((line) => line.trim() !== "");
  const match = /^\s*Blender\s+(\S+)/i.exec(firstLine ?? "");
  return match ? match[1] : null;
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} needs a value`);
  return value;
}

export const BLENDER_USAGE = "Usage: blender.mjs --which [--blender <path>] | blender.mjs <script.py> [--blender <path>] [--timeout <seconds>] [--log <file>] [-- <script arguments>]";

export function parseBlenderArguments(argv) {
  const result = { which: false, blender: undefined, script: null, timeoutSec: DEFAULT_TIMEOUT_SECONDS, log: null, args: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      result.args = argv.slice(index + 1);
      break;
    }
    if (argument === "--which") result.which = true;
    else if (argument === "--blender") result.blender = takeValue(argv, index++, argument);
    else if (argument === "--log") result.log = takeValue(argv, index++, argument);
    else if (argument === "--timeout") {
      result.timeoutSec = Number(takeValue(argv, index++, argument));
      if (!Number.isFinite(result.timeoutSec) || result.timeoutSec <= 0) throw new Error("--timeout needs a positive number of seconds");
    } else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else if (result.script === null) result.script = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!result.which && result.script === null) throw new Error(BLENDER_USAGE);
  return result;
}

export function killProcessTree(child, { platform = process.platform, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const fallback = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve();
    };
    if (platform !== "win32" || !child.pid) {
      fallback();
      return;
    }
    try {
      const killer = spawnImpl("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("error", fallback);
      killer.once("close", resolve);
    } catch {
      fallback();
    }
  });
}

export function blenderCommandLine({ script, args = [] }) {
  return ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", ...args];
}

// Runs Blender headless and resolves { code, seconds, sawTraceback }: code is 0, 1 (non-zero
// exit or a Python traceback in the output) or 124 (timeout, after killTree).
export function runBlender({ blender, script, args = [], timeoutSec = DEFAULT_TIMEOUT_SECONDS, log = null, spawnImpl = spawn, killTree = killProcessTree, stdout = process.stdout, stderr = process.stderr }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let logStream = null;
    if (log) {
      try {
        fs.mkdirSync(path.dirname(path.resolve(log)), { recursive: true });
        logStream = fs.createWriteStream(log);
        logStream.on("error", (error) => {
          stderr.write(`blender: cannot write log ${log}: ${error.message}
`);
          logStream = null;
        });
      } catch (error) {
        reject(error);
        return;
      }
    }
    let sawTraceback = false;
    let settled = false;
    let timedOut = false;
    let timer = null;
    const tails = { out: "", err: "" };
    const watch = (key, chunk) => {
      const text = tails[key] + chunk.toString("latin1");
      if (text.includes(TRACEBACK)) sawTraceback = true;
      tails[key] = text.slice(-(TRACEBACK.length - 1));
    };
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const done = () => settle(value);
      if (logStream) logStream.end(done);
      else done();
    };
    const result = (code) => ({ code, seconds: Math.round((Date.now() - started) / 100) / 10, sawTraceback });

    let child;
    try {
      child = spawnImpl(blender, blenderCommandLine({ script, args }), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      finish(reject, error);
      return;
    }
    child.stdout?.on("data", (chunk) => {
      watch("out", chunk);
      stdout.write(chunk);
      logStream?.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      watch("err", chunk);
      stderr.write(chunk);
      logStream?.write(chunk);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => finish(resolve, result(timedOut ? TIMEOUT_EXIT_CODE : code === 0 && !sawTraceback ? 0 : 1)));
    timer = setTimeout(() => {
      timedOut = true;
      Promise.resolve(killTree(child)).catch(() => {}).then(() => finish(resolve, result(TIMEOUT_EXIT_CODE)));
    }, Math.min(timeoutSec * 1000, MAX_TIMER_MS));
  });
}
