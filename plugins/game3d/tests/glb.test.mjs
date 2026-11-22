import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditGlb, checkBudget, parseAuditArguments, parseGlb, resolveBudget } from "../skills/game3d/scripts/lib/glb.mjs";
import { imageSize } from "../skills/game3d/scripts/lib/images.mjs";

const script = fileURLToPath(new URL("../skills/game3d/scripts/glb-audit.mjs", import.meta.url));

function pad(buffer, fill) {
  return Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
}

function buildGlb(json, bin = null) {
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const chunks = [chunk(jsonChunk, 0x4e4f534a)];
  if (bin) chunks.push(chunk(pad(bin, 0), 0x004e4942));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

function chunk(data, type) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(data.length, 0);
  header.writeUInt32LE(type, 4);
  return Buffer.concat([header, data]);
}

function audit(json, bin = null, options = {}) {
  const buffer = buildGlb(json, bin);
  return auditGlb(parseGlb(buffer), { fileBytes: buffer.length, ...options });
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function png(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, u32(13), Buffer.from("IHDR"), u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0]), u32(0)]);
}

function jpeg(width, height, frameMarker = 0xc0) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(9)]);
  const dht = Buffer.concat([Buffer.from([0xff, 0xc4, 0x00, 0x05]), Buffer.from([1, 2, 3])]);
  const frame = Buffer.alloc(19);
  frame.set([0xff, frameMarker, 0x00, 0x11, 8], 0);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame.set([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, frame, Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}

function riff(fourcc, payload) {
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(fourcc, 0, "latin1");
  chunkHeader.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP"), chunkHeader, payload]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function webpLossy(width, height) {
  const payload = Buffer.alloc(10);
  payload.set([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a], 0);
  payload.writeUInt16LE(width | 0x4000, 6);
  payload.writeUInt16LE(height | 0x8000, 8);
  return riff("VP8 ", payload);
}

function webpLossless(width, height) {
  const payload = Buffer.alloc(9);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return riff("VP8L", payload);
}

function webpExtended(width, height) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", payload);
}

function ktx2(width, height) {
  const header = Buffer.alloc(80);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32LE(width, 20);
  header.writeUInt32LE(height, 24);
  return header;
}

function triangleBin() {
  return Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
}

function baseJson(extra) {
  return { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: 36 }], ...extra };
}

const triangleAccessors = [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }];
const triangleViews = [{ buffer: 0, byteOffset: 0, byteLength: 36 }];

test("one triangle: triangles, draw calls and counts", () => {
  const json = baseJson({ meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: triangleAccessors, bufferViews: triangleViews });
  const metrics = audit(json, triangleBin());
  assert.equal(metrics.triangles, 1);
  assert.equal(metrics.uniqueTriangles, 1);
  assert.equal(metrics.drawCalls, 1);
  assert.equal(metrics.meshes, 1);
  assert.equal(metrics.nodes, 1);
  assert.equal(metrics.materials, 0);
  assert.deepEqual(metrics.textures, []);
  assert.equal(metrics.maxTextureSize, 0);
  assert.equal(metrics.fileBytes, buildGlb(json, triangleBin()).length);
  assert.deepEqual(metrics.missingUVs, []);
});

test("an indexed quad used by three nodes counts instances for triangles and draw calls only", () => {
  const json = baseJson({
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ mesh: 0 }, { mesh: 0 }, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { componentType: 5126, count: 4, type: "VEC3" },
      { componentType: 5123, count: 6, type: "SCALAR" },
    ],
  });
  const metrics = audit(json);
  assert.equal(metrics.triangles, 6);
  assert.equal(metrics.uniqueTriangles, 2);
  assert.equal(metrics.drawCalls, 3);
});

