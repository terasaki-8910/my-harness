import assert from "node:assert/strict";
import test from "node:test";
import { composite, contrastRatio, describeColor, parseColor, relativeLuminance, rgbToHsl, sameRgb, toHex } from "../skills/app-ui/scripts/lib/color.mjs";

test("parseColor reads hex in every length", () => {
  assert.deepEqual(parseColor("#7b61ff"), { r: 123, g: 97, b: 255, a: 1 });
  assert.deepEqual(parseColor("#FFF"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#f008"), { r: 255, g: 0, b: 0, a: 0.533 });
  assert.deepEqual(parseColor("#7B61FF1A"), { r: 123, g: 97, b: 255, a: 0.102 });
});

test("parseColor keeps RGB exact at low alpha", () => {
  assert.deepEqual(parseColor("rgba(123, 97, 255, 0.1)"), { r: 123, g: 97, b: 255, a: 0.1 });
  assert.deepEqual(parseColor("rgb(123 97 255 / 10%)"), { r: 123, g: 97, b: 255, a: 0.1 });
  assert.deepEqual(parseColor("color(srgb 0.482 0.38 1 / 0.1)"), { r: 123, g: 97, b: 255, a: 0.1 });
  assert.deepEqual(parseColor("rgb(100%, 0%, 50%)"), { r: 255, g: 0, b: 128, a: 1 });
});

test("parseColor returns null for syntaxes the page must resolve", () => {
  for (const value of ["oklch(0.6 0.2 300)", "color-mix(in srgb, red 10%, white)", "hsl(10 50% 50%)", "red", "rgb(1 2)", "#12", "", null]) {
    assert.equal(parseColor(value), null, String(value));
  }
  assert.deepEqual(parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
});

test("toHex and describeColor", () => {
  assert.equal(toHex({ r: 11, g: 122, b: 117 }), "#0b7a75");
  assert.equal(describeColor({ r: 11, g: 122, b: 117, a: 1 }), "#0b7a75");
  assert.equal(describeColor({ r: 255, g: 0, b: 0, a: 0.5 }), "#ff0000@0.5");
});

test("contrast ratio matches known WCAG values", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.equal(contrastRatio(black, white).toFixed(2), "21.00");
  assert.equal(contrastRatio(white, white), 1);
  assert.equal(contrastRatio({ r: 0x9e, g: 0x9e, b: 0x9e }, white).toFixed(2), "2.68");
  assert.ok(contrastRatio({ r: 0x0b, g: 0x7a, b: 0x75 }, white) >= 4.5);
  assert.ok(relativeLuminance(white) > relativeLuminance(black));
});

test("composite blends source-over", () => {
  assert.deepEqual(composite({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 }), { r: 255, g: 127.5, b: 127.5, a: 1 });
  assert.deepEqual(composite({ r: 10, g: 20, b: 30, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }), { r: 10, g: 20, b: 30, a: 1 });
  assert.equal(composite({ r: 1, g: 2, b: 3, a: 0 }, { r: 9, g: 9, b: 9, a: 0 }).a, 0);
});

test("rgbToHsl gives saturation and lightness", () => {
  const teal = rgbToHsl({ r: 11, g: 122, b: 117 });
  assert.ok(teal.s > 0.8 && teal.l > 0.2 && teal.l < 0.3);
  assert.equal(rgbToHsl({ r: 128, g: 128, b: 128 }).s, 0);
  assert.equal(Math.round(rgbToHsl({ r: 255, g: 0, b: 0 }).h), 0);
});

test("sameRgb tolerates three levels per channel and ignores alpha", () => {
  assert.equal(sameRgb({ r: 10, g: 10, b: 10, a: 1 }, { r: 13, g: 7, b: 10, a: 0.2 }), true);
  assert.equal(sameRgb({ r: 10, g: 10, b: 10 }, { r: 14, g: 10, b: 10 }), false);
});
