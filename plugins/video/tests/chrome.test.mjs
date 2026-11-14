import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { findChrome } from "../skills/demo-video/scripts/lib/chrome.mjs";

test("CHROME_PATH is tried first", () => {
  const tried = [];
  const found = findChrome({ env: { CHROME_PATH: "/custom/chrome", HOME: "/home/a" }, platform: "darwin", exists(candidate) { tried.push(candidate); return candidate === "/custom/chrome"; } });
  assert.equal(found, "/custom/chrome");
  assert.deepEqual(tried, ["/custom/chrome"]);
});

test("darwin and Windows candidates are searched in order", () => {
  const darwin = [];
  const darwinFound = findChrome({ env: { HOME: "/Users/a" }, platform: "darwin", exists(candidate) { darwin.push(candidate); return candidate.includes("/Users/a/Applications/Google"); } });
  assert.equal(darwinFound, "/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(darwin.length, 3);
  const windows = [];
  const expected = path.win32.join("C:\\Local", "Google", "Chrome", "Application", "chrome.exe");
  assert.equal(findChrome({ env: { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Local" }, platform: "win32", exists(candidate) { windows.push(candidate); return candidate === expected; } }), expected);
  assert.equal(windows.length, 3);
});

test("Linux names are searched on PATH and errors list attempts and CHROME_PATH", () => {
  const expected = path.join("/b", "chromium");
  assert.equal(findChrome({ env: {}, platform: "linux", pathDirs: ["/a", "/b"], exists: (candidate) => candidate === expected }), expected);
  assert.throws(() => findChrome({ env: { CHROME_PATH: "/missing/custom" }, platform: "linux", pathDirs: ["/bin"], exists: () => false }), (error) => {
    assert.match(error.message, /CHROME_PATH/);
    assert.match(error.message, /\/missing\/custom/);
    assert.match(error.message, /google-chrome-stable/);
    assert.match(error.message, /chromium-browser/);
    return true;
  });
});
