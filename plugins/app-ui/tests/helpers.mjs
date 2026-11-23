// Shared helpers for the browser tests (not a test file itself).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../skills/app-ui/scripts/lib/chrome.mjs";

export const scripts = fileURLToPath(new URL("../skills/app-ui/scripts/", import.meta.url));
export const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

export let chromeMissing = false;
try {
  findChrome();
} catch (error) {
  chromeMissing = `Chrome or Chromium is not installed (${error.message.split("\n", 1)[0]})`;
}

/** Run one of the scripts as a child process. Resolves { status, stdout, stderr } and never rejects. */
export function run(script, args, { env, timeout = 180_000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(scripts, script), ...args], { encoding: "utf8", timeout, windowsHide: true, env: env ?? process.env }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

export function makeTempDir(prefix = "app-ui-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write files ({ "name": text }) into a new temp folder and return the folder. */
export function makeSite(files, prefix) {
  const directory = makeTempDir(prefix);
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof text === "string" ? text : JSON.stringify(text, null, 2));
  }
  return directory;
}

export const PAGE = (body, { head = "", meta = true } = {}) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">${meta ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ""}<title>t</title>${head}</head>
<body style="margin:0;font:15px/1.6 sans-serif;color:#1f1f1f;background:#fff"><div style="padding:59px 16px 16px">${body}</div></body></html>
`;
