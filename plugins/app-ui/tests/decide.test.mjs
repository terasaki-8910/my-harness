import assert from "node:assert/strict";
import test from "node:test";
import { DEVICES } from "../skills/app-ui/scripts/lib/args.mjs";
import { MAX_TARGET_LINES, backgroundOf, crossScreenLine, decideScreen, formatFinding, infoLines, isLargeText } from "../skills/app-ui/scripts/lib/decide.mjs";

const ios = { ...DEVICES.ios };
const android = { ...DEVICES.android };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const DESIGN = {
  colors: { primary: "#0B7A75", surface: "#FFFFFF", text: "#1F1F1F" },
  typography: { body: { fontFamily: "Noto Sans JP", fontSize: "15px" }, small: { fontFamily: "Noto Sans JP, sans-serif", fontSize: "11px" } },
  rounded: { none: "0px", md: "12px", full: "9999px" },
};
const TOKENS = [
  { name: "primary", value: "#0B7A75", rgba: { r: 11, g: 122, b: 117, a: 1 } },
  { name: "surface", value: "#FFFFFF", rgba: WHITE },
  { name: "text", value: "#1F1F1F", rgba: { r: 31, g: 31, b: 31, a: 1 } },
];

const text = (extra = {}) => ({
  tag: "p", text: "朝のパン", rect: { x: 16, y: 100, width: 80, height: 24 }, fontSize: 15, fontWeight: 400, family: "Noto Sans JP",
  color: { r: 31, g: 31, b: 31, a: 1 }, opacity: 1, kind: "text", stack: [{ bg: WHITE, image: false }], ...extra,
});
const control = (extra = {}) => ({ tag: "button", text: "予約", rect: { x: 16, y: 200, width: 120, height: 48 }, disabled: false, inline: false, inFixed: false, bg: null, ...extra });

function page(extra = {}) {
  return {
    doc: { innerWidth: 390, innerHeight: 844, clientWidth: 390, clientHeight: 844, scrollWidth: 390, scrollHeight: 1200, viewportMeta: "width=device-width, initial-scale=1" },
    images: [], interactive: [], texts: [], colors: [], radii: [], primaries: [], fixed: [], covered: [], tap: undefined, tokens: TOKENS, ...extra,
  };
}
const diagnostics = (extra = {}) => ({ consoleErrors: [], exceptions: [], failedRequests: [], httpErrors: [], requests: [], hasDeclaredIcon: false, ...extra });

function decide(pageData, { device = ios, designMd = null, screen = null, minText = 11, diag = diagnostics(), loadError = null } = {}) {
  return decideScreen({ loadError, diagnostics: diag, page: loadError ? null : pageData }, { device, minText, screen, designMd, ownOrigins: ["http://127.0.0.1:5000"] });
}
const codes = (list) => list.map((item) => item.code);
const only = (result, code) => [...result.fail, ...result.warn].filter((item) => item.code === code);

test("a clean page has no FAIL and no WARN", () => {
  const result = decide(page({ texts: [text()], interactive: [control()] }), { designMd: DESIGN });
  assert.deepEqual(result.fail, []);
  assert.deepEqual(result.warn, []);
});

test("formatFinding", () => {
  assert.equal(formatFinding("FAIL", { code: "console", message: "x" }), "FAIL console: x");
  assert.equal(formatFinding("WARN", { code: "target", message: "y" }), "WARN target: y");
});

test("FAIL load stops all other decisions", () => {
  const result = decide(null, { loadError: "timed out waiting for the load event", diag: diagnostics({ consoleErrors: ["x"] }) });
  assert.deepEqual(result.fail, [{ code: "load", message: "timed out waiting for the load event" }]);
  assert.deepEqual(result.warn, []);
});

test("FAIL console covers console.error and uncaught exceptions", () => {
  const result = decide(page(), { diag: diagnostics({ consoleErrors: ["boom"], logErrors: ["Refused to apply style"], exceptions: ["Error: bad\n at x"] }) });
  assert.deepEqual(result.fail.map((item) => item.message), ["console.error: boom", "browser log: Refused to apply style", "uncaught exception: Error: bad at x"]);
  assert.deepEqual(codes(result.fail), ["console", "console", "console"]);
});

