import fs from "node:fs";
import path from "node:path";
import { imageSize, mimeTypeForFormat } from "./images.mjs";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export const MATERIAL_SLOTS = Object.freeze(["baseColor", "metallicRoughness", "normal", "occlusion", "emissive"]);

const BUDGET_LIMITS = Object.freeze({
  maxFileBytes: "fileBytes",
  maxTriangles: "triangles",
  maxDrawCalls: "drawCalls",
  maxMaterials: "materials",
  maxTextureSize: "maxTextureSize",
  maxTextureBytes: "textureBytes",
});
const BUDGET_FLAGS = Object.freeze({ requireUVs: true, requirePowerOfTwo: false });

export function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("not a GLB: input is not a buffer");
  if (buffer.length < 12) throw new Error(`not a GLB: ${buffer.length} bytes is shorter than the 12-byte header`);
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB: missing "glTF" magic');
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version} (need 2)`);
  const declared = buffer.readUInt32LE(8);
  if (declared !== buffer.length) throw new Error(`GLB header length ${declared} does not match the file size ${buffer.length}`);

  const chunks = [];
  let offset = 12;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error(`truncated GLB: chunk header at byte ${offset} is incomplete`);
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > buffer.length) throw new Error(`truncated GLB: chunk at byte ${offset} needs ${length} bytes but only ${buffer.length - start} remain`);
    chunks.push({ type, data: buffer.subarray(start, start + length) });
    offset = start + length;
  }
  if (chunks.length === 0 || chunks[0].type !== CHUNK_JSON) throw new Error("GLB has no JSON chunk as its first chunk");
  let json;
  try {
    json = JSON.parse(chunks[0].data.toString("utf8").replace(/[\s\0]+$/, ""));
  } catch (error) {
    throw new Error(`GLB JSON chunk is not valid JSON: ${error.message}`);
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("GLB JSON chunk is not an object");
  const bin = chunks.length > 1 && chunks[1].type === CHUNK_BIN ? chunks[1].data : null;
  return { json, bin };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function accessorCount(json, index, label) {
  const accessor = list(json.accessors)[index];
  if (!accessor || !Number.isSafeInteger(accessor.count)) throw new Error(`${label}: accessor ${index} is missing or has no count`);
  return accessor.count;
}

function primitiveTriangles(json, primitive, label) {
  const mode = primitive.mode ?? 4;
  if (mode < 4 || mode > 6) return 0;
  const position = primitive.attributes?.POSITION;
  let count;
  if (primitive.indices !== undefined) count = accessorCount(json, primitive.indices, label);
  else if (position !== undefined) count = accessorCount(json, position, label);
  else return 0;
  return mode === 4 ? Math.floor(count / 3) : Math.max(count - 2, 0);
}

function meshTriangleCounts(json) {
  return list(json.meshes).map((mesh, meshIndex) =>
    list(mesh.primitives).reduce((sum, primitive, primitiveIndex) => sum + primitiveTriangles(json, primitive, `mesh ${meshIndex} primitive ${primitiveIndex}`), 0),
  );
}

function sceneRoots(json) {
  const nodes = list(json.nodes);
  if (list(json.scenes).length > 0) {
    const index = json.scene ?? 0;
    const scene = json.scenes[index];
    if (!scene) throw new Error(`default scene ${index} does not exist`);
    return list(scene.nodes);
  }
  const children = new Set(nodes.flatMap((node) => list(node.children)));
  return nodes.map((_, index) => index).filter((index) => !children.has(index));
}

function instanceCount(json, node, nodeIndex) {
  const instancing = node.extensions?.EXT_mesh_gpu_instancing;
  if (!instancing) return 1;
  const first = Object.values(instancing.attributes ?? {})[0];
  if (first === undefined) return 1;
  return accessorCount(json, first, `node ${nodeIndex} EXT_mesh_gpu_instancing`);
}

function walkScene(json, triangleCounts) {
  const nodes = list(json.nodes);
  const totals = { triangles: 0, drawCalls: 0 };
  const visit = (index, trail) => {
    const node = nodes[index];
    if (!node) throw new Error(`node ${index} does not exist`);
    if (trail.has(index)) throw new Error(`node ${index} is its own ancestor`);
    if (node.mesh !== undefined) {
      const mesh = list(json.meshes)[node.mesh];
      if (!mesh) throw new Error(`node ${index} uses mesh ${node.mesh}, which does not exist`);
      totals.triangles += triangleCounts[node.mesh] * instanceCount(json, node, index);
      totals.drawCalls += list(mesh.primitives).length;
    }
    trail.add(index);
    for (const child of list(node.children)) visit(child, trail);
    trail.delete(index);
  };
  for (const root of sceneRoots(json)) visit(root, new Set());
  return totals;
}

function decodeDataUri(uri) {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(uri);
  if (!match) return null;
  if (/;base64$/i.test(match[1])) return Buffer.from(match[2], "base64");
  return Buffer.from(match[2].replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1");
}

// Where a URI's bytes come from: { data } when they were obtained, { unchecked } for something this audit
// does not fetch (an http(s) URL, or a relative path when no directory is known), { missing } otherwise.
function resolveUri(uri, dir) {
  if (typeof uri !== "string") return { missing: true };
  if (/^data:/i.test(uri)) {
    const data = decodeDataUri(uri);
    return data && data.length > 0 ? { data } : { missing: true };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return { unchecked: `${uri} is not a local file` };
  if (dir === null) return { unchecked: "no directory to resolve it against" };
  try {
    return { data: fs.readFileSync(path.join(dir, decodeURIComponent(uri))) };
  } catch {
    return { missing: true };
  }
}

function createBufferLoader(json, bin, dir) {
  const cache = new Map();
  return (index) => {
    if (!cache.has(index)) {
      const definition = list(json.buffers)[index];
      let found = { missing: true };
      if (definition) {
        if (definition.uri !== undefined) found = resolveUri(definition.uri, dir);
        else if (index === 0 && bin) found = { data: bin };
      }
      cache.set(index, found);
    }
    return cache.get(index);
  };
}

function textureImageIndexes(texture) {
  const extensions = texture?.extensions ?? {};
  const sources = [texture?.source, extensions.KHR_texture_basisu?.source, extensions.EXT_texture_webp?.source, extensions.EXT_texture_avif?.source];
  return [...new Set(sources.filter((source) => Number.isInteger(source)))];
}

function materialTextures(material) {
  const pbr = material?.pbrMetallicRoughness;
  const found = [
    ["baseColor", pbr?.baseColorTexture],
    ["metallicRoughness", pbr?.metallicRoughnessTexture],
    ["normal", material?.normalTexture],
    ["occlusion", material?.occlusionTexture],
    ["emissive", material?.emissiveTexture],
  ];
  return found
    .filter(([, info]) => info && Number.isInteger(info.index))
    .map(([slot, info]) => ({ slot, texture: info.index, texCoord: info.extensions?.KHR_texture_transform?.texCoord ?? info.texCoord ?? 0 }));
}

const DATA_URI_LABEL = 40;

// What a "missing image" message names: the URI (a long data: URI is cut), or the bufferView it points into.
function imageSource(image) {
  if (image.bufferView !== undefined) return `bufferView ${image.bufferView}`;
  if (typeof image.uri !== "string") return "(no uri or bufferView)";
  return image.uri.length > DATA_URI_LABEL && /^data:/i.test(image.uri) ? `${image.uri.slice(0, DATA_URI_LABEL)}...` : image.uri;
}

// The bytes of one image: { data } or { unchecked } or { missing } (see resolveUri). A bufferView that does not
// exist or reaches past the end of its buffer is missing, not clamped.
function obtainImage(image, json, loadBuffer, dir) {
  if (image.bufferView === undefined) return resolveUri(image.uri, dir);
  const view = list(json.bufferViews)[image.bufferView];
  if (!view) return { missing: true };
  const source = loadBuffer(view.buffer);
  if (!source.data) return source;
  const start = view.byteOffset ?? 0;
  const end = start + view.byteLength;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || view.byteLength < 0 || end > source.data.length) return { missing: true };
  return { data: source.data.subarray(start, end) };
}

function collectImages(json, bin, dir) {
  const loadBuffer = createBufferLoader(json, bin, dir);
  return list(json.images).map((raw, index) => {
    const image = raw ?? {};
    const found = obtainImage(image, json, loadBuffer, dir);
    const data = found.data ?? null;
    const size = data ? imageSize(data) : null;
    let status = "ok";
    if (found.missing) status = "missing";
    else if (found.unchecked) status = "unchecked";
    else if (!size) status = "unknown-format";
    return {
      index,
      name: typeof image.name === "string" ? image.name : null,
      mimeType: image.mimeType ?? mimeTypeForFormat(size?.format) ?? null,
      width: size?.width ?? null,
      height: size?.height ?? null,
      bytes: data ? data.length : null,
      status,
      source: imageSource(image),
      reason: status === "unchecked" ? `not checked (${found.unchecked})` : status === "unknown-format" ? "unknown image format" : null,
      slots: [],
    };
  });
}

function findMissingUVs(json) {
  const missing = [];
  list(json.meshes).forEach((mesh, meshIndex) => {
    list(mesh.primitives).forEach((primitive, primitiveIndex) => {
      if (primitive.material === undefined) return;
      for (const { slot, texCoord } of materialTextures(list(json.materials)[primitive.material])) {
        if (primitive.attributes?.[`TEXCOORD_${texCoord}`] === undefined) missing.push({ mesh: meshIndex, primitive: primitiveIndex, material: primitive.material, slot, texCoord });
      }
    });
  });
  return missing;
}

// triangles/drawCalls follow the default scene; uniqueTriangles counts every entry of meshes[] once.
export function auditGlb(parsed, { fileBytes = 0, dir = null } = {}) {
  const { json, bin } = parsed;
  const triangleCounts = meshTriangleCounts(json);
  const walked = walkScene(json, triangleCounts);
  const textures = collectImages(json, bin, dir);
  const jsonTextures = list(json.textures);
  list(json.materials).forEach((material) => {
    for (const { slot, texture } of materialTextures(material)) {
      for (const imageIndex of textureImageIndexes(jsonTextures[texture])) {
        const entry = textures[imageIndex];
        if (entry && !entry.slots.includes(slot)) entry.slots.push(slot);
      }
    }
  });
  for (const entry of textures) entry.slots.sort((a, b) => MATERIAL_SLOTS.indexOf(a) - MATERIAL_SLOTS.indexOf(b));
  const sized = textures.filter((entry) => entry.width !== null);
  return {
    fileBytes,
    triangles: walked.triangles,
    uniqueTriangles: triangleCounts.reduce((sum, count) => sum + count, 0),
    drawCalls: walked.drawCalls,
    meshes: list(json.meshes).length,
    nodes: list(json.nodes).length,
    materials: list(json.materials).length,
    textures,
    textureBytes: textures.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    maxTextureSize: sized.reduce((largest, entry) => Math.max(largest, entry.width, entry.height), 0),
    missingUVs: findMissingUVs(json),
    nonPowerOfTwo: sized.filter((entry) => !isPowerOfTwo(entry.width) || !isPowerOfTwo(entry.height)).map(({ index, name, width, height }) => ({ index, name, width, height })),
    missingImages: textures.filter((entry) => entry.status === "missing").map(({ index, name, source }) => ({ index, name, uri: source })),
    unreadableImages: textures.filter((entry) => entry.status === "unknown-format" || entry.status === "unchecked").map(({ index, name, reason }) => ({ index, name, reason })),
    extensionsUsed: list(json.extensionsUsed),
    extensionsRequired: list(json.extensionsRequired),
  };
}

const LIMIT_KEYS = Object.freeze([...Object.keys(BUDGET_LIMITS), ...Object.keys(BUDGET_FLAGS)]);

// A limit object holds only known keys: a typo such as "maxTris" would otherwise drop its limit without a word.
function checkBudgetObject(value, label, { extraKeys = [] } = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  for (const key of Object.keys(value)) {
    if (!LIMIT_KEYS.includes(key) && !extraKeys.includes(key)) throw new Error(`${label}: unknown key "${key}" (known keys: ${[...LIMIT_KEYS, ...extraKeys].join(", ")})`);
  }
  for (const key of Object.keys(BUDGET_LIMITS)) {
    if (value[key] !== undefined && !(typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0)) throw new Error(`${label}: ${key} must be a non-negative number`);
  }
  for (const key of Object.keys(BUDGET_FLAGS)) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`${label}: ${key} must be true or false`);
  }
  return value;
}

// Accepts the flat object or { default, files: { "<basename>": {...} } }; a per-file object overrides the default.
// Strict: an unknown key, limit keys next to "default"/"files", or a path-like "files" key throws.
export function resolveBudget(budget, fileName) {
  if (budget === undefined || budget === null) return { ...BUDGET_FLAGS };
  checkBudgetObject(budget, "budget", { extraKeys: ["default", "files"] });
  let chosen = budget;
  if (budget.default !== undefined || budget.files !== undefined) {
    const stray = Object.keys(budget).filter((key) => key !== "default" && key !== "files");
    if (stray.length > 0) throw new Error(`budget: ${stray.map((key) => `"${key}"`).join(", ")} sits next to "default"/"files" and would be ignored; put limits under "default"`);
    chosen = {};
    if (budget.default !== undefined) Object.assign(chosen, checkBudgetObject(budget.default, "budget default"));
    if (budget.files !== undefined) {
      if (budget.files === null || typeof budget.files !== "object" || Array.isArray(budget.files)) throw new Error("budget files must be a JSON object");
      for (const [name, override] of Object.entries(budget.files)) {
        if (/[\\/]/.test(name)) throw new Error(`budget files["${name}"]: keys are file basenames such as "hero.glb", not paths`);
        checkBudgetObject(override, `budget files["${name}"]`);
        if (name === fileName) Object.assign(chosen, override);
      }
    }
  }
  return { ...BUDGET_FLAGS, ...chosen };
}

function describeImage(entry) {
  return `image ${entry.index}${entry.name ? ` "${entry.name}"` : ""}`;
}

export function checkBudget(metrics, budget) {
  const fail = [];
  const warn = [];
  for (const [key, metric] of Object.entries(BUDGET_LIMITS)) {
    const limit = budget[key];
    if (limit !== undefined && metrics[metric] > limit) fail.push(`${metric} ${metrics[metric]} > ${limit}`);
  }
  if (budget.requireUVs !== false) {
    for (const item of metrics.missingUVs) fail.push(`missing UVs: mesh ${item.mesh} primitive ${item.primitive} material ${item.material} ${item.slot} needs TEXCOORD_${item.texCoord}`);
  }
  // A referenced image whose bytes cannot be obtained fails whatever the budget; one that is present but not
  // understood (or not fetched, for a remote URL) only warns.
  for (const image of metrics.missingImages ?? []) fail.push(`missing image ${image.index} ${image.uri}`);
  for (const image of metrics.unreadableImages) warn.push(`${describeImage(image)}: ${image.reason ?? "unknown image format"}`);
  for (const image of metrics.nonPowerOfTwo) {
    const message = `non-power-of-two texture ${describeImage(image)} ${image.width}x${image.height}`;
    if (budget.requirePowerOfTwo === true) fail.push(message);
    else warn.push(message);
  }
  return { fail, warn };
}

export function formatAudit(file, metrics, { fail, warn }) {
  const lines = [file];
  for (const message of fail) lines.push(`FAIL ${message}`);
  for (const message of warn) lines.push(`WARN ${message}`);
  lines.push(`${fail.length === 0 ? "PASS" : "FAIL"} ${file}`);
  const rows = [
    ["triangles", metrics.triangles],
    ["uniqueTriangles", metrics.uniqueTriangles],
    ["drawCalls", metrics.drawCalls],
    ["materials", metrics.materials],
    ["textures", metrics.textures.length],
    ["textureBytes", metrics.textureBytes],
    ["maxTextureSize", metrics.maxTextureSize],
    ["fileBytes", metrics.fileBytes],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => String(value).length));
  for (const [label, value] of rows) lines.push(`  ${label.padEnd(labelWidth)}  ${String(value).padStart(valueWidth)}`);
  for (const entry of metrics.textures) {
    const size = entry.width === null ? (entry.status === "missing" ? "missing" : "unknown size") : `${entry.width}x${entry.height}`;
    lines.push(`  ${describeImage(entry)}: ${size}, ${entry.mimeType ?? "unknown type"}, ${entry.bytes ?? "unknown"} bytes, ${entry.slots.join("+") || "unused"}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseAuditArguments(argv) {
  const result = { files: [], budget: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") result.json = true;
    else if (argument === "--budget") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--budget needs a file");
      result.budget = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else result.files.push(argument);
  }
  if (result.files.length === 0) throw new Error("Usage: glb-audit.mjs <file.glb>... [--budget budget.json] [--json]");
  return result;
}
