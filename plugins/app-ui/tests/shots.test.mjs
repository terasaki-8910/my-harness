import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { decodePng } from "../skills/app-ui/scripts/lib/png.mjs";
import { escapeHtml, sheetHtml } from "../skills/app-ui/scripts/lib/sheet.mjs";
import { PAGE, chromeMissing, fixtures, makeSite, makeTempDir, run } from "./helpers.mjs";

const clean = path.join(fixtures, "clean", "flow.json");
const skip = chromeMissing;

const tile = (id, extra = {}) => ({ id, label: `Screen ${id}`, src: `data:image/png;base64,${id}`, tap: null, scrollY: 0, blank: null, error: null, nextIsFollowing: false, ...extra });
const sheet = (tiles, extra = {}) => sheetHtml({ flowName: "flow.json", device: "ios", width: 390, height: 844, date: "2026-11-23", tiles, ...extra });

describe("flow sheet HTML", () => {
  it("defines its colours once on :root and uses no other colour literal", () => {
    const html = sheet([tile("a", { tap: { x: 10, y: 10, width: 50, height: 20 }, blank: "flat" }), tile("b", { src: null, error: "did not load" })]);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    const root = /:root\s*\{[^}]*\}/.exec(style)[0];
    assert.ok(/--grey-\d/.test(root) && /--accent:/.test(root));
    const rest = style.replace(root, "");
    assert.doesNotMatch(rest, /#[0-9a-f]{3,8}\b/i, "hex literal outside :root");
    assert.doesNotMatch(rest, /\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color|color-mix)\(/i, "colour function outside :root");
    assert.doesNotMatch(rest, /:\s*(white|black|red|green|blue|gray|grey|orange|yellow|purple|transparent|silver|teal|navy)\b/i, "named colour outside :root");
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), /style="[^"]*(#[0-9a-f]{3,8}|rgb\()/i, "inline colours");
    const accents = rest.match(/var\(--accent\)/g) ?? [];
    assert.ok(accents.length >= 2);
  });

  it("puts 'label (id)' above each tile and escapes text", () => {
    const html = sheet([tile("a", { label: "1 <b>Home</b> & more" })]);
    assert.match(html, /1 &lt;b&gt;Home&lt;\/b&gt; &amp; more <span>\(a\)<\/span>/);
    assert.doesNotMatch(html, /<b>Home/);
    assert.match(html, /<h1>flow\.json<\/h1><p>ios &middot; 390x844 &middot; 2026-11-23 &middot; 1 screen<\/p>/);
    assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("outlines the tap rect with percentages of the viewport", () => {
    const html = sheet([tile("a", { tap: { x: 39, y: 84.4, width: 195, height: 42.2 } })]);
    assert.match(html, /class="ring" style="left:10%;top:10%;width:50%;height:5%"/);
    assert.match(html, /\.ring \{[^}]*outline: 2px solid var\(--accent\)[^}]*outline-offset: 2px[^}]*border-radius: 8px/);
    assert.equal((sheet([tile("a")]).match(/class="ring"/g) ?? []).length, 0);
  });

  it("draws an arrow only where next names the following screen", () => {
    const html = sheet([tile("a", { nextIsFollowing: true }), tile("b"), tile("c", { nextIsFollowing: true }), tile("d")]);
    assert.equal(html.match(/<div class="gap"><svg/g).length, 2);
    assert.equal(html.match(/<div class="gap"><\/div>/g).length, 1);
  });

  it("starts a new row after five tiles and says where a wrapped flow continues", () => {
    const tiles = ["a", "b", "c", "d", "e", "f"].map((id) => tile(id, { nextIsFollowing: id !== "f" }));
    const html = sheet(tiles);
    assert.equal(html.match(/<section class="row">/g).length, 2);
    assert.match(html, /&darr; next: f/);
    assert.equal(html.match(/<div class="gap">/g).length, 4, "four gaps in the first row, none in the second");
  });

  it("shows a missing tile and a blank flag", () => {
    const html = sheet([tile("a", { src: null, error: "did not load" }), tile("b", { blank: "white" })]);
    assert.match(html, /class="shot missing"[^>]*>did not load</);
    assert.match(html, /<div class="flag">blank: white<\/div>/);
  });
});

