import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { entryCovers, normalizeManifest, parseAssetArguments } from "../skills/game3d/scripts/lib/assets.mjs";

const script = fileURLToPath(new URL("../skills/game3d/scripts/asset-audit.mjs", import.meta.url));

function baseManifest(overrides = {}) {
  return {
    schema: "game3d/assets@1",
    roots: ["public/assets"],
    ignore: [],
    allowLicenses: ["CC0-1.0", "CC-BY-4.0", "MIT", "own"],
    assets: [{ path: "public/assets/gate.glb", license: "own", source: "art/blender/gen_gate.py", author: "me", tool: "Blender 4.4", attribution: "" }],
    ...overrides,
  };
}

// files: relative path -> content; manifest: object (written as JSON), a string (written as is) or null (no manifest).
function withProject({ files = { "public/assets/gate.glb": "glb", "art/blender/gen_gate.py": "py" }, manifest = baseManifest(), manifestPath = "assets/manifest.json" }, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-assets-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    if (manifest !== null) {
      fs.mkdirSync(path.dirname(path.join(dir, manifestPath)), { recursive: true });
      fs.writeFileSync(path.join(dir, manifestPath), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function audit(dir, ...args) {
  return spawnSync(process.execPath, [script, dir, ...args], { encoding: "utf8" });
}

test("every file covered gives exit 0", () => {
  withProject({}, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^PASS /m);
    assert.doesNotMatch(result.stdout, /^FAIL/m);
  });
});

test("an uncovered file gives exit 1 and is named", () => {
  withProject({ files: { "public/assets/gate.glb": "x", "public/assets/stray.png": "x", "art/blender/gen_gate.py": "x" } }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL uncovered file public\/assets\/stray\.png/m);
  });
});

test("an ignored file and an ignored directory need no entry", () => {
  const files = { "public/assets/gate.glb": "x", "public/assets/README.md": "x", "public/assets/raw/a.psd": "x", "art/blender/gen_gate.py": "x" };
  withProject({ files, manifest: baseManifest({ ignore: ["public/assets/README.md", "public/assets/raw/"] }) }, (dir) => {
    assert.equal(audit(dir).status, 0);
  });
});

test("CC-BY-4.0 without attribution gives exit 1, with attribution exit 0", () => {
  const withLicense = (attribution) => baseManifest({ assets: [{ path: "public/assets/gate.glb", license: "CC-BY-4.0", source: "https://example.test/gate", attribution }] });
  withProject({ manifest: withLicense("") }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL public\/assets\/gate\.glb: license CC-BY-4\.0 needs an attribution/m);
  });
  withProject({ manifest: withLicense("Gate by Someone, CC BY 4.0") }, (dir) => {
    assert.equal(audit(dir).status, 0);
  });
});

test("a license outside allowLicenses gives exit 1", () => {
  withProject({ manifest: baseManifest({ assets: [{ path: "public/assets/gate.glb", license: "GPL-3.0", source: "somewhere" }] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL public\/assets\/gate\.glb: license "GPL-3\.0" is not in allowLicenses/m);
  });
  withProject({ manifest: baseManifest({ assets: [{ path: "public/assets/gate.glb", license: "", source: "somewhere" }] }) }, (dir) => {
    assert.equal(audit(dir).status, 1);
  });
});

test("an empty source gives exit 1", () => {
  withProject({ manifest: baseManifest({ assets: [{ path: "public/assets/gate.glb", license: "own", source: "  " }] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL public\/assets\/gate\.glb: source is empty/m);
  });
});

test("a directory entry covers nested files and a file entry covers only itself", () => {
  const files = { "public/assets/models/a.glb": "x", "public/assets/models/deep/b.glb": "x", "public/assets/models/deep/er/c.png": "x" };
  const manifest = baseManifest({ assets: [{ path: "public/assets/models/", license: "CC0-1.0", source: "https://example.test/pack" }] });
  withProject({ files, manifest }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /files\s+3\n/);
  });
  const partial = baseManifest({ assets: [{ path: "public/assets/models/a.glb", license: "CC0-1.0", source: "https://example.test/pack" }] });
  withProject({ files, manifest: partial }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /uncovered file public\/assets\/models\/deep\/b\.glb/);
  });
});

