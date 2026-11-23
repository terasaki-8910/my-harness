import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bodySections, dimensionToPx, parseDesignMd, parseFrontMatter } from "../skills/app-ui/scripts/lib/designmd.mjs";

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const read = (relative) => fs.readFileSync(here(relative), "utf8");
const wrap = (front, body = "# T\n") => `---\n${front}\n---\n${body}`;

test("the template parses and lists the eight sections in order", () => {
  const design = parseDesignMd(read("../templates/DESIGN.md.tmpl"));
  assert.deepEqual(design.sections, ["Overview", "Colors", "Typography", "Layout", "Elevation & Depth", "Shapes", "Components", "Do's and Don'ts"]);
  assert.equal(design.name, "<App name>");
  assert.equal(design.colors.primary, "#4D4D4D");
  assert.equal(design.typography["label-lg"].fontSize, "15px");
  assert.equal(design.rounded.full, "9999px");
  assert.equal(design.spacing.md, "16px");
});

test("both fixture DESIGN.md files parse and resolve references", () => {
  for (const file of ["fixtures/clean/DESIGN.md", "fixtures/defects/DESIGN.md"]) {
    const design = parseDesignMd(read(file));
    assert.equal(design.colors.primary, "#0B7A75");
    assert.equal(design.components["button-primary"].backgroundColor, "#0B7A75");
    assert.equal(design.components["button-primary"].rounded, "12px");
    assert.deepEqual(design.components["button-primary"].typography, { fontFamily: "Noto Sans JP", fontSize: "15px", fontWeight: "600", lineHeight: "1.3" });
    assert.equal(design.sections.length, 8);
  }
  assert.equal(read("fixtures/clean/DESIGN.md"), read("fixtures/defects/DESIGN.md"));
});

test("quoted strings, comments and nested mappings", () => {
  const { tree } = parseFrontMatter(wrap([
    "# a comment line",
    "name: \"Say \\\"hi\\\" \\\\ # not a comment\"  # real comment",
    "single: 'it''s # fine'",
    "plain: value # trailing",
    "hash: a#b",
    "colors:",
    "  # indented comment",
    "  primary: \"#112233\"",
    "  nested:",
    "    deep: 1px",
    "  after: x",
    "empty:",
    "last: 1",
  ].join("\n")));
  assert.equal(tree.name, 'Say "hi" \\ # not a comment');
  assert.equal(tree.single, "it's # fine");
  assert.equal(tree.plain, "value");
  assert.equal(tree.hash, "a#b");
  assert.deepEqual(tree.colors, { primary: "#112233", nested: { deep: "1px" }, after: "x" });
  assert.deepEqual(tree.empty, {});
  assert.equal(tree.last, "1");
});

test("CRLF line endings and a byte order mark are accepted", () => {
  const text = `\uFEFF---\r\nname: x\r\ncolors:\r\n  a: "#fff"\r\n---\r\n## One\r\n`;
  const design = parseDesignMd(text);
  assert.equal(design.name, "x");
  assert.equal(design.colors.a, "#fff");
  assert.deepEqual(design.sections, ["One"]);
});

test("missing front matter is an error", () => {
  assert.throws(() => parseDesignMd("# no front matter\n"), /front matter/);
  assert.throws(() => parseDesignMd("---\nname: x\n"), /not closed/);
});

test("each unsupported construct throws with its line number", () => {
  const cases = [
    ["sequence", "name: x\ncolors:\n  - red", /line 4: sequences/],
    ["flow mapping", "name: x\ncolors: {a: b}", /line 3: flow collections/],
    ["flow sequence", "name: x\ncolors: [a, b]", /line 3: flow collections/],
    ["anchor", "name: x\ncolors: &a\n  p: 1", /line 3: anchors/],
    ["alias", "name: x\nother: *a", /line 3: aliases/],
    ["tag", "name: x\nother: !!str 1", /line 3: tags/],
    ["literal block", "name: x\ndesc: |\n  text", /line 3: block scalars \(\|\)/],
    ["folded block", "name: x\ndesc: >\n  text", /line 3: block scalars \(>\)/],
    ["tab indentation", "name: x\ncolors:\n\tp: 1", /line 4: tabs/],
    ["no colon", "name: x\njust text", /line 3: expected 'key: value'/],
    ["colon in plain value", "name: x\ndesc: who: what", /line 3: a plain value cannot contain/],
    ["unterminated quote", "name: x\ndesc: \"open", /line 3: unterminated/],
    ["text after quote", "name: x\ndesc: \"a\" b", /line 3: unexpected text/],
    ["bad escape", "name: x\ndesc: \"a\\n\"", /line 3: unsupported escape/],
    ["duplicate key", "name: x\nname: y", /line 3: duplicate key/],
    ["bad indentation", "name: x\ncolors:\n    a: 1\n  b: 2", /line 5: inconsistent indentation|line 5: unexpected indentation/],
    ["over-indented", "name: x\n  a: 1", /line 3: unexpected indentation/],
  ];
  for (const [label, front, pattern] of cases) {
    assert.throws(() => parseDesignMd(wrap(front)), pattern, label);
  }
});

test("references resolve through other references and fail when missing or looping", () => {
  const ok = parseDesignMd(wrap([
    "colors:", "  base: \"#102030\"", "  alias: \"{colors.base}\"",
    "rounded:", "  md: 12px",
    "typography:", "  body:", "    fontSize: 15px",
    "components:", "  card:", "    backgroundColor: \"{colors.alias}\"", "    rounded: \"{rounded.md}\"", "    typography: \"{typography.body}\"",
    "    border: \"1px solid {colors.base}\"",
  ].join("\n")));
  assert.equal(ok.components.card.backgroundColor, "#102030");
  assert.equal(ok.colors.alias, "#102030");
  assert.equal(ok.components.card.rounded, "12px");
  assert.deepEqual(ok.components.card.typography, { fontSize: "15px" });
  assert.equal(ok.components.card.border, "1px solid #102030");
  assert.throws(() => parseDesignMd(wrap("colors:\n  a: x\ncomponents:\n  c:\n    backgroundColor: \"{colors.nope}\"")), /line 6: components\.c\.backgroundColor refers to \{colors\.nope\}/);
  assert.throws(() => parseDesignMd(wrap("colors:\n  a: \"{colors.b}\"\n  b: \"{colors.a}\"\ncomponents:\n  c:\n    x: \"{colors.a}\"")), /nest deeper than 10/);
  const chain = ["colors:", ...Array.from({ length: 12 }, (_, index) => `  c${index}: "{colors.c${index + 1}}"`), "  c12: \"#ffffff\"", "components:", "  x:", "    y: \"{colors.c0}\""].join("\n");
  assert.throws(() => parseDesignMd(wrap(chain)), /nest deeper than 10/);
});

test("section headings skip code fences and deeper headings", () => {
  const body = "# Title\n\n## One\n\n### Not a section\n\n```\n## Fenced\n```\n\n## Two ##\n";
  assert.deepEqual(bodySections(wrap("name: x", body)), ["One", "Two"]);
});

test("dimensionToPx", () => {
  assert.equal(dimensionToPx("12px"), 12);
  assert.equal(dimensionToPx("1.5rem"), 24);
  assert.equal(dimensionToPx("2em"), 32);
  assert.equal(dimensionToPx("13"), 13);
  assert.equal(dimensionToPx("0.5px"), 0.5);
  assert.equal(dimensionToPx("9999px"), 9999);
  for (const value of ["50%", "1vw", "auto", "", "12 px", null, undefined]) assert.equal(dimensionToPx(value), null, String(value));
});
