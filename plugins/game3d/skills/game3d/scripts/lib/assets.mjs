import fs from "node:fs";
import path from "node:path";

export const MANIFEST_SCHEMA = "game3d/assets@1";
export const DEFAULT_MANIFEST = "assets/manifest.json";

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizePath(value, label) {
  if (!isText(value)) throw new Error(`${label} must be a non-empty string`);
  if (value.includes("\\")) throw new Error(`${label} "${value}" must use forward slashes`);
  if (value.startsWith("/") || /^[a-z]:/i.test(value)) throw new Error(`${label} "${value}" must be relative to the project directory`);
  const normalized = value.replace(/^(\.\/)+/, "");
  if (normalized.split("/").includes("..")) throw new Error(`${label} "${value}" must stay inside the project directory`);
  return normalized;
}

function pathList(value, label, { required }) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`manifest "${label}" must be an array`);
  return value.map((item, index) => normalizePath(item, `${label}[${index}]`));
}

// Throws on a manifest that cannot be audited; empty license/source/attribution are audit FAILs, not errors.
export function normalizeManifest(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("manifest must be a JSON object");
  if (raw.schema !== MANIFEST_SCHEMA) throw new Error(`manifest schema must be "${MANIFEST_SCHEMA}" (found ${JSON.stringify(raw.schema)})`);
  if (!Array.isArray(raw.allowLicenses) || !raw.allowLicenses.every((item) => typeof item === "string")) throw new Error('manifest "allowLicenses" must be an array of strings');
  if (!Array.isArray(raw.assets)) throw new Error('manifest "assets" must be an array');
  const assets = raw.assets.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`assets[${index}] must be an object`);
    const text = (value) => (typeof value === "string" ? value : "");
    return { path: normalizePath(entry.path, `assets[${index}].path`), license: text(entry.license), source: text(entry.source), attribution: text(entry.attribution) };
  });
  return {
    roots: pathList(raw.roots, "roots", { required: true }).map((root) => root.replace(/\/+$/, "")),
    ignore: pathList(raw.ignore, "ignore", { required: false }),
    allowLicenses: raw.allowLicenses,
    assets,
  };
}

export function entryCovers(entry, file) {
  return entry.endsWith("/") ? file.startsWith(entry) : file === entry;
}