test("an exact entry that does not exist and a directory entry that covers nothing give exit 1", () => {
  const entry = (entryPath) => ({ path: entryPath, license: "own", source: "x" });
  const files = { "public/assets/gate.glb": "x" };
  withProject({ files, manifest: baseManifest({ assets: [entry("public/assets/gate.glb"), entry("public/assets/gone.glb")] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL asset entry public\/assets\/gone\.glb does not exist/m);
  });
  withProject({ files: { "public/assets/gate.glb": "x" }, manifest: baseManifest({ assets: [entry("public/assets/gate.glb"), entry("public/assets/nothing/")] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL asset entry public\/assets\/nothing\/ covers no file/m);
  });
  withProject({ files: { "public/assets/models/a.glb": "x" }, manifest: baseManifest({ assets: [entry("public/assets/models")] }) }, (dir) => {
    assert.match(audit(dir).stdout, /is a directory: end the path with "\/"/);
  });
});

test("paths compare case-sensitively even on case-insensitive file systems", () => {
  withProject({ files: { "public/assets/gate.glb": "x" }, manifest: baseManifest({ assets: [{ path: "public/assets/Gate.glb", license: "own", source: "x" }] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL uncovered file public\/assets\/gate\.glb/m);
    assert.match(result.stdout, /^FAIL asset entry public\/assets\/Gate\.glb does not exist/m);
  });
});

test("a file covered by two entries only warns", () => {
  const entry = (entryPath) => ({ path: entryPath, license: "own", source: "x" });
  const files = { "public/assets/gate.glb": "x", "art/blender/gen_gate.py": "x" };
  withProject({ files, manifest: baseManifest({ assets: [entry("public/assets/gate.glb"), entry("public/assets/")] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^WARN 1 file covered by more than one entry \(public\/assets\/gate\.glb, public\/assets\/\): public\/assets\/gate\.glb/m);
  });
});

test("a missing manifest, bad JSON, wrong schema or a missing root gives exit 2", () => {
  withProject({ manifest: null }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^asset-audit: cannot read manifest assets\/manifest\.json/);
  });
  withProject({ manifest: "{ not json" }, (dir) => assert.equal(audit(dir).status, 2));
  withProject({ manifest: baseManifest({ schema: "game3d/assets@2" }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /schema/);
  });
  withProject({ manifest: baseManifest({ roots: ["public/missing"] }) }, (dir) => {
    const result = audit(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /root "public\/missing" does not exist/);
  });
  withProject({ manifest: baseManifest({ roots: ["Public/assets"] }) }, (dir) => assert.equal(audit(dir).status, 2));
  withProject({ manifest: baseManifest({ assets: [{ path: "public\\assets\\gate.glb", license: "own", source: "x" }] }) }, (dir) => assert.equal(audit(dir).status, 2));
  assert.equal(spawnSync(process.execPath, [script, path.join(os.tmpdir(), "game3d-no-such-project")], { encoding: "utf8" }).status, 2);
});

test("--manifest picks another file and --json prints one object", () => {
  withProject({ manifestPath: "meta/other.json" }, (dir) => {
    assert.equal(audit(dir).status, 2);
    const result = audit(dir, "--manifest", "meta/other.json", "--json");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.files, 1);
    assert.equal(parsed.entries, 1);
    assert.deepEqual(parsed.fail, []);
    assert.deepEqual(parsed.warn, []);
  });
  withProject({ files: { "public/assets/gate.glb": "x", "public/assets/stray.png": "x" } }, (dir) => {
    const result = audit(dir, "--json");
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).fail.length, 1);
  });
});

test("the project directory defaults to the current directory", () => {
  withProject({}, (dir) => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: dir });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test("manifest normalisation and argument parsing", () => {
  assert.equal(entryCovers("a/b/", "a/b/c/d.png"), true);
  assert.equal(entryCovers("a/b/", "a/bc/d.png"), false);
  assert.equal(entryCovers("a/b.png", "a/b.png"), true);
  assert.equal(entryCovers("a/b.png", "a/b.png.bak"), false);
  assert.deepEqual(normalizeManifest(baseManifest({ roots: ["./public/assets/"] })).roots, ["public/assets"]);
  assert.throws(() => normalizeManifest(baseManifest({ roots: ["../outside"] })), /inside the project/);
  assert.throws(() => normalizeManifest(baseManifest({ roots: ["/abs"] })), /relative/);
  assert.throws(() => normalizeManifest({ ...baseManifest(), allowLicenses: "MIT" }), /allowLicenses/);
  assert.deepEqual(parseAssetArguments([]), { project: ".", manifest: "assets/manifest.json", json: false });
  assert.deepEqual(parseAssetArguments(["game", "--manifest", "m.json", "--json"]), { project: "game", manifest: "m.json", json: true });
  for (const invalid of [["a", "b"], ["--bad"], ["--manifest"]]) assert.throws(() => parseAssetArguments(invalid));
});
