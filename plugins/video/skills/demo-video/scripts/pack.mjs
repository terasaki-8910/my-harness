#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attachPage } from "./lib/cdp.mjs";
import { findChrome, launchChrome } from "./lib/chrome.mjs";
import { evaluatePackedCheck, packPage } from "./lib/pack.mjs";

function usage() {
  return "Usage: pack.mjs <page.html> <out.html> [--check]";
}

function argumentsFor(argv) {
  const positional = [];
  let check = false;
  for (const argument of argv) {
    if (argument === "--check") check = true;
    else if (argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length !== 2) throw new Error(usage());
  return { page: positional[0], out: positional[1], check };
}

function waitForLoad(cdp, sessionId) {
  return new Promise((resolve) => {
    const off = cdp.on("Page.loadEventFired", (_, eventSessionId) => {
      if (eventSessionId === sessionId) { off(); resolve(); }
    });
  });
}

async function checkPackedFile(file) {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "demo-video-pack-"));
  const copy = path.join(temporary, path.basename(file));
  await fs.promises.copyFile(file, copy);
  const fileUrl = pathToFileURL(copy).href;
  let chrome;
  try {
    const chromePath = findChrome({ env: process.env, platform: process.platform });
    chrome = launchChrome(chromePath, { width: 1280, height: 720 });
    const sessionId = await attachPage(chrome.cdp);
    const requests = [];
    const pageErrors = [];
    const consoleErrors = [];
    chrome.cdp.on("Network.requestWillBeSent", (params, eventSessionId) => {
      if (eventSessionId === sessionId) requests.push(params.request?.url ?? "unknown");
    });
    chrome.cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
      if (eventSessionId === sessionId) pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "unknown exception");
    });
    chrome.cdp.on("Runtime.consoleAPICalled", (params, eventSessionId) => {
      if (eventSessionId === sessionId && params.type === "error") consoleErrors.push(params.args?.map((item) => item.value ?? item.description ?? item.type).join(" ") ?? "console.error");
    });
    chrome.cdp.on("Log.entryAdded", (params, eventSessionId) => {
      if (eventSessionId === sessionId && params.entry?.level === "error") consoleErrors.push(params.entry.text ?? "log error");
    });
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Network.enable", {}, sessionId),
      chrome.cdp.send("Log.enable", {}, sessionId),
    ]);
    const loaded = waitForLoad(chrome.cdp, sessionId);
    await chrome.cdp.send("Page.navigate", { url: fileUrl }, sessionId);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const response = await chrome.cdp.send("Runtime.evaluate", {
      expression: "[...document.images].filter(image=>image.naturalWidth===0).map(image=>image.currentSrc||image.src||'<img>')",
      returnByValue: true,
    }, sessionId);
    if (response.exceptionDetails) pageErrors.push(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "image check failed");
    const brokenImages = response.result?.value ?? [];
    return evaluatePackedCheck({ fileUrl, requests, brokenImages, pageErrors, consoleErrors });
  } finally {
    await Promise.allSettled([chrome?.close()]);
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const out = path.resolve(args.out);
  const packed = await packPage(path.resolve(args.page));
  if (packed.problems.length > 0) {
    for (const problem of packed.problems) process.stderr.write(`FAIL ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await fs.promises.writeFile(out, packed.html);
  const size = Buffer.byteLength(packed.html);
  process.stdout.write(`Packed ${out}: ${size} bytes; ${packed.counts.stylesheets} stylesheet(s), ${packed.counts.scripts} script(s), ${packed.counts.images} image(s), ${packed.counts.fonts} font(s) inlined\n`);
  if (args.check) {
    const result = await checkPackedFile(out);
    for (const message of result.pass) process.stdout.write(`PASS ${message}\n`);
    for (const message of result.fail) process.stdout.write(`FAIL ${message}\n`);
    if (result.fail.length > 0) process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`pack: ${error.message}\n`);
  process.exitCode = 1;
}
