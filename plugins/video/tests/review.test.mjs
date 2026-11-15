import assert from "node:assert/strict";
import test from "node:test";
import { findFont, formatTime, reviewFilter, sheetHtml } from "../skills/demo-video/scripts/lib/review.mjs";

test("findFont tries VIDEO_FONT then each platform's candidates in order", () => {
  const macTried = [];
  assert.equal(findFont({ env: { VIDEO_FONT: "/custom/font.ttf" }, platform: "darwin", exists(candidate) { macTried.push(candidate); return candidate.endsWith("Helvetica.ttc"); } }), "/System/Library/Fonts/Helvetica.ttc");
  assert.deepEqual(macTried, ["/custom/font.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]);

  const linuxTried = [];
  assert.equal(findFont({ env: {}, platform: "linux", exists(candidate) { linuxTried.push(candidate); return candidate === "/usr/share/fonts/dejavu/DejaVuSans.ttf"; } }), "/usr/share/fonts/dejavu/DejaVuSans.ttf");
  assert.deepEqual(linuxTried, ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]);

  const windowsTried = [];
  assert.equal(findFont({ env: {}, platform: "win32", exists(candidate) { windowsTried.push(candidate); return true; } }), "C:/Windows/Fonts/arial.ttf");
  assert.deepEqual(windowsTried, ["C:/Windows/Fonts/arial.ttf"]);
  assert.equal(findFont({ env: {}, platform: "freebsd", exists: () => false }), null);
});

test("reviewFilter includes timecodes only with a font and escapes Windows paths", () => {
  assert.equal(reviewFilter({ fps: 4, width: 384, cols: 5, rows: 5, font: null }), "fps=4,scale=384:-2,tile=5x5:padding=4:color=gray");
  const filter = reviewFilter({ fps: "1/2", width: 384, cols: 5, rows: 4, font: "C:\\Windows\\Fonts\\arial.ttf" });
  assert.match(filter, /^fps=1\/2,scale=384:-2,drawtext=/);
  assert.match(filter, /fontfile='C\\:\/Windows\/Fonts\/arial\.ttf'/);
  assert.match(filter, /text='%\{pts\\:hms\}'/);
  assert.match(filter, /:x=8:y=8:.*box=1:boxcolor=black@0\.7/);
  assert.match(filter, /,tile=5x4:padding=4:color=gray$/);
});

test("formatTime renders minutes, seconds, and hundredths", () => {
  assert.equal(formatTime(0), "00:00.00");
  assert.equal(formatTime(75.5), "01:15.50");
  assert.equal(formatTime(59.999), "01:00.00");
});

test("sheetHtml labels and escapes each supplied frame without empty tiles", () => {
  const html = sheetHtml({
    frames: [
      { src: "f_00001.png", time: 0 },
      { src: "a&b.png", time: 1.25 },
      { src: '\"><script>alert(1)</script>.png', time: 75.5 },
    ],
    cols: 3,
    tileWidth: 384,
  });
  assert.match(html, /grid-template-columns:repeat\(3,384px\)/);
  assert.equal((html.match(/class="tile"/g) ?? []).length, 3);
  for (const label of ["00:00.00", "00:01.25", "01:15.50"]) assert.match(html, new RegExp(label.replace(".", "\\.")));
  assert.match(html, /src="a&amp;b\.png"/);
  assert.match(html, /src="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;\.png"/);
  assert.doesNotMatch(html, /<script>alert/);
});