test("EXT_mesh_gpu_instancing multiplies triangles by the first attribute count but not draw calls", () => {
  const json = baseJson({
    nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1 } } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3" },
      { componentType: 5126, count: 10, type: "VEC3" },
    ],
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
    extensionsRequired: ["EXT_mesh_gpu_instancing"],
  });
  const metrics = audit(json);
  assert.equal(metrics.triangles, 10);
  assert.equal(metrics.uniqueTriangles, 1);
  assert.equal(metrics.drawCalls, 1);
  assert.deepEqual(metrics.extensionsUsed, ["EXT_mesh_gpu_instancing"]);
  assert.deepEqual(metrics.extensionsRequired, ["EXT_mesh_gpu_instancing"]);
});

test("primitive modes: strips and fans give count - 2, points and lines give none", () => {
  const modes = (mode) => audit(baseJson({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode }] }], accessors: [{ componentType: 5126, count: 5, type: "VEC3" }] })).triangles;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(modes), [0, 0, 0, 0, 1, 3, 3]);
});

test("the walk follows the default scene through children and falls back to every root node", () => {
  const meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }];
  const accessors = [{ componentType: 5126, count: 3, type: "VEC3" }];
  const nested = audit({ asset: { version: "2.0" }, scenes: [{ nodes: [0] }, { nodes: [3] }], scene: 0, nodes: [{ children: [1, 2] }, { mesh: 0 }, { mesh: 0 }, { mesh: 0 }], meshes, accessors });
  assert.equal(nested.triangles, 2);
  const second = audit({ asset: { version: "2.0" }, scenes: [{ nodes: [0] }, { nodes: [3] }], scene: 1, nodes: [{ children: [1, 2] }, { mesh: 0 }, { mesh: 0 }, { mesh: 0 }], meshes, accessors });
  assert.equal(second.triangles, 1);
  const noScenes = audit({ asset: { version: "2.0" }, nodes: [{ children: [1] }, { mesh: 0 }, { mesh: 0 }], meshes, accessors });
  assert.equal(noScenes.triangles, 2);
  assert.equal(noScenes.drawCalls, 2);
});

test("a base colour texture without TEXCOORD_0 is a missing UV and fails the default budget", () => {
  const json = baseJson({
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: triangleAccessors,
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: `data:image/png;base64,${png(4, 4).toString("base64")}` }],
  });
  const metrics = audit(json);
  assert.deepEqual(metrics.missingUVs, [{ mesh: 0, primitive: 0, material: 0, slot: "baseColor", texCoord: 0 }]);
  const strict = checkBudget(metrics, resolveBudget(null, "a.glb"));
  assert.equal(strict.fail.length, 1);
  assert.match(strict.fail[0], /^missing UVs/);
  assert.deepEqual(checkBudget(metrics, resolveBudget({ requireUVs: false }, "a.glb")).fail, []);
});

test("missing UVs honour texCoord n and report each mesh primitive once, however many nodes use it", () => {
  const json = baseJson({
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3" },
      { componentType: 5126, count: 3, type: "VEC2" },
    ],
    materials: [{ normalTexture: { index: 0, texCoord: 1 }, emissiveTexture: { index: 0 }, pbrMetallicRoughness: {} }],
    textures: [{ source: 0 }],
    images: [{ uri: "missing.png" }],
  });
  assert.deepEqual(audit(json).missingUVs, [{ mesh: 0, primitive: 0, material: 0, slot: "normal", texCoord: 1 }]);
});