// Read-only view of a project directory. Names are matched exactly, so "Gate.glb" never
// stands in for "gate.glb" on case-insensitive file systems.
export function projectView(projectDir) {
  const cache = new Map();
  const entriesOf = (relative) => {
    if (!cache.has(relative)) {
      try {
        cache.set(relative, fs.readdirSync(path.join(projectDir, relative), { withFileTypes: true }));
      } catch {
        cache.set(relative, null);
      }
    }
    return cache.get(relative);
  };
  const kindOf = (parent, entry) => {
    if (entry.isDirectory()) return "dir";
    if (entry.isFile()) return "file";
    // A symbolic link or Windows junction counts as what it points to; a dangling link is nothing.
    if (entry.isSymbolicLink()) {
      try {
        const info = fs.statSync(path.join(projectDir, parent, entry.name));
        if (info.isDirectory()) return "dir";
        return info.isFile() ? "file" : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const realPath = (relative) => {
    const full = path.join(projectDir, relative);
    try {
      return fs.realpathSync.native(full);
    } catch {
      try {
        return fs.realpathSync(full);
      } catch {
        return null;
      }
    }
  };
  const kind = (relative) => {
    const segments = relative.split("/").filter((segment) => segment !== "" && segment !== ".");
    let parent = "";
    for (let index = 0; index < segments.length; index += 1) {
      const entry = entriesOf(parent)?.find((candidate) => candidate.name === segments[index]);
      const found = entry ? kindOf(parent, entry) : null;
      if (found === null) return null;
      if (index === segments.length - 1) return found;
      if (found !== "dir") return null;
      parent = parent === "" ? segments[index] : `${parent}/${segments[index]}`;
    }
    return "dir";
  };
  const files = (relative) => {
    const base = relative.replace(/\/+$/, "");
    if (kind(base) !== "dir") return null;
    const found = [];
    // Links to directories are followed and files are named by their path under the root, not by the link
    // target. `ancestors` holds the real paths of the directories above, so a link back up the tree stops there.
    const walk = (directory, ancestors) => {
      const real = realPath(directory);
      if (real === null || ancestors.includes(real)) return;
      for (const entry of entriesOf(directory) ?? []) {
        const child = directory === "" ? entry.name : `${directory}/${entry.name}`;
        const entryKind = kindOf(directory, entry);
        if (entryKind === "file") found.push(child);
        else if (entryKind === "dir") walk(child, [...ancestors, real]);
      }
    };
    walk(base.split("/").filter((segment) => segment !== "." && segment !== "").join("/"), []);
    return found.sort();
  };
  return { kind, files };
}

function describeEntries(entries) {
  return entries.map((entry) => entry.path).join(", ");
}

export function auditAssets(manifest, view) {
  const fail = [];
  const warn = [];
  const files = new Set();
  for (const root of manifest.roots) {
    const found = view.files(root);
    if (found === null) throw new Error(`root "${root}" does not exist`);
    for (const file of found) files.add(file);
  }
  const sorted = [...files].sort();
  const overlaps = new Map();
  for (const file of sorted) {
    const covering = manifest.assets.filter((asset) => entryCovers(asset.path, file));
    if (covering.length === 0 && !manifest.ignore.some((entry) => entryCovers(entry, file))) fail.push(`uncovered file ${file}: add it to assets or ignore`);
    if (covering.length > 1) {
      const key = describeEntries(covering);
      overlaps.set(key, [...(overlaps.get(key) ?? []), file]);
    }
  }
  for (const [key, group] of overlaps) {
    const shown = group.slice(0, 3).join(", ");
    warn.push(`${group.length} file${group.length === 1 ? "" : "s"} covered by more than one entry (${key}): ${shown}${group.length > 3 ? `, +${group.length - 3} more` : ""}`);
  }
  for (const asset of manifest.assets) {
    if (asset.path.endsWith("/")) {
      if ((view.files(asset.path) ?? []).length === 0) fail.push(`asset entry ${asset.path} covers no file`);
    } else {
      const kind = view.kind(asset.path);
      if (kind === "dir") fail.push(`asset entry ${asset.path} is a directory: end the path with "/" to cover its files`);
      else if (kind === null) fail.push(`asset entry ${asset.path} does not exist`);
    }
    if (!manifest.allowLicenses.includes(asset.license)) fail.push(`${asset.path}: license ${asset.license === "" ? "is empty" : `"${asset.license}" is not in allowLicenses`}`);
    if (asset.license.startsWith("CC-BY") && asset.attribution.trim() === "") fail.push(`${asset.path}: license ${asset.license} needs an attribution`);
    if (asset.source.trim() === "") fail.push(`${asset.path}: source is empty`);
  }
  return { files: sorted.length, entries: manifest.assets.length, fail, warn };
}

export function auditProject(projectDir, manifestPath = DEFAULT_MANIFEST) {
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(`project directory not found: ${projectDir}`);
  const file = path.resolve(projectDir, manifestPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read manifest ${manifestPath}: ${error.message}`);
  }
  return auditAssets(normalizeManifest(raw), projectView(projectDir));
}

export function formatAssetAudit(label, result) {
  const lines = [label];
  for (const message of result.fail) lines.push(`FAIL ${message}`);
  for (const message of result.warn) lines.push(`WARN ${message}`);
  lines.push(`${result.fail.length === 0 ? "PASS" : "FAIL"} ${label}`);
  lines.push(`  files    ${result.files}`, `  entries  ${result.entries}`);
  return `${lines.join("\n")}\n`;
}

export const ASSET_USAGE = "Usage: asset-audit.mjs [<project-dir>] [--manifest <path relative to the project>] [--json]";

export function parseAssetArguments(argv) {
  const result = { project: ".", manifest: DEFAULT_MANIFEST, json: false };
  let sawProject = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") result.json = true;
    else if (argument === "--manifest") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--manifest needs a path");
      result.manifest = value;
      index += 1;
    } else if (argument === "--help") throw new Error(ASSET_USAGE);
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else if (!sawProject) {
      result.project = argument;
      sawProject = true;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return result;
}
