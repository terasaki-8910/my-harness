import assert from "node:assert/strict";
import test from "node:test";
import { auditExpression, isWebUrl } from "../skills/html-slides/scripts/lib/browser.mjs";

import {
  baselineDiff,
  collapseWhitespace,
  countCharacters,
  decideWidth,
  groupDuplicates,
  isAutomaticFaviconRequest,
  isInvisibleText,
  parseCheckArguments,
  parseShotsArguments,
  parseWidths,
  slideCounts,
  textOverflowWarnings,
  clippedTextWarnings,
} from "../skills/html-slides/scripts/lib/checks.mjs";

test("page audit source embeds selectors safely and remains valid JavaScript", () => {
  const source = auditExpression('section.slide[data-name="a\\b"]');
  assert.doesNotThrow(() => new Function(`return ${source};`));
  assert.equal(isWebUrl("https://example.test/deck"), true);
  assert.equal(isWebUrl("HTTP://example.test/deck"), true);
  assert.equal(isWebUrl("deck.html"), false);
  for (const field of ["hasDeclaredIcon", "colorAlphaZero", "ancestorOpacityZero", "visibilityHidden"]) assert.match(source, new RegExp(field));
});

test("viewport and check argument parsing resolves every option", () => {
  assert.deepEqual(parseWidths("1920x1080, 400X860"), [
    { width: 1920, height: 1080, label: "1920x1080" },
    { width: 400, height: 860, label: "400x860" },
  ]);
  assert.deepEqual(parseCheckArguments(["deck.html", "--widths", "800x600", "--slides", "main > section", "--report", "r.json", "--baseline", "b.json", "--dup-min", "20"]), {
    page: "deck.html",
    widths: [{ width: 800, height: 600, label: "800x600" }],
    slides: "main > section",
    report: "r.json",
    baseline: "b.json",
    dupMin: 20,
  });
  const defaults = parseCheckArguments(["deck.html"]);
  assert.equal(defaults.widths.length, 3);
  assert.equal(defaults.slides, "section.slide");
  assert.equal(defaults.dupMin, 12);
  for (const invalid of [[], ["deck.html", "--bad"], ["deck.html", "--widths"], ["deck.html", "--widths", "800"], ["deck.html", "--dup-min", "0"], ["a", "b"]]) {
    assert.throws(() => parseCheckArguments(invalid));
  }
});

test("shots argument parsing handles defaults, options, and errors", () => {
  assert.deepEqual(parseShotsArguments(["https://example.test/deck", "--widths", "400x860", "--slides", ".page", "--out", "review"]), {
    page: "https://example.test/deck",
    widths: [{ width: 400, height: 860, label: "400x860" }],
    slides: ".page",
    out: "review",
  });
  const defaults = parseShotsArguments(["deck.html"]);
  assert.equal(defaults.out, "slides-shots");
  assert.equal(defaults.slides, "section.slide");
  for (const invalid of [[], ["deck.html", "--out"], ["deck.html", "--out", ""], ["deck.html", "--slides", ""], ["deck.html", "--unknown", "x"]]) {
    assert.throws(() => parseShotsArguments(invalid));
  }
});

test("character counting collapses the intended whitespace", () => {
  assert.equal(collapseWhitespace("  one\n two\tthree  "), "one two three");
  assert.equal(countCharacters(" 一 二\n三 "), 3);
  assert.deepEqual(slideCounts([{ id: "a", text: "一 二" }, { id: "", text: "abc" }]), [
    { id: "a", chars: 2 },
    { id: "slide-2", chars: 3 },
  ]);
});

test("baseline diff reports additions, removals, and totals", () => {
  assert.deepEqual(baselineDiff(
    [{ id: "a", chars: 12 }, { id: "c", chars: 7 }],
    [{ id: "a", chars: 10 }, { id: "b", chars: 5 }],
  ), {
    slides: [
      { id: "a", before: 10, after: 12, difference: 2 },
      { id: "c", before: 0, after: 7, difference: 7 },
      { id: "b", before: 5, after: 0, difference: -5 },
    ],
    total: { before: 15, after: 19, difference: 4 },
  });
});

test("duplicates require the same normalized block on different slides", () => {
  const groups = groupDuplicates([
    { slideId: "a", text: "Repeated   sentence here" },
    { slideId: "a", text: "Repeated sentence here" },
    { slideId: "b", text: "Repeated\nsentence here" },
    { slideId: "b", text: "too short" },
    { slideId: "c", text: "too short" },
  ], 12);
  assert.deepEqual(groups, [{ text: "Repeated sentence here", ids: ["a", "b"] }]);
  assert.deepEqual(groupDuplicates([{ slideId: "a", text: "long enough text" }, { slideId: "a", text: "long enough text" }], 12), []);
});