test("embedded PNG sizes, power-of-two checks, texture bytes and material slots", () => {
  const big = png(2048, 1024);
  const odd = png(300, 200);
  const bin = Buffer.concat([pad(big, 0), pad(odd, 0)]);
  const json = baseJson({
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3" },
      { componentType: 5126, count: 3, type: "VEC2" },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: big.length },
      { buffer: 0, byteOffset: pad(big, 0).length, byteLength: odd.length },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } }],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { name: "albedo", bufferView: 0, mimeType: "image/png" },
      { name: "normal", bufferView: 1, mimeType: "image/png" },
    ],
  });
  const metrics = audit(json, bin);
  assert.equal(metrics.maxTextureSize, 2048);
  assert.equal(metrics.textureBytes, big.length + odd.length);
  assert.deepEqual(
    metrics.textures.map(({ index, name, mimeType, width, height, bytes, slots }) => ({ index, name, mimeType, width, height, bytes, slots })),
    [
      { index: 0, name: "albedo", mimeType: "image/png", width: 2048, height: 1024, bytes: big.length, slots: ["baseColor"] },
      { index: 1, name: "normal", mimeType: "image/png", width: 300, height: 200, bytes: odd.length, slots: ["normal"] },
    ],
  );
  assert.deepEqual(metrics.nonPowerOfTwo, [{ index: 1, name: "normal", width: 300, height: 200 }]);
  assert.deepEqual(metrics.missingUVs, []);

  const lenient = checkBudget(metrics, resolveBudget({}, "a.glb"));
  assert.deepEqual(lenient.fail, []);
  assert.equal(lenient.warn.length, 1);
  assert.match(lenient.warn[0], /non-power-of-two.*300x200/);
  const strict = checkBudget(metrics, resolveBudget({ requirePowerOfTwo: true, maxTextureSize: 1024, maxTextureBytes: 10 }, "a.glb"));
  assert.deepEqual(strict.fail.map((line) => line.split(" ")[0]), ["maxTextureSize", "textureBytes", "non-power-of-two"]);
  assert.ok(strict.fail.includes("maxTextureSize 2048 > 1024"));
});

test("KHR_texture_basisu sources resolve to the KTX2 image and unreadable images only warn", () => {
  const ktx = ktx2(512, 256);
  const json = baseJson({
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3" },
      { componentType: 5126, count: 3, type: "VEC2" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: ktx.length }],
    buffers: [{ byteLength: ktx.length }],
    materials: [{ emissiveTexture: { index: 0 }, occlusionTexture: { index: 1 } }],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }, { source: 1 }],
    images: [{ bufferView: 0, mimeType: "image/ktx2" }, { name: "mystery", uri: "https://example.test/mystery.png" }],
  });
  const metrics = audit(json, ktx);
  assert.equal(metrics.textures[0].width, 512);
  assert.deepEqual(metrics.textures[0].slots, ["emissive"]);
  assert.deepEqual(metrics.textures[1].slots, ["occlusion"]);
  assert.equal(metrics.textures[1].width, null);
  assert.deepEqual(metrics.unreadableImages, [{ index: 1, name: "mystery" }]);
  const result = checkBudget(metrics, resolveBudget(null, "a.glb"));
  assert.deepEqual(result.fail, []);
  assert.match(result.warn[0], /image 1 "mystery"/);
});

