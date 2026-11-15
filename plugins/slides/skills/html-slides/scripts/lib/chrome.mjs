import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CdpConnection } from "./cdp.mjs";

function pathList(env, platform, pathDirs) {
  if (pathDirs) return pathDirs;
  return (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : path.delimiter).filter(Boolean);
}

export function findChrome({ env = process.env, platform = process.platform, exists = fs.existsSync, pathDirs } = {}) {
  const tried = [];
  const add = (candidate) => {
    if (!candidate || tried.includes(candidate)) return false;
    tried.push(candidate);
    return exists(candidate);
  };
  if (env.CHROME_PATH && add(env.CHROME_PATH)) return env.CHROME_PATH;
  let candidates = [];
  if (platform === "darwin") {
    candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      env.HOME && path.posix.join(env.HOME, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      env.HOME && path.posix.join(env.HOME, "Applications/Chromium.app/Contents/MacOS/Chromium"),
    ].filter(Boolean);
  } else if (platform === "win32") {
    candidates = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((directory) => path.win32.join(directory, "Google", "Chrome", "Application", "chrome.exe"));
  } else {
    const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    const directories = pathList(env, platform, pathDirs);
    candidates = names.flatMap((name) => directories.map((directory) => path.join(directory, name)));
  }
  for (const candidate of candidates) if (add(candidate)) return candidate;
  throw new Error(`Chrome or Chromium was not found. Set CHROME_PATH. Paths tried:\n${tried.map((item) => `- ${item}`).join("\n") || "- (PATH was empty)"}`);
}

function capture(command, args, spawnImpl, { signal, timeout = 30 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`${command} timed out after ${timeout} s`));
    }, timeout * 1000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => code === 0 ? finish(resolve, { stdout, stderr }) : finish(reject, new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim()}`)));
  });
}

export async function findFfmpeg({ env = process.env, spawnImpl = spawn, signal } = {}) {
  const ffmpeg = env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = env.FFPROBE_PATH || "ffprobe";
  let ffmpegVersion;
  let ffprobeVersion;
  try {
    ffmpegVersion = (await capture(ffmpeg, ["-version"], spawnImpl, { signal })).stdout.split(/\r?\n/, 1)[0];
  } catch (error) {
    throw new Error(`ffmpeg is unavailable (${ffmpeg}). Set FFMPEG_PATH. ${error.message}`);
  }
  try {
    ffprobeVersion = (await capture(ffprobe, ["-version"], spawnImpl, { signal })).stdout.split(/\r?\n/, 1)[0];
  } catch (error) {
    throw new Error(`ffprobe is unavailable (${ffprobe}). Set FFPROBE_PATH. ${error.message}`);
  }
  let encoders;
  try {
    const result = await capture(ffmpeg, ["-hide_banner", "-encoders"], spawnImpl, { signal });
    encoders = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    throw new Error(`Could not list ffmpeg encoders: ${error.message}`);
  }
  if (!/(?:^|\s)libx264(?:\s|$)/m.test(encoders)) throw new Error(`ffmpeg at ${ffmpeg} does not provide the libx264 encoder`);
  return { ffmpeg, ffprobe, ffmpegVersion, ffprobeVersion };
}

export function launchChrome(executable, { width, height, spawnImpl = spawn, fsImpl = fs, tmpdir = os.tmpdir() }) {
  const profile = fsImpl.mkdtempSync(path.join(tmpdir, "demo-video-chrome-"));
  const args = [
    "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio",
    "--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", `--window-size=${width},${height}`, "about:blank",
  ];
  const child = spawnImpl(executable, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
  const stderrLines = [];
  let stderrBuffer = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop();
    stderrLines.push(...lines);
    if (stderrLines.length > 40) stderrLines.splice(0, stderrLines.length - 40);
  });
  const cdp = new CdpConnection(child.stdio[4], child.stdio[3], {
    exitEmitter: child,
    exitError(code, signal) {
      const tail = [...stderrLines, stderrBuffer].filter(Boolean).slice(-40).join("\n");
      return new Error(`Chrome exited (${signal ?? code ?? "unknown"})${tail ? `:\n${tail}` : ""}`);
    },
  });
  let closed = false;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return {
    child, cdp, profile, stderrLines,
    async close() {
      if (closed) return;
      closed = true;
      cdp.send("Browser.close").catch(() => {});
      let timer;
      await Promise.race([
        exited,
        new Promise((resolve) => { timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill();
          resolve();
        }, 3000); }),
      ]).finally(() => clearTimeout(timer));
      try { fsImpl.rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
}

export function runProcess(command, args, options = {}, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const { timeout = 300, ...spawnOptions } = options;
    const child = spawnImpl(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...spawnOptions });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`${command} timed out after ${timeout} s`));
    }, timeout * 1000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => code === 0 ? finish(resolve, { stdout, stderr }) : finish(reject, Object.assign(new Error(`${command} exited ${code}: ${stderr.trim()}`), { code, stdout, stderr })));
  });
}
