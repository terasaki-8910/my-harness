#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { auditExpression, evaluate, installDiagnostics, openPage, resolvePage } from "./lib/browser.mjs";
import { baselineDiff, decideWidth, groupDuplicates, parseCheckArguments, slideCounts } from "./lib/checks.mjs";

function printCounts(counts, total) {
  const idWidth = Math.max(5, ...counts.map((item) => item.id.length));
  process.stdout.write(`\n${"slide".padEnd(idWidth)}  chars\n${"-".repeat(idWidth)}  -----\n`);
  for (const item of counts) process.stdout.write(`${item.id.padEnd(idWidth)}  ${String(item.chars).padStart(5)}\n`);
  process.stdout.write(`${"TOTAL".padEnd(idWidth)}  ${String(total).padStart(5)}\n`);
}

function printBaseline(diff) {
  process.stdout.write("\nBASELINE (before -> after, difference)\n");
  for (const item of diff.slides) process.stdout.write(`${item.id}: ${item.before} -> ${item.after} (${item.difference >= 0 ? "+" : ""}${item.difference})\n`);
  const total = diff.total;
  process.stdout.write(`TOTAL: ${total.before} -> ${total.after} (${total.difference >= 0 ? "+" : ""}${total.difference})\n`);
}

async function auditWidth(url, viewport, selector) {
  let browser;
  try {
    const opened = await openPage({ url, ...viewport, beforeNavigate: installDiagnostics });
    browser = opened.chrome;
    const tracking = opened.context;
    const data = await evaluate(browser.cdp, opened.sessionId, auditExpression(selector));
    tracking.close();
    return { ...data, ...tracking.diagnostics };
  } finally {
    await browser?.close();
  }
}

async function main() {
  const args = parseCheckArguments(process.argv.slice(2));
  const page = await resolvePage(args.page);
  const fail = [];
  const warn = [];
  let counts = [];
  let duplicates = [];
  try {
    for (let index = 0; index < args.widths.length; index += 1) {
      const viewport = args.widths[index];
      process.stdout.write(`\n${viewport.label}\n`);
      let raw;
      try {
        raw = await auditWidth(page.url, viewport, args.slides);
      } catch (error) {
        const message = /timed out/i.test(error.message) ? `readiness timeout: ${error.message}` : `browser check failed: ${error.message}`;
        fail.push({ width: viewport.label, message });
        process.stdout.write(`FAIL ${message}\n`);
        continue;
      }
      const decision = decideWidth(raw);
      for (const message of decision.fail) {
        fail.push({ width: viewport.label, message });
        process.stdout.write(`FAIL ${message}\n`);
      }
      for (const item of decision.warn) {
        const entry = { width: viewport.label, ...item };
        warn.push(entry);
        process.stdout.write(`WARN ${item.kind} on ${item.slideId} at ${item.path}: ${item.text}\n`);
      }
      if (decision.fail.length === 0) process.stdout.write("PASS browser checks\n");
      if (index === 0) {
        counts = slideCounts(raw.slides);
        duplicates = groupDuplicates(raw.textBlocks, args.dupMin);
      }
    }
  } finally {
    await page.close();
  }

  const total = counts.reduce((sum, item) => sum + item.chars, 0);
  printCounts(counts, total);

  if (args.baseline) {
    const baseline = JSON.parse(await fs.promises.readFile(path.resolve(args.baseline), "utf8"));
    printBaseline(baselineDiff(counts, baseline.slides));
  }

  process.stdout.write("\nDUPLICATES (information)\n");
  if (duplicates.length === 0) process.stdout.write("none\n");
  for (const duplicate of duplicates) process.stdout.write(`same text on ${duplicate.ids.join(", ")}: ${duplicate.text.slice(0, 40)}\n`);

  if (args.report) {
    const output = path.resolve(args.report);
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await fs.promises.writeFile(output, `${JSON.stringify({ widths: args.widths.map((item) => item.label), slides: counts, total, duplicates, fail, warn }, null, 2)}\n`);
    process.stdout.write(`\nreport: ${output}\n`);
  }
  process.stdout.write("\nNEEDS HUMAN\n- one message per slide\n- a clear hierarchy\n- nothing reads as template filler\n- the phone layout looks intentional\n");
  if (fail.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`check: ${error.message}\n`);
  process.exitCode = 1;
}