test("FAIL request lists failed and HTTP-error URLs once", () => {
  const result = decide(page(), {
    diag: diagnostics({
      failedRequests: [{ url: "http://127.0.0.1:9/x.css", error: "ERR_UNSAFE_PORT" }, { url: "http://127.0.0.1:9/x.css", error: "ERR_UNSAFE_PORT" }],
      httpErrors: [{ url: "http://127.0.0.1:5000/a.png", status: 404 }],
    }),
  });
  assert.deepEqual(result.fail.map((item) => item.message), ["http://127.0.0.1:9/x.css failed (ERR_UNSAFE_PORT)", "http://127.0.0.1:5000/a.png returned HTTP 404"]);
});

test("the automatic favicon request is ignored unless the page declares an icon", () => {
  const favicon = { url: "http://127.0.0.1:5000/favicon.ico", status: 404 };
  assert.deepEqual(decide(page(), { diag: diagnostics({ httpErrors: [favicon], failedRequests: [{ url: favicon.url, error: "x" }] }) }).fail, []);
  const declared = decide(page(), { diag: diagnostics({ httpErrors: [favicon], hasDeclaredIcon: true }) });
  assert.deepEqual(codes(declared.fail), ["request"]);
  assert.equal(decide(page(), { diag: diagnostics({ httpErrors: [{ url: "http://127.0.0.1:5000/sub/favicon.ico", status: 404 }] }) }).fail.length, 1);
});

test("FAIL image: complete with naturalWidth 0", () => {
  const result = decide(page({ images: [{ src: "http://h/a.png", complete: true, naturalWidth: 0 }, { src: "http://h/ok.png", complete: true, naturalWidth: 10 }, { src: "http://h/lazy.png", complete: false, naturalWidth: 0 }, { src: "", complete: true, naturalWidth: 0 }] }));
  assert.deepEqual(result.fail.map((item) => item.code), ["image"]);
  assert.match(result.fail[0].message, /a\.png/);
});

test("FAIL overflow uses the layout viewport and allows 1px", () => {
  const wide = (scrollWidth, extra = {}) => page({ doc: { ...page().doc, scrollWidth, ...extra } });
  assert.deepEqual(decide(wide(391)).fail, []);
  assert.deepEqual(codes(decide(wide(392)).fail), ["overflow"]);
  assert.deepEqual(codes(decide(wide(501, { innerWidth: 501 })).fail), ["overflow"], "a zoomed-out page reports a larger innerWidth");
  const legacy = { innerWidth: 390, innerHeight: 844, scrollWidth: 500, scrollHeight: 900, viewportMeta: "width=device-width" };
  assert.deepEqual(codes(decide(page({ doc: legacy })).fail), ["overflow"], "without clientWidth it falls back to innerWidth");
});

test("FAIL viewport-meta: missing or without width=device-width", () => {
  const meta = (viewportMeta) => page({ doc: { ...page().doc, viewportMeta } });
  assert.deepEqual(codes(decide(meta(null)).fail), ["viewport-meta"]);
  assert.deepEqual(codes(decide(meta("initial-scale=1")).fail), ["viewport-meta"]);
  assert.deepEqual(codes(decide(meta("width=980")).fail), ["viewport-meta"]);
  assert.deepEqual(decide(meta("width = device-width,initial-scale=1")).fail, []);
  assert.deepEqual(decide(meta("initial-scale=1, width=device-width")).fail, []);
});

test("FAIL tap: the flow's tap must match exactly one visible element", () => {
  const tapped = (tap, screen) => decide(page({ tap }), { screen });
  assert.deepEqual(tapped({ count: 1, visibleCount: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }, { tapText: "Go" }).fail, []);
  assert.deepEqual(codes(tapped({ count: 0, visibleCount: 0, rect: null }, { tapText: "Go" }).fail), ["tap"]);
  assert.deepEqual(codes(tapped({ count: 3, visibleCount: 2, rect: null }, { tap: ".x" }).fail), ["tap"]);
  assert.deepEqual(codes(tapped({ count: 1, visibleCount: 0, rect: null }, { tap: ".x" }).fail), ["tap"], "present but hidden");
  assert.match(tapped({ count: 0, visibleCount: 0, rect: null, error: "not a selector" }, { tap: "((" }).fail[0].message, /not usable/);
  assert.deepEqual(decide(page(), { screen: { tapText: "Go" } }).fail.map((item) => item.code), ["tap"], "collect gave no tap data");
  assert.deepEqual(decide(page(), { screen: null }).fail, [], "the flow gave no tap");
});

