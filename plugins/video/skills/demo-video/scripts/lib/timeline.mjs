import path from "node:path";

const EASES = new Set(["linear", "in", "out", "inOut"]);
const KEYS = new Set([
  "Escape", "Enter", "Tab", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "PageUp", "PageDown", "Home", "End",
]);
const ACTIONS = new Set(["move", "click", "scroll", "key", "call", "wait"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;

export function ease(name, t) {
  const value = Math.max(0, Math.min(1, t));
  if (name === "linear") return value;
  if (name === "in") return value ** 3;
  if (name === "out") return 1 - (1 - value) ** 3;
  if (name === "inOut") return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
  throw new Error(`Unknown ease: ${name}`);
}

export const lerp = (from, to, t) => from + (to - from) * t;
export const lerpPoint = (from, to, t) => ({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) });

export function actionDuration(action) {
  if (action.do === "move" || action.do === "scroll") return action.dur;
  if (action.do === "click" && action.to) return action.dur;
  if (action.do === "wait") return action.dur;
  return 0;
}

export function validate(input) {
  const errors = [];
  const source = object(input) ? input : {};
  if (!object(input)) errors.push("top level: must be an object");
  const durationSource = source.duration;
  if (durationSource !== "auto" && !positive(durationSource)) errors.push('duration: must be a number greater than 0 or "auto"');
  const tail = source.tail ?? 1;
  if (durationSource === "auto") {
    if (!finite(tail) || tail < 0) errors.push("tail: must be a non-negative number");
  } else if (source.tail !== undefined) errors.push('tail: is only allowed when duration is "auto"');
  if (typeof source.page !== "string" || source.page.length === 0) errors.push("page: is required and must be a non-empty string");
  if (source.out !== undefined && (typeof source.out !== "string" || source.out.length === 0)) errors.push("out: must be a non-empty string");
  if (source.root !== undefined && (typeof source.root !== "string" || source.root.length === 0)) errors.push("root: must be a non-empty string");
  if (typeof source.page === "string" && !/^https?:\/\//i.test(source.page) && (path.isAbsolute(source.page) || /^[A-Za-z]:[\\/]/.test(source.page))) errors.push("page: local path must be relative to video.json");
  if (typeof source.out === "string" && (path.isAbsolute(source.out) || /^[A-Za-z]:[\\/]/.test(source.out))) errors.push("out: must be relative to video.json");

  if (source.viewport !== undefined && !object(source.viewport)) errors.push("viewport: must be an object");
  const viewportSource = object(source.viewport) ? source.viewport : {};
  const viewport = { width: viewportSource.width ?? 1920, height: viewportSource.height ?? 1080 };
  if (!Number.isInteger(viewport.width) || viewport.width <= 0) errors.push("viewport.width: must be a positive integer");
  if (!Number.isInteger(viewport.height) || viewport.height <= 0) errors.push("viewport.height: must be a positive integer");
  const fps = source.fps ?? 30;
  if (!positive(fps)) errors.push("fps: must be a number greater than 0");

  if (source.cursor !== undefined && !object(source.cursor)) errors.push("cursor: must be an object");
  const cursorSource = object(source.cursor) ? source.cursor : {};
  const cursor = { visible: cursorSource.visible ?? true, size: cursorSource.size ?? 32, start: cursorSource.start ?? null };
  if (typeof cursor.visible !== "boolean") errors.push("cursor.visible: must be a boolean");
  if (!positive(cursor.size)) errors.push("cursor.size: must be a number greater than 0");
  if (cursor.start !== null && (!Array.isArray(cursor.start) || cursor.start.length !== 2 || !cursor.start.every(finite))) errors.push("cursor.start: must be null or [x, y]");

  let ready;
  if (source.ready !== undefined) {
    if (typeof source.ready === "string" && source.ready.length > 0) ready = { expression: source.ready, timeout: 10 };
    else errors.push("ready: must be a non-empty JavaScript expression string");
  }

  const timelineSource = source.timeline ?? [];
  if (!Array.isArray(timelineSource)) errors.push("timeline: must be an array");
  const timelineItems = Array.isArray(timelineSource) ? timelineSource : [];
  const skipGroupsSource = source.skipGroups ?? [];
  const validSkipGroups = Array.isArray(skipGroupsSource) && skipGroupsSource.every((name) => typeof name === "string" && name.length > 0);
  if (!validSkipGroups) errors.push("skipGroups: must be an array of non-empty strings");
  const skipGroups = validSkipGroups ? [...skipGroupsSource] : [];
  const actionGroups = new Set();
  for (const [index, raw] of timelineItems.entries()) {
    if (!object(raw) || raw.group === undefined) continue;
    if (typeof raw.group !== "string" || raw.group.length === 0) errors.push(`action ${index} field group: must be a non-empty string`);
    else actionGroups.add(raw.group);
  }
  for (const name of new Set(skipGroups)) if (!actionGroups.has(name)) errors.push(`skipGroups: no action has group "${name}"`);
  const skippedGroupNames = new Set(skipGroups);
  const kept = [];
  for (const [index, raw] of timelineItems.entries()) {
    const prefix = `action ${index}`;
    if (!object(raw)) {
      errors.push(`${prefix}: must be an object`);
      continue;
    }
    if (raw.skip === true || skippedGroupNames.has(raw.group)) continue;
    const action = { ...raw };
    if (action.at !== undefined && action.wait !== undefined) errors.push(`${prefix} fields at/wait: provide only one`);
    if (action.at !== undefined && (!finite(action.at) || action.at < 0)) errors.push(`${prefix} field at: must be a non-negative number`);
    if (action.wait !== undefined && (!finite(action.wait) || action.wait < 0)) errors.push(`${prefix} field wait: must be a non-negative number`);
    if (action.label !== undefined && typeof action.label !== "string") errors.push(`${prefix} field label: must be a string`);
    if (!ACTIONS.has(action.do)) {
      errors.push(`${prefix} field do: unknown action ${JSON.stringify(action.do)}`);
    } else if (action.do === "move") {
      action.anchor ??= [0.5, 0.5];
      action.dur ??= 0.35;
      action.ease ??= "out";
      const selector = typeof action.to === "string" && action.to.length > 0;
      const coordinates = finite(action.x) && finite(action.y);
      if (action.to !== undefined && !selector) errors.push(`${prefix} field to: must be a non-empty selector`);
      if (!selector && !coordinates) errors.push(`${prefix} field to/x/y: provide a selector or both x and y`);
      if (!Array.isArray(action.anchor) || action.anchor.length !== 2 || !action.anchor.every(finite)) errors.push(`${prefix} field anchor: must be [fx, fy]`);
      if (!finite(action.dur) || action.dur < 0) errors.push(`${prefix} field dur: must be a non-negative number`);
      if (!EASES.has(action.ease)) errors.push(`${prefix} field ease: must be linear, in, out, or inOut`);
    } else if (action.do === "click") {
      if (action.dur !== undefined && (!finite(action.dur) || action.dur < 0)) errors.push(`${prefix} field dur: must be a non-negative number`);
      action.dur = action.to ? (action.dur ?? 0.35) : 0;
      action.ease ??= "out";
      action.anchor ??= [0.5, 0.5];
      if (action.to !== undefined && (typeof action.to !== "string" || action.to.length === 0)) errors.push(`${prefix} field to: must be a non-empty selector`);
      if (!EASES.has(action.ease)) errors.push(`${prefix} field ease: must be linear, in, out, or inOut`);
      if (!Array.isArray(action.anchor) || action.anchor.length !== 2 || !action.anchor.every(finite)) errors.push(`${prefix} field anchor: must be [fx, fy]`);
    } else if (action.do === "scroll") {
      action.in ??= null;
      action.offset ??= 0;
      action.dur ??= 0.6;
      action.ease ??= "inOut";
      if (action.to !== undefined && (typeof action.to !== "string" || action.to.length === 0)) errors.push(`${prefix} field to: must be a non-empty selector`);
      if ((typeof action.to !== "string" || action.to.length === 0) && !finite(action.x) && !finite(action.y)) errors.push(`${prefix} field to/x/y: provide a selector or x and/or y`);
      if (action.in !== null && (typeof action.in !== "string" || action.in.length === 0)) errors.push(`${prefix} field in: must be a non-empty selector`);
      if (!finite(action.offset)) errors.push(`${prefix} field offset: must be a number`);
      if (!finite(action.dur) || action.dur < 0) errors.push(`${prefix} field dur: must be a non-negative number`);
      if (!EASES.has(action.ease)) errors.push(`${prefix} field ease: must be linear, in, out, or inOut`);
    } else if (action.do === "key") {
      if (typeof action.key !== "string" || (!KEYS.has(action.key) && [...action.key].length !== 1)) errors.push(`${prefix} field key: is not supported`);
    } else if (action.do === "call") {
      action.args ??= [];
      action.timeout = 5;
      if (typeof action.fn !== "string" || !/^[A-Za-z_$][\w$]*$/.test(action.fn)) errors.push(`${prefix} field fn: must be a global identifier`);
      if (!Array.isArray(action.args)) errors.push(`${prefix} field args: must be an array`);
    } else if (action.do === "wait") {
      action.dur ??= 0;
      if (!finite(action.dur) || action.dur < 0) errors.push(`${prefix} field dur: must be a non-negative number`);
    }
    kept.push({ action, originalIndex: index });
  }

  let previousEnd = 0;
  for (const item of kept) {
    const { action } = item;
    if (!finite(action.at) || action.at < 0) action.at = previousEnd + (finite(action.wait) && action.wait >= 0 ? action.wait : 0);
    previousEnd = action.at + (finite(actionDuration(action)) ? actionDuration(action) : 0);
  }
  const timeline = kept.map((item) => item.action);
  const plannedEnd = timeline.length > 0 ? timeline.at(-1).at + actionDuration(timeline.at(-1)) : 0;
  const duration = durationSource === "auto" ? plannedEnd + (finite(tail) && tail >= 0 ? tail : 0) : durationSource;
  if (durationSource === "auto" && timeline.length === 0 && tail === 0) errors.push("duration: auto duration must be greater than 0");

  for (let index = 0; index < timeline.length; index += 1) {
    const action = timeline[index];
    const originalIndex = kept[index].originalIndex;
    if (index > 0 && finite(action.at) && finite(timeline[index - 1].at) && action.at < timeline[index - 1].at) errors.push(`action ${originalIndex} field at: actions must be sorted by at`);
    if (index > 0 && finite(action.at)) {
      const previous = timeline[index - 1];
      const previousEnd = previous.at + actionDuration(previous);
      if (finite(previousEnd) && action.at < previousEnd) errors.push(`action ${originalIndex} field at: starts before action ${kept[index - 1].originalIndex} ends at ${previousEnd}`);
    }
    const end = action.at + actionDuration(action);
    if (positive(duration) && finite(end) && end > duration) errors.push(`action ${originalIndex} field dur: ends after duration`);
  }

  const mustShowSource = source.mustShow ?? [];
  if (!Array.isArray(mustShowSource)) errors.push("mustShow: must be an array");
  const mustShow = (Array.isArray(mustShowSource) ? mustShowSource : []).map((item, index) => {
    if (!object(item)) {
      errors.push(`mustShow ${index}: must be an object`);
      return item;
    }
    if (typeof item.selector !== "string" || item.selector.length === 0) errors.push(`mustShow ${index} field selector: is required`);
    if (!positive(item.min)) errors.push(`mustShow ${index} field min: must be greater than 0`);
    if (item.label !== undefined && typeof item.label !== "string") errors.push(`mustShow ${index} field label: must be a string`);
    return { ...item };
  });

  const checksSource = object(source.checks) ? source.checks : {};
  if (source.checks !== undefined && !object(source.checks)) errors.push("checks: must be an object");
  const checks = {
    duration: checksSource.duration ?? (positive(duration) ? [Math.max(0, duration - 0.25), duration + 0.25] : [0, 0]),
    maxBytes: checksSource.maxBytes,
    blackMax: checksSource.blackMax === undefined ? 0.5 : checksSource.blackMax,
    maxStaticShare: checksSource.maxStaticShare ?? 0.85,
    audio: checksSource.audio ?? "none",
    human: checksSource.human ?? [],
  };
  if (!Array.isArray(checks.duration) || checks.duration.length !== 2 || !checks.duration.every((value) => finite(value) && value >= 0) || checks.duration[0] > checks.duration[1]) errors.push("checks.duration: must be [min, max]");
  if (checks.maxBytes !== undefined && (!Number.isInteger(checks.maxBytes) || checks.maxBytes <= 0)) errors.push("checks.maxBytes: must be a positive integer");
  if (checks.blackMax !== null && !positive(checks.blackMax)) errors.push("checks.blackMax: must be null or greater than 0");
  if (!finite(checks.maxStaticShare) || checks.maxStaticShare < 0 || checks.maxStaticShare > 1) errors.push("checks.maxStaticShare: must be between 0 and 1");
  if (!new Set(["none", "allowed"]).has(checks.audio)) errors.push('checks.audio: must be "none" or "allowed"');
  if (!Array.isArray(checks.human) || !checks.human.every((item) => typeof item === "string")) errors.push("checks.human: must be a string array");

  const root = source.root ?? (typeof source.page === "string" && !/^https?:\/\//i.test(source.page) ? path.dirname(source.page) : undefined);
  return { spec: { page: source.page, out: source.out ?? "out/video.mp4", root, viewport, fps, duration, tail: durationSource === "auto" ? tail : undefined, cursor, ready, timeline, skipGroups, mustShow, checks }, errors };
}

