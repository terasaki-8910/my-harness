import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { UsageError } from "../skills/app-ui/scripts/lib/args.mjs";
import { loadFlow } from "../skills/app-ui/scripts/lib/flow.mjs";

let root;
let flowDir;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "app-ui-flow-"));
  flowDir = path.join(root, "flow");
  fs.mkdirSync(path.join(flowDir, "screens", "ホーム"), { recursive: true });
  fs.writeFileSync(path.join(flowDir, "screens", "a.html"), "<!doctype html>");
  fs.writeFileSync(path.join(flowDir, "screens", "ホーム", "code.html"), "<!doctype html>");
  fs.writeFileSync(path.join(flowDir, "DESIGN.md"), "---\nname: x\n---\n");
  fs.writeFileSync(path.join(root, "outside.html"), "<!doctype html>");
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

function write(data, name = "flow.json") {
  const file = path.join(flowDir, name);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
  return file;
}

const screen = (extra = {}) => ({ id: "a", label: "A", file: "screens/a.html", ...extra });

function usageError(data, pattern) {
  assert.throws(() => loadFlow(write(data)), (error) => {
    assert.ok(error instanceof UsageError, `UsageError, got ${error.name}`);
    assert.doesNotMatch(error.message, /\n/, "one line");
    assert.match(error.message, pattern);
    return true;
  });
}

test("a valid flow loads with resolved paths", () => {
  const file = write({
    device: "android",
    designMd: "DESIGN.md",
    screens: [screen({ tapText: "Go", next: "b" }), { id: "b", label: "B", file: "screens/ホーム/code.html", tap: "button" }, { id: "c", label: "C", url: "https://example.org/x" }],
  });
  const flow = loadFlow(file);
  assert.equal(flow.device, "android");
  assert.equal(flow.designMd, path.join(flowDir, "DESIGN.md"));
  assert.equal(flow.dir, flowDir);
  assert.equal(flow.screens.length, 3);
  assert.equal(flow.screens[0].abs, path.join(flowDir, "screens", "a.html"));
  assert.equal(flow.screens[0].urlPath, "screens/a.html");
  assert.equal(flow.screens[0].tapText, "Go");
  assert.equal(flow.screens[0].next, "b");
  assert.equal(flow.screens[1].urlPath, `screens/${encodeURIComponent("ホーム")}/code.html`);
  assert.equal(flow.screens[1].tap, "button");
  assert.equal(flow.screens[2].url, "https://example.org/x");
  assert.equal(flow.screens[2].abs, null);
});

test("device and designMd are optional", () => {
  const flow = loadFlow(write({ screens: [screen()] }));
  assert.equal(flow.device, null);
  assert.equal(flow.designMd, null);
});

test("the template flow.json is valid once its placeholders are filled in", () => {
  const template = fileURLToPath(new URL("../templates/flow.json.tmpl", import.meta.url));
  const data = JSON.parse(fs.readFileSync(template, "utf8"));
  assert.equal(data.screens.length, 3);
  assert.ok(data.screens.every((entry) => /^[a-z0-9][a-z0-9-]*$/.test(entry.id)));
});

test("usage errors name the problem on one line", () => {
  usageError("{not json", /not valid JSON/);
  usageError("[]", /must be a JSON object/);
  usageError({}, /"screens" array/);
  usageError({ screens: [] }, /"screens" array/);
  usageError({ device: "tablet", screens: [screen()] }, /device/);
  usageError({ designMd: "missing.md", screens: [screen()] }, /designMd not found/);
  usageError({ screens: [screen({ id: "Bad_Id" })] }, /id must match/);
  usageError({ screens: [screen({ id: "-lead" })] }, /id must match/);
  usageError({ screens: [screen(), screen()] }, /duplicate screen id "a"/);
  usageError({ screens: [screen({ label: undefined })] }, /label/);
  usageError({ screens: [screen({ file: undefined })] }, /exactly one of "file" or "url"/);
  usageError({ screens: [screen({ url: "http://127.0.0.1/" })] }, /exactly one of "file" or "url"/);
  usageError({ screens: [screen({ file: "screens/none.html" })] }, /file not found: screens\/none\.html/);
  usageError({ screens: [screen({ file: "../outside.html" })] }, /outside the flow\.json folder/);
  usageError({ screens: [screen({ file: path.join(root, "outside.html") })] }, /outside the flow\.json folder/);
  usageError({ screens: [screen({ file: undefined, url: "ftp://x/y" })] }, /http or https/);
  usageError({ screens: [screen({ file: undefined, url: "nonsense" })] }, /http or https/);
  usageError({ screens: [screen({ tap: "a", tapText: "b" })] }, /both "tap" and "tapText"/);
  usageError({ screens: [screen({ tap: 3 })] }, /"tap"/);
  usageError({ screens: [screen({ next: "zzz" })] }, /unknown screen "zzz"/);
});

test("a missing flow.json is a usage error", () => {
  assert.throws(() => loadFlow(path.join(flowDir, "nope.json")), (error) => error instanceof UsageError && /not found/.test(error.message));
});
