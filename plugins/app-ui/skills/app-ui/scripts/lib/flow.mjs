// Load and validate flow.json. Every problem is a UsageError with a one-line message.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./args.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isInside(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * Read flow.json. Returns
 * { file, dir, device, designMd, screens: [{ id, label, file, abs, urlPath, url, tap, tapText, next }] }
 * where `file` is the path as written, `abs` the absolute path, `urlPath` the path to request from a server
 * rooted at the flow.json folder, and `designMd` an absolute path or null.
 */
export function loadFlow(flowPath) {
  const file = path.resolve(flowPath);
  const dir = path.dirname(file);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`flow.json not found: ${flowPath}`);
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new UsageError(`${path.basename(file)} is not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new UsageError("flow.json must be a JSON object");
  if (data.device !== undefined && data.device !== "ios" && data.device !== "android") throw new UsageError(`flow.json "device" must be ios or android, got ${JSON.stringify(data.device)}`);
  if (!Array.isArray(data.screens) || data.screens.length === 0) throw new UsageError('flow.json needs a "screens" array with at least one screen');

  let designMd = null;
  if (data.designMd !== undefined) {
    if (!nonEmptyString(data.designMd)) throw new UsageError('flow.json "designMd" must be a path string');
    designMd = path.resolve(dir, data.designMd);
    if (!isFile(designMd)) throw new UsageError(`flow.json designMd not found: ${data.designMd}`);
  }

  const ids = new Set();
  const screens = data.screens.map((raw, index) => {
    const where = `screens[${index}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError(`${where} must be an object`);
    if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) throw new UsageError(`${where} id must match ${ID_PATTERN}, got ${JSON.stringify(raw.id)}`);
    if (ids.has(raw.id)) throw new UsageError(`duplicate screen id "${raw.id}"`);
    ids.add(raw.id);
    const name = `screen "${raw.id}"`;
    if (!nonEmptyString(raw.label)) throw new UsageError(`${name} needs a label string`);
    const hasFile = raw.file !== undefined;
    const hasUrl = raw.url !== undefined;
    if (hasFile === hasUrl) throw new UsageError(`${name} needs exactly one of "file" or "url"`);
    if (raw.tap !== undefined && raw.tapText !== undefined) throw new UsageError(`${name} has both "tap" and "tapText"; use one`);
    if (raw.tap !== undefined && !nonEmptyString(raw.tap)) throw new UsageError(`${name} "tap" must be a CSS selector string`);
    if (raw.tapText !== undefined && !nonEmptyString(raw.tapText)) throw new UsageError(`${name} "tapText" must be a non-empty string`);
    if (raw.next !== undefined && !nonEmptyString(raw.next)) throw new UsageError(`${name} "next" must be a screen id`);

    const screen = { id: raw.id, label: raw.label, file: null, abs: null, urlPath: null, url: null, tap: raw.tap ?? null, tapText: raw.tapText ?? null, next: raw.next ?? null };
    if (hasFile) {
      if (!nonEmptyString(raw.file)) throw new UsageError(`${name} "file" must be a path string`);
      const abs = path.resolve(dir, raw.file);
      if (!isInside(dir, abs)) throw new UsageError(`${name} file is outside the flow.json folder: ${raw.file}`);
      if (!isFile(abs)) throw new UsageError(`${name} file not found: ${raw.file}`);
      screen.file = raw.file;
      screen.abs = abs;
      screen.urlPath = path.relative(dir, abs).split(path.sep).map(encodeURIComponent).join("/");
    } else {
      let parsed = null;
      try {
        parsed = typeof raw.url === "string" ? new URL(raw.url) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new UsageError(`${name} url must be an http or https URL, got ${JSON.stringify(raw.url)}`);
      screen.url = raw.url;
    }
    return screen;
  });

  for (const screen of screens) {
    if (screen.next !== null && !ids.has(screen.next)) throw new UsageError(`screen "${screen.id}" next names an unknown screen "${screen.next}"`);
  }
  return { file, dir, device: data.device ?? null, designMd, screens };
}
