import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it, after } from "node:test";
import { startBrowser } from "../skills/app-ui/scripts/lib/browser.mjs";
import { PAGE, chromeMissing, fixtures, makeSite, makeTempDir, run } from "./helpers.mjs";

const clean = path.join(fixtures, "clean", "flow.json");
const defects = path.join(fixtures, "defects", "flow.json");
const skip = chromeMissing;

const PLANTED_FAIL = ["console", "request", "image", "overflow", "viewport-meta", "tap"];
const PLANTED_WARN = ["target", "text-size", "contrast", "fixed-cover", "safe-area", "primary", "token-color", "token-font", "token-size", "token-radius", "placeholder", "emoji"];

const lines = (text, level) => text.split(/\r?\n/).filter((line) => line.startsWith(`${level} `));

describe("check.mjs on the fixtures", { skip }, () => {
  let ios;
  let android;
  let broken;
  let report;
  let reportDir;

  before(async () => {
    reportDir = makeTempDir("app-ui-report-");
    [ios, android, broken] = await Promise.all([
      run("check.mjs", [clean]),
      run("check.mjs", [clean, "--device", "android"]),
      run("check.mjs", [defects, "--report", path.join(reportDir, "r.json")]),
    ]);
    report = JSON.parse(fs.readFileSync(path.join(reportDir, "r.json"), "utf8"));
  });
  after(() => fs.rmSync(reportDir, { recursive: true, force: true }));

  it("the clean flow passes on ios with no WARN", () => {
    assert.equal(ios.status, 0, ios.stdout + ios.stderr);
    assert.match(ios.stdout, /\n0 FAIL, 0 WARN\n/);
    assert.deepEqual(lines(ios.stdout, "WARN"), []);
    assert.match(ios.stdout, /== home 1 今日のパン \(390x844 ios\)/);
    assert.match(ios.stdout, /NEEDS HUMAN/);
  });

  it("the clean flow passes on android with no WARN", () => {
    assert.equal(android.status, 0, android.stdout + android.stderr);
    assert.match(android.stdout, /\n0 FAIL, 0 WARN\n/);
    assert.deepEqual(lines(android.stdout, "WARN"), []);
    assert.match(android.stdout, /== detail 2 パンセットの予約 \(412x915 android\)/);
  });

  it("the defects flow exits 1 and prints findings in the documented format", () => {
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    for (const line of [...lines(broken.stdout, "FAIL"), ...lines(broken.stdout, "WARN")]) assert.match(line, /^(FAIL|WARN) [a-z-]+: \S/);
    assert.match(broken.stdout, /\n\d+ FAIL, \d+ WARN\n/);
  });

  it("the report holds every planted code", () => {
    const fail = new Set(report.screens.flatMap((screen) => screen.fail.map((item) => item.code)));
    const warn = new Set(report.screens.flatMap((screen) => screen.warn.map((item) => item.code)));
    for (const code of PLANTED_FAIL) assert.ok(fail.has(code), `FAIL ${code}`);
    for (const code of PLANTED_WARN) assert.ok(warn.has(code), `WARN ${code}`);
    assert.ok(report.screens.some((screen) => screen.info.contrastUnknown.count > 0), "info contrast-unknown");
    assert.ok(report.screens.some((screen) => screen.info.origins.includes("http://127.0.0.1:9")), "info origins");
    assert.equal(report.device, "ios");
    assert.equal(report.width, 390);
    assert.equal(report.height, 844);
    assert.equal(report.fail, report.screens.reduce((sum, screen) => sum + screen.fail.length, 0));
    assert.equal(report.warn, report.screens.reduce((sum, screen) => sum + screen.warn.length, 0));
    assert.match(report.designMd, /defects\/DESIGN\.md$/);
    assert.deepEqual(report.screens.map((screen) => screen.id), ["runtime", "overflow", "viewport-meta", "tap", "targets", "bars", "style", "content"]);
    assert.equal(report.screens[0].file, "runtime.html");
  });

  it("the viewport-meta and overflow screens carry only their own defect", () => {
    const codesOf = (id) => {
      const screen = report.screens.find((entry) => entry.id === id);
      return [...screen.fail, ...screen.warn].map((item) => item.code);
    };
    assert.deepEqual(codesOf("viewport-meta"), ["viewport-meta"]);
    assert.deepEqual(codesOf("overflow"), ["overflow"]);
    assert.deepEqual(codesOf("tap"), ["tap"]);
  });

  it("contrast is measured under text below the fold", () => {
    const targets = report.screens.find((screen) => screen.id === "targets");
    assert.ok(targets.warn.some((item) => item.code === "contrast" && /#5f5f5f on #1f1f1f/.test(item.message)), JSON.stringify(targets.warn));
  });

  it("an uncaught exception and a console error are each reported once", () => {
    const runtime = report.screens.find((screen) => screen.id === "runtime");
    assert.equal(runtime.fail.filter((item) => item.code === "console").length, 2);
    assert.equal(runtime.fail.filter((item) => item.code === "request").length, 2);
    assert.equal(runtime.fail.filter((item) => item.code === "image").length, 1);
  });

  it("--only checks just the named screens", async () => {
    const result = await run("check.mjs", [clean, "--only", "done"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /== done /);
    assert.doesNotMatch(result.stdout, /== home /);
  });
});

describe("check.mjs usage and setup errors exit 2", () => {
  const failsWith = async (args, pattern, options) => {
    const result = await run("check.mjs", args, options);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, pattern);
    assert.equal(result.stdout, "", "nothing on stdout");
  };

  it("no arguments", () => failsWith([], /^check: usage:/));
  it("an unknown option", () => failsWith([clean, "--wat"], /unknown option --wat/));
  it("a flow.json that does not exist", () => failsWith(["no-such-flow.json"], /flow\.json not found/));
  it("an unknown --only id", () => failsWith([clean, "--only", "nope"], /unknown screen\(s\): nope/));

  it("a flow.json with a duplicate id", async () => {
    const site = makeSite({ "a.html": PAGE("a"), "flow.json": { screens: [{ id: "a", label: "A", file: "a.html" }, { id: "a", label: "B", file: "a.html" }] } });
    try {
      await failsWith([path.join(site, "flow.json")], /duplicate screen id "a"/);
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("a DESIGN.md that does not parse names the line", async () => {
    const site = makeSite({
      "a.html": PAGE("a"),
      "DESIGN.md": "---\nname: x\ncolors:\n  - red\n---\n",
      "flow.json": { designMd: "DESIGN.md", screens: [{ id: "a", label: "A", file: "a.html" }] },
    });
    try {
      await failsWith([path.join(site, "flow.json")], /DESIGN\.md line 4: sequences/);
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("a CHROME_PATH that is not a browser (the setup fails)", async () => {
    const result = await run("check.mjs", [clean], { env: { ...process.env, CHROME_PATH: process.execPath } });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /^check: \S/);
  });

  it("startBrowser reports a missing Chrome", () => {
    const env = { CHROME_PATH: path.join(fixtures, "no-such-chrome.exe"), PATH: "", PROGRAMFILES: "", "PROGRAMFILES(X86)": "", LOCALAPPDATA: "", HOME: "" };
    if (process.platform === "darwin") return;
    assert.throws(() => startBrowser({ width: 390, height: 844, env }), /Chrome or Chromium was not found/);
  });
});

describe("check.mjs readiness and colour resolution", { skip }, () => {
  let site;
  before(() => {
    site = makeSite({
      "never.html": PAGE("<p>never ready</p>", { head: "<script>window.__appReady = false;</script>" }),
      "later.html": PAGE("<p>ready after a moment</p>", { head: "<script>window.__appReady = false; setTimeout(() => { window.__appReady = true; }, 1200);</script>" }),
      "truthy.html": PAGE("<p>truthy is not true</p>", { head: "<script>window.__appReady = 1;</script>" }),
      "colors.html": PAGE([
        '<div id="a" style="background: rgba(123, 97, 255, 0.1); padding: 8px">rgba tint</div>',
        '<div id="b" style="background: color-mix(in srgb, #7b61ff 10%, transparent); padding: 8px">color-mix tint</div>',
        '<div id="c" style="background: oklch(0.62 0.19 285); color: #fff; padding: 8px">oklch</div>',
        '<div id="d" style="background: #7b61ff1a; padding: 8px">hex8 tint</div>',
      ].join("")),
      "DESIGN.md": [
        "---", "name: t", "colors:",
        '  ink: "#1F1F1F"', '  paper: "#FFFFFF"', '  tint-rgba: "rgba(123, 97, 255, 0.1)"',
        "typography:", "  body:", "    fontFamily: sans-serif", "    fontSize: 15px",
        "---", "## Overview", "",
      ].join("\n"),
      "flow.json": {
        designMd: "DESIGN.md",
        screens: [
          { id: "never", label: "never ready", file: "never.html" },
          { id: "later", label: "ready later", file: "later.html" },
          { id: "truthy", label: "truthy", file: "truthy.html" },
          { id: "colors", label: "colours", file: "colors.html" },
        ],
      },
    });
  });
  after(() => fs.rmSync(site, { recursive: true, force: true }));

  it("a screen that never sets window.__appReady to true fails with FAIL load; the next screen is still checked", async () => {
    const result = await run("check.mjs", [path.join(site, "flow.json"), "--timeout", "3", "--only", "never,later"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /== never never ready[^\n]*\nFAIL load: timed out waiting for window\.__appReady/);
    const later = result.stdout.split("== later")[1].split("\n\n")[0];
    assert.doesNotMatch(later, /FAIL/);
  });

  it("an error that only the browser log reports (a blocked inline script) is a console FAIL, and a blocked request names its reason", async () => {
    const blocked = makeSite({
      "a.html": PAGE("<p>csp</p>", { head: `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; img-src 'none'">` }).replace("</body>", '<img src="x.png" alt=""><script>console.error("blocked")</script></body>'),
      "flow.json": { screens: [{ id: "a", label: "A", file: "a.html" }] },
    });
    try {
      const result = await run("check.mjs", [path.join(blocked, "flow.json")]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /FAIL console: browser log: .*Content Security Policy/);
      assert.match(result.stdout, /FAIL request: \S+x\.png failed \(.*blocked: csp\)/);
    } finally {
      fs.rmSync(blocked, { recursive: true, force: true });
    }
  });

  it("only exactly true counts as ready", async () => {
    const result = await run("check.mjs", [path.join(site, "flow.json"), "--timeout", "2", "--only", "truthy"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL load: timed out waiting for window\.__appReady/);
  });

  it("low-alpha, color-mix and oklch colours resolve with exact RGB", async () => {
    const directory = makeTempDir("app-ui-colors-");
    try {
      const report = path.join(directory, "r.json");
      const result = await run("check.mjs", [path.join(site, "flow.json"), "--only", "colors", "--report", report]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const screen = JSON.parse(fs.readFileSync(report, "utf8")).screens[0];
      const tint = screen.info.colors.find((entry) => entry.color === "#7b61ff@0.1");
      assert.ok(tint, `colours: ${JSON.stringify(screen.info.colors)}`);
      assert.equal(tint.count, 3, "rgba(), color-mix() and #rrggbbaa all give rgb(123, 97, 255) at alpha 0.1");
      assert.ok(!screen.warn.some((item) => item.code === "token-color" && /#7b61ff/.test(item.message)), "a tint of a token colour is not a token-color WARN");
      assert.ok(screen.warn.some((item) => item.code === "token-color"), "the oklch background is outside DESIGN.md");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("check.mjs element semantics", { skip }, () => {
  let site;
  let report;
  before(async () => {
    site = makeSite({
      "page.html": PAGE([
        '<p>これは文章の途中にある<a href="#x">リンク</a>です。</p>',
        '<button disabled style="width:20px;height:20px">x</button>',
        '<button aria-disabled="true" style="width:20px;height:20px">y</button>',
        '<nav style="display:flex;gap:4px"><a href="#a">A</a><a href="#b">B</a></nav>',
        '<label style="display:block;padding:14px"><input type="checkbox"> 同意する</label>',
        '<button id="z" style="width:20px;height:20px">z</button>',
        '<a href="#hidden" style="display:none">見えないリンク</a>',
        '<a href="#same">同じ文字</a><a href="#same2">同じ文字</a>',
      ].join("")),
      "flow.json": {
        screens: [
          { id: "contains", label: "tapText contains", file: "page.html", tapText: "リン" },
          { id: "equals", label: "tapText equals wins over contains", file: "page.html", tapText: "A" },
          { id: "many", label: "selector matches several", file: "page.html", tap: "button" },
          { id: "hidden", label: "hidden target", file: "page.html", tapText: "見えないリンク" },
          { id: "twice", label: "same text twice", file: "page.html", tapText: "同じ文字" },
          { id: "bad", label: "invalid selector", file: "page.html", tap: "((" },
        ],
      },
    });
    const output = path.join(site, "report.json");
    await run("check.mjs", [path.join(site, "flow.json"), "--report", output]);
    report = JSON.parse(fs.readFileSync(output, "utf8"));
  });
  after(() => fs.rmSync(site, { recursive: true, force: true }));

  const screen = (id) => report.screens.find((entry) => entry.id === id);

  it("a unique tapText match is fine, by contains or by equals", () => {
    assert.deepEqual(screen("contains").fail, []);
    assert.deepEqual(screen("equals").fail, [], "A equals the first link; the B link and the others only contain no A of their own");
  });

  it("FAIL tap for several matches, a hidden match, duplicate text and an invalid selector", () => {
    for (const id of ["many", "hidden", "twice", "bad"]) assert.deepEqual(screen(id).fail.map((item) => item.code), ["tap"], id);
    assert.match(screen("bad").fail[0].message, /not usable/);
  });

  it("target WARN skips inline links, disabled buttons and label-sized checkboxes", () => {
    const targets = screen("contains").warn.filter((item) => item.code === "target").map((item) => item.message);
    const named = (text) => targets.some((message) => message.includes(`"${text}"`));
    assert.ok(named("A") && named("B"), "links in a flex nav are targets");
    assert.ok(named("z"), "a plain small button");
    assert.ok(!named("リンク"), "an inline link in a sentence is exempt");
    assert.ok(!named("x") && !named("y"), "disabled and aria-disabled buttons are exempt");
    assert.ok(!targets.some((message) => message.startsWith("input")), "the checkbox takes its label's size");
  });
});
