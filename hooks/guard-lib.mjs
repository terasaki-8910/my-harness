import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  secrets: [".env", ".env.*"],
  readOnly: ["**/.git", "**/.git/**", ".claude/guard.json"],
  allow: [".env.example", ".env.sample", ".env.template"],
};

function stripPatternRoot(pattern) {
  if (pattern.startsWith("./")) return pattern.slice(2);
  if (pattern.startsWith("/")) return pattern.slice(1);
  return pattern;
}

export function globToRegExp(pattern) {
  const stripped = stripPatternRoot(pattern.replaceAll("\\", "/"));
  // A trailing "/" means everything inside that directory, as in "dir/**".
  const glob = stripped.endsWith("/") ? `${stripped}**` : stripped;
  let source = "";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];

    if (character === "*" && glob[index + 1] === "*") {
      const atSegmentStart = index === 0 || glob[index - 1] === "/";
      const followedBySlash = glob[index + 2] === "/";
      const isTrailingGlobstar = index + 2 === glob.length && index > 0 && glob[index - 1] === "/";

      if (atSegmentStart && followedBySlash) {
        source += "(?:[^/]+/)*";
        index += 2;
      } else if (isTrailingGlobstar) {
        source += ".+";
        index += 1;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }

  return new RegExp(`^${source}$`, "i");
}

function normalizeString(value) {
  let normalized = String(value).replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  normalized = path.posix.normalize(normalized);
  if (normalized.length > 1 && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/$/, "");
  }
  return normalized;
}

function isAbsolutePath(value) {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

export function normalizePath(value, projectDir) {
  const project = normalizeString(projectDir);
  const candidate = normalizeString(value);
  const abs = isAbsolutePath(candidate)
    ? candidate
    : normalizeString(path.posix.join(project, candidate));

  const absLower = abs.toLowerCase();
  const projectLower = project.toLowerCase();
  let rel = null;
  if (absLower === projectLower) {
    rel = "";
  } else {
    const projectPrefix = projectLower.endsWith("/") ? projectLower : `${projectLower}/`;
    if (absLower.startsWith(projectPrefix)) {
      rel = abs.slice(project.length + (project.endsWith("/") ? 0 : 1));
    }
  }

  return { abs, rel };
}

function withoutRoot(value) {
  if (/^[A-Za-z]:\//.test(value)) return value.slice(3);
  return value.replace(/^\/+/, "");
}

export function matches(pattern, normalizedPath) {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const regexp = globToRegExp(normalizedPattern);

  if (!stripPatternRoot(normalizedPattern).includes("/")) {
    return regexp.test(path.posix.basename(normalizedPath.abs));
  }

  if (stripPatternRoot(normalizedPattern).startsWith("**/")) {
    const candidate = normalizedPath.rel === null
      ? withoutRoot(normalizedPath.abs)
      : normalizedPath.rel;
    return regexp.test(candidate);
  }

  return normalizedPath.rel !== null && regexp.test(normalizedPath.rel);
}

function defaultRules() {
  return [
    ...DEFAULTS.secrets.map((pattern) => ({ kind: "secret", pattern, source: "defaults" })),
    ...DEFAULTS.readOnly.map((pattern) => ({ kind: "readOnly", pattern, source: "defaults" })),
    ...DEFAULTS.allow.map((pattern) => ({ kind: "allow", pattern, source: "defaults" })),
  ];
}

export function loadConfig(projectDir) {
  const rules = defaultRules();
  const warnings = [];
  const configPath = path.join(projectDir, ".claude", "guard.json");
  let text;

  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { rules, warnings };
    // Any other read failure (EACCES, EISDIR, ...) must not disable the defaults.
    warnings.push(`.claude/guard.json could not be read (${error?.code ?? error?.message}); using defaults only`);
    return { rules, warnings };
  }

  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    warnings.push(`.claude/guard.json is invalid JSON: ${error.message}`);
    return { rules, warnings };
  }

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    warnings.push(".claude/guard.json must contain a JSON object; ignoring it");
    return { rules, warnings };
  }

  const kinds = { secrets: "secret", readOnly: "readOnly", allow: "allow" };
  for (const key of Object.keys(config)) {
    if (!(key in kinds)) {
      warnings.push(`.claude/guard.json has unknown key "${key}"; ignoring that key`);
      continue;
    }
    const values = config[key];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
      warnings.push(`.claude/guard.json key "${key}" must be an array of non-empty strings; ignoring that key`);
      continue;
    }
    rules.push(...values.map((pattern) => ({
      kind: kinds[key],
      pattern,
      source: ".claude/guard.json",
    })));
  }

  return { rules, warnings };
}

const READ_TOOLS = new Map([
  ["Read", "file_path"],
  ["Grep", "path"],
]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function decide(input, { projectDir, rules }) {
  const toolName = input?.tool_name;
  const toolInput = input?.tool_input ?? {};
  let targetPath;
  let isWrite = false;

  if (READ_TOOLS.has(toolName)) {
    targetPath = toolInput[READ_TOOLS.get(toolName)];
  } else if (WRITE_TOOLS.has(toolName)) {
    isWrite = true;
    targetPath = toolName === "NotebookEdit"
      ? toolInput.notebook_path ?? toolInput.file_path
      : toolInput.file_path;
  } else {
    return { action: "allow" };
  }

  if (typeof targetPath !== "string" || targetPath.length === 0) return { action: "allow" };

  const normalized = normalizePath(targetPath, projectDir);
  if (rules.some((rule) => rule.kind === "allow" && matches(rule.pattern, normalized))) {
    return { action: "allow" };
  }

  const blockingRule = rules.find((rule) => (
    rule.kind === "secret" || (isWrite && rule.kind === "readOnly")
  ) && matches(rule.pattern, normalized));
  if (!blockingRule) return { action: "allow" };

  const display = normalized.rel === null ? normalized.abs : normalized.rel;
  const description = blockingRule.kind === "secret"
    ? "a protected secret file"
    : "read-only";
  const reason = `Blocked by core guard: ${display} is ${description} (pattern "${blockingRule.pattern}" from ${blockingRule.source}). Do not work around this with other tools; ask the user to make this change or to add an "allow" entry to .claude/guard.json.`;

  return {
    action: "deny",
    kind: blockingRule.kind,
    pattern: blockingRule.pattern,
    source: blockingRule.source,
    display,
    reason,
  };
}
