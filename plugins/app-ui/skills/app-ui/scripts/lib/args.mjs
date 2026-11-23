// Command-line parsing and device presets for check.mjs and shots.mjs.
// Every problem the caller can fix is a UsageError; the scripts print its message on one line and exit 2.

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export const DEVICES = Object.freeze({
  ios: Object.freeze({ name: "ios", width: 390, height: 844, deviceScaleFactor: 3, minTarget: 44, safeTop: 59, safeBottom: 34 }),
  android: Object.freeze({ name: "android", width: 412, height: 915, deviceScaleFactor: 2.625, minTarget: 48, safeTop: 24, safeBottom: 24 }),
});

export const DEFAULT_DEVICE = "ios";
export const DEFAULT_MIN_TEXT = 11;
export const DEFAULT_TIMEOUT = 20;
export const DEFAULT_DPR = 2;
export const DEFAULT_OUT = "app-shots";

export const CHECK_USAGE = "node check.mjs <flow.json> [--device ios|android] [--size WxH] [--min-text N] [--timeout s] [--only id,id] [--report file]";
export const SHOTS_USAGE = "node shots.mjs <flow.json> [--device ios|android] [--size WxH] [--dpr N] [--out dir] [--full] [--timeout s]";

export function parseSize(value, option = "--size") {
  const match = /^(\d+)x(\d+)$/i.exec(String(value ?? "").trim());
  if (!match) throw new UsageError(`${option} needs WIDTHxHEIGHT such as 390x844, got "${value}"`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new UsageError(`${option} needs a positive WIDTHxHEIGHT, got "${value}"`);
  return { width, height };
}

export function parseNumber(value, option, { min = 0, exclusiveMin = false } = {}) {
  const text = String(value ?? "").trim();
  const number = Number(text);
  const valid = text !== "" && Number.isFinite(number) && (exclusiveMin ? number > min : number >= min);
  if (!valid) throw new UsageError(`${option} needs a number ${exclusiveMin ? "above" : "of at least"} ${min}, got "${value}"`);
  return number;
}

export function parseDeviceName(value, option = "--device") {
  if (!Object.hasOwn(DEVICES, value)) throw new UsageError(`${option} must be ios or android, got "${value}"`);
  return value;
}

/**
 * Parse argv against { valued: [...], flags: [...] } (option names with their leading dashes).
 * Exactly one positional argument (the flow.json path) is required.
 */
function parseOptions(argv, { valued, flags = [], usage }) {
  const values = {};
  let positional = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flags.includes(argument)) {
      values[argument] = true;
    } else if (valued.includes(argument)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`${argument} needs a value`);
      values[argument] = next;
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown option ${argument}`);
    } else if (positional === null) {
      positional = argument;
    } else {
      throw new UsageError(`unexpected argument ${argument}`);
    }
  }
  if (positional === null) throw new UsageError(`usage: ${usage}`);
  return { positional, values };
}

export function parseCheckArgs(argv) {
  const { positional, values } = parseOptions(argv, {
    valued: ["--device", "--size", "--min-text", "--timeout", "--only", "--report"],
    usage: CHECK_USAGE,
  });
  const only = values["--only"] === undefined ? null : values["--only"].split(",").map((id) => id.trim()).filter(Boolean);
  if (only && only.length === 0) throw new UsageError("--only needs at least one screen id");
  return {
    flow: positional,
    device: values["--device"] === undefined ? null : parseDeviceName(values["--device"]),
    size: values["--size"] === undefined ? null : parseSize(values["--size"]),
    minText: values["--min-text"] === undefined ? DEFAULT_MIN_TEXT : parseNumber(values["--min-text"], "--min-text", { min: 0 }),
    timeout: values["--timeout"] === undefined ? DEFAULT_TIMEOUT : parseNumber(values["--timeout"], "--timeout", { min: 0, exclusiveMin: true }),
    only,
    report: values["--report"] ?? null,
  };
}

export function parseShotsArgs(argv) {
  const { positional, values } = parseOptions(argv, {
    valued: ["--device", "--size", "--dpr", "--out", "--timeout"],
    flags: ["--full"],
    usage: SHOTS_USAGE,
  });
  return {
    flow: positional,
    device: values["--device"] === undefined ? null : parseDeviceName(values["--device"]),
    size: values["--size"] === undefined ? null : parseSize(values["--size"]),
    dpr: values["--dpr"] === undefined ? DEFAULT_DPR : parseNumber(values["--dpr"], "--dpr", { min: 0, exclusiveMin: true }),
    out: values["--out"] ?? DEFAULT_OUT,
    full: values["--full"] === true,
    timeout: values["--timeout"] === undefined ? DEFAULT_TIMEOUT : parseNumber(values["--timeout"], "--timeout", { min: 0, exclusiveMin: true }),
  };
}

/**
 * The device used for a run: --device beats the flow's "device", which beats ios.
 * --size overrides width and height only; scale factor, minimum target and safe areas stay with the preset.
 */
export function resolveDevice({ flowDevice = null, device = null, size = null } = {}) {
  const name = device ?? flowDevice ?? DEFAULT_DEVICE;
  parseDeviceName(name, "device");
  const preset = { ...DEVICES[name] };
  if (size) {
    preset.width = size.width;
    preset.height = size.height;
  }
  return preset;
}
