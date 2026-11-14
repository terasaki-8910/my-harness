import assert from "node:assert/strict";
import test from "node:test";
import { buildConcat } from "../skills/demo-video/scripts/lib/frames.mjs";

function durations(text) {
  return [...text.matchAll(/^duration ([\d.]+)$/gm)].map((match) => Number(match[1]));
}

test("concat uses latest pre-start frame, drops frames after end and sums durations", () => {
  const text = buildConcat([{ file: "old.jpg", ts: 8 }, { file: "start.jpg", ts: 9.5 }, { file: "a.jpg", ts: 10.5 }, { file: "b.jpg", ts: 11.5 }, { file: "late.jpg", ts: 13 }], { start: 10, duration: 2 });
  assert.match(text, /^ffconcat version 1\.0\nfile 'start\.jpg'/);
  assert.doesNotMatch(text, /old|late/);
  assert.equal(durations(text).reduce((sum, value) => sum + value, 0), 2);
  const files = text.match(/^file .+$/gm);
  assert.equal(files.at(-1), files.at(-2));
});

test("concat uses first frame when there is no pre-start frame and quotes names", () => {
  const text = buildConcat([{ file: "it's one.jpg", ts: 11 }, { file: "same.jpg", ts: 11 }, { file: "next.jpg", ts: 12 }], { start: 10, duration: 3 });
  assert.match(text, /file 'it'\\''s one\.jpg'/);
  assert.equal((text.match(/^duration /gm) ?? []).length, 2);
  assert.equal(durations(text).reduce((sum, value) => sum + value, 0), 3);
});