function pngSize(file) {
  const image = decodePng(fs.readFileSync(file));
  return { width: image.width, height: image.height };
}

describe("shots.mjs on the clean flow", { skip }, () => {
  let out;
  let result;
  let report;
  before(async () => {
    out = makeTempDir("app-ui-shots-");
    result = await run("shots.mjs", [clean, "--out", out, "--full"]);
    report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
  });
  after(() => fs.rmSync(out, { recursive: true, force: true }));

  it("exits 0 and prints one line per screen and the sheet path", () => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("PASS ")).length, 3);
    assert.match(result.stdout, /sheet\.png\s*$/);
    assert.equal(result.stderr, "");
  });

  it("writes three viewport PNGs at the requested scale, a sheet and shots.json", () => {
    for (const name of ["01-home.png", "02-detail.png", "03-done.png"]) {
      assert.ok(fs.existsSync(path.join(out, name)), name);
      assert.deepEqual(pngSize(path.join(out, name)), { width: 780, height: 1688 }, name);
    }
    const sheetSize = pngSize(path.join(out, "sheet.png"));
    assert.ok(sheetSize.width > 1500 && sheetSize.height > 1000, JSON.stringify(sheetSize));
  });

  it("shots.json describes every screen and none is blank", () => {
    assert.deepEqual({ device: report.device, width: report.width, height: report.height, dpr: report.dpr }, { device: "ios", width: 390, height: 844, dpr: 2 });
    assert.deepEqual(report.screens.map((screen) => screen.id), ["home", "detail", "done"]);
    assert.deepEqual(report.screens.map((screen) => screen.png), ["01-home.png", "02-detail.png", "03-done.png"]);
    assert.ok(report.screens.every((screen) => screen.blank === null && screen.errors.length === 0));
    assert.ok(report.screens[0].tap && report.screens[1].tap && report.screens[2].tap === null, "tap rects for the screens that name one");
    assert.ok(report.screens[0].tap.width > 200 && report.screens[0].tap.height >= 44);
    assert.ok(report.screens.every((screen) => screen.scrollY === 0));
  });

  it("--full also saves the whole page", () => {
    const home = pngSize(path.join(out, "01-home-full.png"));
    assert.equal(home.width, 780);
    assert.ok(home.height > 1688, `the home page is taller than one screen (${home.height})`);
    assert.equal(report.screens[0].full, "01-home-full.png");
  });
});