test("images next to the GLB are read from disk when the URI is relative", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-glb-"));
  try {
    fs.writeFileSync(path.join(dir, "my tex.png"), pad(png(64, 32), 0));
    const json = baseJson({
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: triangleAccessors,
      textures: [{ source: 0 }],
      images: [{ uri: "my%20tex.png" }],
    });
    const metrics = audit(json, null, { dir });
    assert.equal(metrics.textures[0].width, 64);
    assert.equal(metrics.textures[0].height, 32);
    assert.equal(metrics.textures[0].bytes, pad(png(64, 32), 0).length);
    assert.equal(metrics.textures[0].mimeType, "image/png");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("imageSize reads PNG, JPEG, WebP and KTX2 headers with width and height the right way round", () => {
  assert.deepEqual(imageSize(png(2048, 1024)), { format: "png", width: 2048, height: 1024 });
  assert.deepEqual(imageSize(png(300, 200)), { format: "png", width: 300, height: 200 });
  assert.deepEqual(imageSize(jpeg(640, 480)), { format: "jpeg", width: 640, height: 480 });
  assert.deepEqual(imageSize(jpeg(1000, 333, 0xc2)), { format: "jpeg", width: 1000, height: 333 });
  assert.deepEqual(imageSize(webpLossy(320, 200)), { format: "webp", width: 320, height: 200 });
  assert.deepEqual(imageSize(webpLossless(128, 64)), { format: "webp", width: 128, height: 64 });
  assert.deepEqual(imageSize(webpExtended(1000, 500)), { format: "webp", width: 1000, height: 500 });
  assert.deepEqual(imageSize(ktx2(512, 256)), { format: "ktx2", width: 512, height: 256 });
  assert.deepEqual(imageSize(new Uint8Array(png(8, 4))), { format: "png", width: 8, height: 4 });
});

test("imageSize returns null for unknown, truncated or empty data", () => {
  assert.equal(imageSize(crypto.randomBytes(64)), null);
  assert.equal(imageSize(Buffer.alloc(0)), null);
  assert.equal(imageSize(png(4, 4).subarray(0, 20)), null);
  assert.equal(imageSize(jpeg(10, 10).subarray(0, 30)), null);
  assert.equal(imageSize(webpLossy(10, 10).subarray(0, 24)), null);
  assert.equal(imageSize(ktx2(4, 4).subarray(0, 24)), null);
  assert.equal(imageSize("not a buffer"), null);
});

test("parseGlb rejects files that are not valid GLB 2.0 with a reason", () => {
  const valid = buildGlb(baseJson({}));
  assert.deepEqual(parseGlb(valid).json.asset, { version: "2.0" });
  assert.equal(parseGlb(valid).bin, null);

  const mutate = (change) => {
    const copy = Buffer.from(valid);
    change(copy);
    return copy;
  };
  assert.throws(() => parseGlb(crypto.randomBytes(64)), /not a GLB/);
  assert.throws(() => parseGlb(Buffer.alloc(5)), /not a GLB/);
  assert.throws(() => parseGlb(mutate((copy) => copy.writeUInt32LE(1, 4))), /version 1/);
  assert.throws(() => parseGlb(mutate((copy) => copy.writeUInt32LE(copy.length + 4, 8))), /does not match the file size/);
  assert.throws(() => parseGlb(valid.subarray(0, valid.length - 4)), /does not match the file size/);
  const truncated = mutate((copy) => copy.writeUInt32LE(copy.readUInt32LE(12) + 400, 12));
  assert.throws(() => parseGlb(truncated), /truncated/);
  assert.throws(() => parseGlb(mutate((copy) => copy.write("{{{{", 20, "latin1"))), /not valid JSON/);
  assert.throws(() => parseGlb(mutate((copy) => copy.writeUInt32LE(0x004e4942, 16))), /no JSON chunk/);
  const trailing = Buffer.concat([valid, Buffer.alloc(3)]);
  trailing.writeUInt32LE(trailing.length, 8);
  assert.throws(() => parseGlb(trailing), /truncated/);
});

test("parseGlb pads the JSON with spaces and the BIN chunk with zeros and returns the BIN data", () => {
  const parsed = parseGlb(buildGlb(baseJson({}), Buffer.from([1, 2, 3])));
  assert.deepEqual([...parsed.bin], [1, 2, 3, 0]);
});

test("budget files: flat, default plus per-file overrides, and typed values", () => {
  assert.deepEqual(resolveBudget({ maxTriangles: 5 }, "a.glb"), { requireUVs: true, requirePowerOfTwo: false, maxTriangles: 5 });
  const nested = { default: { maxTriangles: 100, requireUVs: false }, files: { "big.glb": { maxTriangles: 1000 }, "other.glb": { maxTriangles: 1 } } };
  assert.equal(resolveBudget(nested, "big.glb").maxTriangles, 1000);
  assert.equal(resolveBudget(nested, "big.glb").requireUVs, false);
  assert.equal(resolveBudget(nested, "small.glb").maxTriangles, 100);
  assert.equal(resolveBudget({ maxTriangles: 5, futureKey: "ignored" }, "a.glb").maxTriangles, 5);
  assert.throws(() => resolveBudget({ maxTriangles: "many" }, "a.glb"), /maxTriangles/);
  assert.throws(() => resolveBudget({ requireUVs: "yes" }, "a.glb"), /requireUVs/);
  assert.throws(() => resolveBudget([], "a.glb"), /JSON object/);
});

test("checkBudget reports one FAIL per exceeded limit, in metric terms", () => {
  const json = baseJson({
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: triangleAccessors,
    materials: [{}, {}],
  });
  const metrics = audit(json);
  const result = checkBudget(metrics, resolveBudget({ maxTriangles: 1, maxDrawCalls: 1, maxMaterials: 1, maxFileBytes: 10, maxTextureBytes: 0 }, "a.glb"));
  assert.deepEqual(result.fail, [`fileBytes ${metrics.fileBytes} > 10`, "triangles 2 > 1", "drawCalls 2 > 1", "materials 2 > 1"]);
  assert.deepEqual(checkBudget(metrics, resolveBudget({ maxTriangles: 2 }, "a.glb")).fail, []);
});

test("audit argument parsing", () => {
  assert.deepEqual(parseAuditArguments(["a.glb", "b.glb", "--budget", "b.json", "--json"]), { files: ["a.glb", "b.glb"], budget: "b.json", json: true });
  for (const invalid of [[], ["--json"], ["a.glb", "--budget"], ["a.glb", "--bad"]]) assert.throws(() => parseAuditArguments(invalid));
});

function withTemp(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-audit-"));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

const triangleGlb = () => buildGlb(baseJson({ meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: triangleAccessors, bufferViews: triangleViews }), triangleBin());

test("glb-audit.mjs prints metrics and exits 0 when the budget holds", () => {
  withTemp((dir) => {
    const file = path.join(dir, "tri.glb");
    fs.writeFileSync(file, triangleGlb());
    fs.writeFileSync(path.join(dir, "budget.json"), JSON.stringify({ maxTriangles: 10 }));
    const result = runCli([file, "--budget", path.join(dir, "budget.json")]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS .*tri\.glb/);
    assert.match(result.stdout, /triangles\s+1\n/);
    assert.match(result.stdout, /drawCalls\s+1\n/);
  });
});

test("glb-audit.mjs exits 1 when a budget check fails", () => {
  withTemp((dir) => {
    const file = path.join(dir, "tri.glb");
    fs.writeFileSync(file, triangleGlb());
    fs.writeFileSync(path.join(dir, "budget.json"), JSON.stringify({ default: { maxTriangles: 100 }, files: { "tri.glb": { maxTriangles: 0 } } }));
    const result = runCli([file, "--budget", path.join(dir, "budget.json")]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^FAIL triangles 1 > 0$/m);
    assert.match(result.stdout, /^FAIL .*tri\.glb$/m);
  });
});

test("glb-audit.mjs --json prints only the array on stdout", () => {
  withTemp((dir) => {
    const good = path.join(dir, "tri.glb");
    fs.writeFileSync(good, triangleGlb());
    const result = runCli([good, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].metrics.triangles, 1);
    assert.deepEqual(parsed[0].fail, []);
    assert.deepEqual(parsed[0].warn, []);

    const bad = path.join(dir, "bad.glb");
    fs.writeFileSync(bad, crypto.randomBytes(128));
    const mixed = runCli([good, bad, "--json"]);
    assert.equal(mixed.status, 2);
    assert.equal(JSON.parse(mixed.stdout).length, 2);
    assert.match(mixed.stderr, /bad\.glb: not a GLB/);
  });
});

test("glb-audit.mjs exits 2 with a reason for random bytes, a missing file and a bad budget", () => {
  withTemp((dir) => {
    const bad = path.join(dir, "random.glb");
    fs.writeFileSync(bad, crypto.randomBytes(256));
    const result = runCli([bad]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /glb-audit: .*random\.glb: not a GLB/);

    assert.equal(runCli([path.join(dir, "missing.glb")]).status, 2);

    const good = path.join(dir, "tri.glb");
    fs.writeFileSync(good, triangleGlb());
    fs.writeFileSync(path.join(dir, "budget.json"), "{ nope");
    assert.equal(runCli([good, "--budget", path.join(dir, "budget.json")]).status, 2);
    assert.equal(runCli([]).status, 2);
  });
});