test("WARN target: below minTarget, not disabled, not inline; per device", () => {
  const small = (width, height, extra = {}) => page({ interactive: [control({ rect: { x: 0, y: 100, width, height }, ...extra })] });
  assert.deepEqual(codes(decide(small(32, 32)).warn), ["target"]);
  assert.deepEqual(decide(small(44, 44)).warn, []);
  assert.deepEqual(codes(decide(small(44, 43)).warn), ["target"]);
  assert.deepEqual(codes(decide(small(48, 44), { device: android }).warn), ["target"], "android needs 48");
  assert.deepEqual(decide(small(48, 48), { device: android }).warn, []);
  assert.deepEqual(decide(small(20, 20, { disabled: true })).warn, [], "disabled is exempt");
  assert.deepEqual(decide(small(60, 18, { inline: true })).warn, [], "an inline link is exempt");
});

test("WARN target is limited to 20 lines and one +N more line", () => {
  const many = Array.from({ length: 27 }, (_, index) => control({ text: `b${index}`, rect: { x: 0, y: 100 + index * 10, width: 20, height: 20 } }));
  const result = decide(page({ interactive: many }));
  assert.equal(MAX_TARGET_LINES, 20);
  assert.equal(result.warn.length, 21);
  assert.equal(result.warn[20].message, "+7 more");
  assert.ok(result.warn.every((item) => item.code === "target"));
});

test("WARN text-size follows --min-text", () => {
  const small = page({ texts: [text({ fontSize: 9, text: "tiny" })] });
  assert.deepEqual(codes(decide(small).warn), ["text-size"]);
  assert.deepEqual(decide(page({ texts: [text({ fontSize: 11 })] })).warn, []);
  assert.deepEqual(decide(small, { minText: 9 }).warn, []);
  assert.deepEqual(codes(decide(page({ texts: [text({ fontSize: 12 })] }), { minText: 13 }).warn), ["text-size"]);
});

test("WARN contrast: 4.5:1 for body text, 3:1 for large text", () => {
  const grey = { r: 0x9e, g: 0x9e, b: 0x9e, a: 1 };
  assert.deepEqual(codes(decide(page({ texts: [text({ color: grey })] })).warn), ["contrast"]);
  assert.match(only(decide(page({ texts: [text({ color: grey })] })), "contrast")[0].message, /2\.68:1 is below 4\.5:1/);
  assert.match(only(decide(page({ texts: [text({ color: grey, fontSize: 24 })] })), "contrast")[0].message, /below 3:1/, "large text still needs 3:1");
});

test("WARN contrast: large text passes at 3:1 but not below", () => {
  const mid = { r: 0x85, g: 0x85, b: 0x85, a: 1 }; // about 3.6:1 on white
  assert.deepEqual(codes(decide(page({ texts: [text({ color: mid })] })).warn), ["contrast"]);
  assert.deepEqual(decide(page({ texts: [text({ color: mid, fontSize: 24 })] })).warn, []);
  assert.deepEqual(decide(page({ texts: [text({ color: mid, fontSize: 19, fontWeight: 700 })] })).warn, []);
  assert.deepEqual(codes(decide(page({ texts: [text({ color: mid, fontSize: 19, fontWeight: 400 })] })).warn), ["contrast"]);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.65, 700), false);
  assert.equal(isLargeText(23.9, 400), false);
});