const baseElement = {
  rendered: true,
  colorAlphaZero: false,
  ancestorOpacityZero: false,
  visibilityHidden: false,
  slideId: "intro",
  path: "section#intro > p",
  text: "A deliberately long text sample",
  textRects: [{ left: 10, right: 90 }],
  paddingBox: { left: 9, right: 91 },
  overflowX: "visible",
  overflowY: "visible",
  scrollWidth: 100,
  scrollHeight: 30,
  clientWidth: 100,
  clientHeight: 30,
};

test("automatic favicon failures are ignored only without a declared icon", () => {
  const favicon = "http://127.0.0.1:4321/favicon.ico";
  assert.equal(isAutomaticFaviconRequest(favicon, false), true);
  assert.equal(isAutomaticFaviconRequest(favicon, true), false);
  assert.equal(isAutomaticFaviconRequest("http://127.0.0.1:4321/assets/favicon.ico", false), false);
  assert.equal(isAutomaticFaviconRequest("not a URL", false), false);

  const withoutDeclaration = decideWidth({
    hasDeclaredIcon: false,
    failedRequests: [{ url: favicon, error: "net::ERR_FAILED" }],
    httpErrors: [{ url: favicon, status: 404 }],
    scrollWidth: 400,
    innerWidth: 400,
    slides: [{}],
  });
  assert.deepEqual(withoutDeclaration.fail, []);

  const declared = decideWidth({
    hasDeclaredIcon: true,
    failedRequests: [{ url: favicon, error: "net::ERR_FAILED" }],
    httpErrors: [{ url: favicon, status: 404 }],
    scrollWidth: 400,
    innerWidth: 400,
    slides: [{}],
  });
  assert.equal(declared.fail.length, 2);
});

test("invisible text is excluded from both warning decisions", () => {
  assert.equal(isInvisibleText(baseElement), false);
  for (const flag of ["colorAlphaZero", "ancestorOpacityZero", "visibilityHidden"]) {
    const element = {
      ...baseElement,
      [flag]: true,
      textRects: [{ left: 0, right: 200 }],
      overflowX: "hidden",
      scrollWidth: 200,
    };
    assert.equal(isInvisibleText(element), true, flag);
    assert.deepEqual(textOverflowWarnings([element]), [], flag);
    assert.deepEqual(clippedTextWarnings([element]), [], flag);
  }
});

test("direct text overflow is decided from padding-box geometry", () => {
  assert.deepEqual(textOverflowWarnings([baseElement]), []);
  assert.deepEqual(textOverflowWarnings([{ ...baseElement, textRects: [{ left: 7.9, right: 90 }] }]), [{
    kind: "text-overflow",
    slideId: "intro",
    path: "section#intro > p",
    text: "A deliberately long text sampl",
  }]);
  assert.deepEqual(textOverflowWarnings([{ ...baseElement, rendered: false, textRects: [{ left: 0, right: 200 }] }]), []);
});

test("clipped text requires clipping overflow and more than one pixel excess", () => {
  assert.deepEqual(clippedTextWarnings([{ ...baseElement, overflowX: "hidden", scrollWidth: 102 }]), [{
    kind: "clipped-text",
    slideId: "intro",
    path: "section#intro > p",
    text: "A deliberately long text sampl",
  }]);
  assert.deepEqual(clippedTextWarnings([{ ...baseElement, overflowY: "auto", scrollHeight: 31 }]), []);
  assert.deepEqual(clippedTextWarnings([{ ...baseElement, overflowY: "clip", scrollHeight: 32 }]).map((item) => item.kind), ["clipped-text"]);
  assert.deepEqual(clippedTextWarnings([{ ...baseElement, overflowX: "visible", scrollWidth: 1000 }]), []);
  assert.deepEqual(clippedTextWarnings([{ ...baseElement, rendered: false, overflowX: "hidden", scrollWidth: 1000 }]), []);
});

test("width decision covers every FAIL source and combines WARN decisions", () => {
  const result = decideWidth({
    consoleErrors: ["bad console"],
    pageErrors: ["uncaught"],
    failedRequests: [{ url: "asset.png", error: "blocked" }],
    httpErrors: [{ url: "missing.css", status: 404 }],
    images: [{ src: "broken.png", naturalWidth: 0 }, { src: "ok.png", naturalWidth: 10 }],
    scrollWidth: 401,
    innerWidth: 400,
    slides: [],
    elements: [{ ...baseElement, textRects: [{ left: 5, right: 90 }], overflowY: "hidden", scrollHeight: 40 }],
  });
  assert.equal(result.fail.length, 7);
  for (const evidence of ["console error", "page error", "failed request", "HTTP 404", "naturalWidth 0", "horizontal overflow", "no slide found"]) {
    assert.equal(result.fail.some((message) => message.includes(evidence)), true, evidence);
  }
  assert.deepEqual(result.warn.map((item) => item.kind), ["text-overflow", "clipped-text"]);
  assert.deepEqual(decideWidth({ scrollWidth: 400, innerWidth: 400, slides: [{}], images: [], elements: [] }), { fail: [], warn: [] });
});
