import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { chromeMissing } from "./helpers.mjs";

const browserUrl = new URL("../skills/app-ui/scripts/lib/browser.mjs", import.meta.url).href;

test("an interrupt closes Chrome, removes its profile and exits 130", { skip: chromeMissing }, async () => {
  const program = `
    import { startBrowser } from ${JSON.stringify(browserUrl)};
    const browser = startBrowser({ width: 390, height: 844 });
    await browser.cdp.send("Target.getTargets");
    console.log("PROFILE " + browser.chrome.profile);
    process.emit("SIGINT");
    setTimeout(() => { console.log("still running"); }, 15000);
  `;
  const result = await new Promise((resolve) => {
    execFile(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr });
    });
  });
  assert.equal(result.status, 130, result.stdout + result.stderr);
  const profile = /^PROFILE (.+)$/m.exec(result.stdout)?.[1];
  assert.ok(profile, result.stdout);
  assert.equal(fs.existsSync(profile), false, "the Chrome profile folder is gone");
  assert.doesNotMatch(result.stdout, /still running/);
});