test("contrast composites the stack over white and applies opacity", () => {
  const tint = { bg: { r: 0, g: 0, b: 0, a: 0.5 }, image: false };
  assert.deepEqual(backgroundOf([tint]).color, { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.deepEqual(backgroundOf([tint, { bg: { r: 255, g: 0, b: 0, a: 1 }, image: false }, { bg: WHITE, image: false }]).color, { r: 127.5, g: 0, b: 0, a: 1 });
  assert.deepEqual(backgroundOf([{ bg: { r: 0, g: 0, b: 0, a: 0 }, image: false }]).color, WHITE, "a transparent root over the white page");
  assert.deepEqual(backgroundOf([]), { unknown: true }, "an empty stack means the text was not sampled");
  const faint = text({ color: { r: 31, g: 31, b: 31, a: 1 }, opacity: 0.3 });
  assert.deepEqual(codes(decide(page({ texts: [faint] })).warn), ["contrast"], "opacity lowers the contrast");
  assert.deepEqual(decide(page({ texts: [text({ opacity: 0 })] })).warn, [], "invisible text is skipped");
  assert.deepEqual(decide(page({ texts: [text({ color: { r: 0, g: 0, b: 0, a: 0 } })] })).warn, [], "transparent text is skipped");
  const onDark = text({ color: { r: 255, g: 255, b: 255, a: 1 }, stack: [{ bg: { r: 0x0b, g: 0x7a, b: 0x75, a: 1 }, image: false }] });
  assert.deepEqual(decide(page({ texts: [onDark] })).warn, []);
});

test("text that could not be sampled is not scored against white", () => {
  const light = text({ color: { r: 255, g: 255, b: 255, a: 1 }, stack: [] });
  const result = decide(page({ texts: [light] }));
  assert.deepEqual(result.warn, []);
  assert.equal(result.info.contrastUnknown.count, 1);
});

test("contrast over an image or gradient goes to info contrast-unknown", () => {
  const over = text({ text: "on a gradient", stack: [{ bg: { r: 0, g: 0, b: 0, a: 0 }, image: true }] });
  const result = decide(page({ texts: [over, text({ text: "b", stack: [{ bg: { r: 9, g: 9, b: 9, a: 0.4 }, image: false }, { bg: WHITE, image: true }] })] }));
  assert.deepEqual(result.warn, []);
  assert.equal(result.info.contrastUnknown.count, 2);
  assert.match(infoLines(result.info).join("\n"), /info contrast-unknown: 2 text\(s\)/);
});

test("WARN fixed-cover lists each covered item", () => {
  const result = decide(page({ covered: [{ tag: "p", text: "last row", edge: "bottom" }, { tag: "h1", text: "title", edge: "top" }] }));
  assert.deepEqual(codes(result.warn), ["fixed-cover", "fixed-cover"]);
  assert.match(result.warn[0].message, /last row.*bottom bar/);
});

test("WARN safe-area: top at scroll 0 and bottom bars", () => {
  const top = decide(page({ interactive: [control({ rect: { x: 0, y: 40, width: 60, height: 48 } })] }));
  assert.deepEqual(codes(top.warn), ["safe-area"]);
  assert.deepEqual(decide(page({ interactive: [control({ rect: { x: 0, y: 59, width: 60, height: 48 } })] })).warn, []);
  const high = (y) => page({ interactive: [control({ rect: { x: 0, y, width: 60, height: 48 } })] });
  assert.deepEqual(decide(high(30), { device: android }).warn, [], "android needs only 24px");
  assert.deepEqual(codes(decide(high(20), { device: android }).warn), ["safe-area"]);
  const bar = (bottom, extra = {}, height = 844) => page({ doc: { ...page().doc, clientHeight: height, innerHeight: height }, interactive: [control({ rect: { x: 0, y: bottom - 48, width: 100, height: 48 }, inFixed: true, ...extra })] });
  assert.deepEqual(decide(bar(810)).warn, [], "ends exactly 34px above the edge");
  assert.deepEqual(codes(decide(bar(811)).warn), ["safe-area"]);
  assert.deepEqual(decide(bar(811, { inFixed: false })).warn, [], "not in a bar");
  assert.deepEqual(decide(bar(891, {}, 915), { device: android }).warn, [], "android keeps 24px");
  assert.deepEqual(codes(decide(bar(892, {}, 915), { device: android }).warn), ["safe-area"]);
});

test("WARN primary: two or more filled primaries in the first screen", () => {
  const primary = (label) => ({ text: label, rect: { x: 0, y: 0, width: 100, height: 48 }, rgba: { r: 11, g: 122, b: 117, a: 1 } });
  assert.deepEqual(decide(page({ primaries: [primary("A")] })).warn, []);
  const result = decide(page({ primaries: [primary("A"), primary("B")] }));
  assert.deepEqual(codes(result.warn), ["primary"]);
  assert.match(result.warn[0].message, /"A", "B"/);
});

test("WARN token-color: one line per distinct colour, tolerance of 3, DESIGN.md needed", () => {
  const entries = [
    { prop: "background", rgba: { r: 123, g: 97, b: 255, a: 1 }, count: 3, examples: ["span.badge: NEW"] },
    { prop: "color", rgba: { r: 123, g: 97, b: 255, a: 1 }, count: 1, examples: ["span.badge: NEW"] },
    { prop: "color", rgba: { r: 12, g: 123, b: 116, a: 1 }, count: 5, examples: ["p: near the primary"] },
    { prop: "background", rgba: { r: 0, g: 0, b: 0, a: 0 }, count: 9, examples: [] },
    { prop: "background", rgba: { r: 123, g: 97, b: 255, a: 0.1 }, count: 2, examples: ["div.tint"] },
  ];
  const data = page({ colors: entries });
  const result = decide(data, { designMd: DESIGN });
  assert.deepEqual(codes(result.warn), ["token-color", "token-color"]);
  assert.match(result.warn[0].message, /^#7b61ff background x3, color x1 \(span\.badge: NEW\)/);
  assert.match(result.warn[1].message, /^#7b61ff@0\.1 background x2/);
  assert.deepEqual(decide(data).warn, [], "no DESIGN.md, no token checks");
});

test("WARN token-font: every family must be in DESIGN.md except icon fonts", () => {
  const data = page({ texts: [text({ family: "Comic Sans MS", tag: "h1", text: "Hi" }), text({ family: "noto sans jp" }), text({ family: "Material Symbols Outlined", text: "home", fontSize: 24 }), text({ family: "Comic Sans MS" })] });
  const result = decide(data, { designMd: DESIGN });
  assert.deepEqual(codes(result.warn), ["token-font"]);
  assert.match(result.warn[0].message, /"Comic Sans MS" x2/);
});

test("WARN token-size: within 0.5px of a DESIGN.md size, icon fonts skipped", () => {
  const sized = (fontSize, extra = {}) => decide(page({ texts: [text({ fontSize, ...extra })] }), { designMd: DESIGN });
  assert.deepEqual(sized(15).warn, []);
  assert.deepEqual(sized(15.4).warn, []);
  assert.deepEqual(sized(11).warn, []);
  assert.deepEqual(codes(sized(19).warn), ["token-size"]);
  assert.deepEqual(codes(sized(15.6).warn), ["token-size"]);
  assert.deepEqual(sized(24, { family: "Material Icons" }).warn, [], "icon font skipped");
});

test("WARN token-radius: not 0, not full, within 0.5px of a DESIGN.md value", () => {
  const radius = (px, full = false) => decide(page({ radii: [{ px, full, count: 2, examples: ["div.card"] }] }), { designMd: DESIGN });
  assert.deepEqual(radius(12).warn, []);
  assert.deepEqual(radius(12.4).warn, []);
  assert.deepEqual(radius(0).warn, []);
  assert.deepEqual(radius(20, true).warn, [], "a full radius on a small element");
  assert.deepEqual(radius(9999, true).warn, []);
  assert.deepEqual(codes(radius(13).warn), ["token-radius"]);
});

test("WARN placeholder: English and Japanese patterns, and image sources", () => {
  const words = ["Lorem ipsum dolor", "John Doe", "jane doe", "Your Name", "mail@example.com", "ACME Corp", "ダミーテキスト", "テキストテキスト", "ここにテキスト", "ここにタイトル", "〇〇株式会社", "○○", "xxx", "Name XXXX"];
  for (const word of words) assert.deepEqual(codes(decide(page({ texts: [text({ text: word })] })).warn), ["placeholder"], word);
  for (const word of ["Johnson", "ここに来る", "〇", "xx", "acmeish", "example.community"]) {
    assert.deepEqual(codes(decide(page({ texts: [text({ text: word })] })).warn), [], word);
  }
  const images = ["https://placehold.co/100", "http://h/placeholder.png", "https://via.placeholder.com/9", "https://picsum.photos/200", "http://h/dummyimage/1"].map((src) => ({ src, complete: true, naturalWidth: 5 }));
  assert.equal(decide(page({ images })).warn.length, 5);
  assert.deepEqual(decide(page({ images: [{ src: "http://h/bread.png", complete: true, naturalWidth: 5 }] })).warn, []);
});

test("WARN emoji only in headings and controls, copyright signs excluded", () => {
  const found = (extra) => codes(decide(page({ texts: [text(extra)] })).warn);
  assert.deepEqual(found({ kind: "heading", text: "🍞 今日のパン" }), ["emoji"]);
  assert.deepEqual(found({ kind: "control", text: "予約 ✅" }), ["emoji"]);
  assert.deepEqual(found({ kind: "text", text: "おいしい 😀" }), []);
  assert.deepEqual(found({ kind: "heading", text: "© 2026 麦の香 ® ™" }), []);
  assert.deepEqual(found({ kind: "heading", text: "今日のパン 1" }), []);
});

test("info: origins other than the local server, colours, fonts, sizes, radii", () => {
  const result = decide(page({
    texts: [text(), text({ family: "Inter", fontSize: 13 })],
    colors: [{ prop: "color", rgba: { r: 31, g: 31, b: 31, a: 1 }, count: 3, examples: [] }, { prop: "background", rgba: { r: 31, g: 31, b: 31, a: 1 }, count: 2, examples: [] }],
    radii: [{ px: 0, full: false, count: 5, examples: [] }, { px: 12, full: false, count: 2, examples: [] }, { px: 9999, full: true, count: 1, examples: [] }],
  }), { diag: diagnostics({ requests: ["http://127.0.0.1:5000/a.css", "https://fonts.googleapis.com/css", "https://fonts.googleapis.com/x", "data:image/png;base64,AA", "http://127.0.0.1:9/x.css", "blob:abc"] }) });
  assert.deepEqual(result.info.origins, ["http://127.0.0.1:9", "https://fonts.googleapis.com"]);
  assert.deepEqual(result.info.colors, [{ color: "#1f1f1f", count: 5 }]);
  assert.deepEqual(result.info.fonts.map((entry) => entry.name).sort(), ["Inter", "Noto Sans JP"]);
  assert.deepEqual(result.info.fontSizes, [{ px: 13, count: 1 }, { px: 15, count: 1 }]);
  assert.deepEqual(result.info.radii, [{ px: 12, full: false, count: 2 }, { px: 9999, full: true, count: 1 }]);
  const lines = infoLines(result.info);
  assert.match(lines[0], /^info origins: http:\/\/127\.0\.0\.1:9, https:\/\/fonts\.googleapis\.com$/);
  assert.ok(lines.some((line) => /^info colors: #1f1f1f x5$/.test(line)));
  assert.ok(lines.some((line) => /^info radii: 12px x2, full x1$/.test(line)));
});

test("cross-screen info appears only when fonts or colours differ", () => {
  const info = (fonts, colors) => ({ fonts: fonts.map((name) => ({ name, count: 1 })), colors: colors.map((color) => ({ color, count: 1 })) });
  assert.equal(crossScreenLine([{ id: "a", info: info(["X"], ["#000000"]) }]), null);
  assert.equal(crossScreenLine([{ id: "a", info: info(["X"], ["#000000"]) }, { id: "b", info: info(["X"], ["#000000"]) }]), null);
  const line = crossScreenLine([{ id: "a", info: info(["X"], ["#000000"]) }, { id: "b", info: info(["X", "Y"], ["#000000", "#ff0000"]) }]);
  assert.match(line, /^info cross-screen: fonts differ \(Y only on b\); colors differ \(#ff0000 only on b\)$/);
});