describe("shots.mjs edge cases", { skip }, () => {
  it("passes sparse but finished screens and flags a lone spinner (flat limit 0.97, not game3d's 0.9)", async () => {
    const css = "<style>body{margin:0;font-family:sans-serif;color:#1f1f1f;background:#fff}main{padding:80px 16px 40px}h1{font-size:28px;margin:0 0 24px}input{display:block;width:100%;box-sizing:border-box;height:48px;border:1px solid #d9d9d9;border-radius:12px;margin:0 0 16px}.btn{display:block;width:100%;height:48px;border:0;border-radius:12px;background:#0b7a75;color:#fff;font-size:15px}p{text-align:center;color:#5f5f5f;font-size:15px}</style>";
    const page = (body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,">${css}</head><body>${body}</body></html>`;
    const site = makeSite({
      "signin.html": page('<main><h1>ログイン</h1><input aria-label="メールアドレス"><input type="password" aria-label="パスワード"><button class="btn">ログインする</button><p>パスワードを忘れた場合</p></main>'),
      "confirm.html": page('<main style="text-align:center;padding-top:160px"><svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="none" stroke="#0b7a75" stroke-width="5"/><path d="M24 41l11 11 21-23" fill="none" stroke="#0b7a75" stroke-width="5"/></svg><h1>予約しました</h1><p>明日の 8:00 に、駅前店のカウンターでお受け取りください。</p><button class="btn">ホームへ戻る</button></main>'),
      "spinner.html": page('<div style="position:fixed;left:175px;top:402px;width:32px;height:32px;border:4px solid #d9d9d9;border-top-color:#0b7a75;border-radius:50%"></div>'),
      "flow.json": { screens: ["signin", "confirm", "spinner"].map((id) => ({ id, label: id, file: `${id}.html` })) },
    });
    const out = path.join(site, "out");
    try {
      const result = await run("shots.mjs", [path.join(site, "flow.json"), "--out", out]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
      const byId = Object.fromEntries(report.screens.map((screen) => [screen.id, screen]));
      for (const id of ["signin", "confirm"]) {
        assert.equal(byId[id].blank, null, `${id}: ${JSON.stringify(byId[id].stats)}`);
        assert.ok(byId[id].stats.mode > 0.9, `${id} would be flat at 0.9: ${JSON.stringify(byId[id].stats)}`);
      }
      assert.equal(byId.spinner.blank, "white");
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("scrolls a tap target below the fold into view and records the scroll position", async () => {
    const site = makeSite({
      "tall.html": PAGE('<div style="height:1500px"></div><button id="go" style="width:200px;height:48px">Go</button><div style="height:600px"></div>'),
      "flow.json": { screens: [{ id: "tall", label: "Tall", file: "tall.html", tap: "#go" }] },
    });
    const out = path.join(site, "out");
    try {
      const result = await run("shots.mjs", [path.join(site, "flow.json"), "--out", out, "--dpr", "1"]);
      const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
      assert.ok(report.screens[0].scrollY > 1000, JSON.stringify(report.screens[0]));
      const tap = report.screens[0].tap;
      assert.ok(tap.y > 300 && tap.y + tap.height < 600, `centred in the 844px viewport: ${JSON.stringify(tap)}`);
      assert.deepEqual(pngSize(path.join(out, "01-tall.png")), { width: 390, height: 844 });
      assert.ok(result.status === 0 || result.status === 1, "exit code reflects the blank check only");
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("a blank screen exits 1 and the files are still written", async () => {
    const site = makeSite({
      "empty.html": '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>e</title></head><body style="margin:0;background:#fff"></body></html>',
      "flow.json": { screens: [{ id: "empty", label: "Empty", file: "empty.html" }] },
    });
    const out = path.join(site, "out");
    try {
      const result = await run("shots.mjs", [path.join(site, "flow.json"), "--out", out]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /FAIL 01 empty blank \((white|uniform)\)/);
      const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
      assert.ok(report.screens[0].blank);
      assert.ok(fs.existsSync(path.join(out, "sheet.png")));
      assert.ok(fs.existsSync(path.join(out, "01-empty.png")));
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("a page error exits 1, lists the error and still writes the shot", async () => {
    const site = makeSite({
      "bad.html": PAGE("<h1>Title</h1><p>Some text so the frame is not blank.</p><p>More text here, and more.</p>", { head: "<script>console.error('planted')</script>" }),
      "flow.json": { screens: [{ id: "bad", label: "Bad", file: "bad.html" }] },
    });
    const out = path.join(site, "out");
    try {
      const result = await run("shots.mjs", [path.join(site, "flow.json"), "--out", out]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /shots: bad: console: console\.error: planted/);
      const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
      assert.equal(report.screens[0].errors.length, 1);
      assert.ok(fs.existsSync(path.join(out, "01-bad.png")));
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });

  it("a screen that never becomes ready is listed, the others are still shot", async () => {
    const site = makeSite({
      "never.html": PAGE("<p>never</p>", { head: "<script>window.__appReady = false</script>" }),
      "ok.html": PAGE("<h1>Title</h1><p>Some text so the frame is not blank.</p><p>More text here, and more.</p>"),
      "flow.json": { screens: [{ id: "never", label: "Never", file: "never.html", next: "ok" }, { id: "ok", label: "Ok", file: "ok.html" }] },
    });
    const out = path.join(site, "out");
    try {
      const result = await run("shots.mjs", [path.join(site, "flow.json"), "--out", out, "--timeout", "2"]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /FAIL 01 never no screenshot/);
      assert.match(result.stderr, /shots: never: load: /);
      const report = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8"));
      assert.equal(report.screens[0].png, null);
      assert.ok(report.screens[1].png);
      assert.ok(fs.existsSync(path.join(out, "sheet.png")));
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });
});

describe("shots.mjs usage errors exit 2", () => {
  it("bad arguments and flows", async () => {
    const cases = [[[], /usage/], [[clean, "--dpr", "0"], /--dpr/], [["nope.json"], /flow\.json not found/], [[clean, "--only", "x"], /unknown option --only/]];
    for (const [args, pattern] of cases) {
      const result = await run("shots.mjs", args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, pattern);
    }
  });
});
