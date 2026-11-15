#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { evaluate, openPage, resolvePage } from "./lib/browser.mjs";
import { parseShotsArguments } from "./lib/checks.mjs";
import { safeFilePart, sheetHtml } from "./lib/sheets.mjs";
import { startServer } from "./lib/server.mjs";

async function captureSlides(url, viewport, selector, output) {
  const opened = await openPage({ url, ...viewport });
  try {
    const count = await evaluate(opened.chrome.cdp, opened.sessionId, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
    if (!count) throw new Error(`No slides found with selector: ${selector}`);
    const tiles = [];
    for (let index = 0; index < count; index += 1) {
      const info = await evaluate(opened.chrome.cdp, opened.sessionId, `(async()=>{
        const slide=document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        slide.scrollIntoView({block:"start",behavior:"instant"});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const rect=slide.getBoundingClientRect();
        return {id:slide.id||"slide-${index + 1}",x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height:rect.height,viewportHeight:innerHeight};
      })()`);
      const id = safeFilePart(info.id, `slide-${index + 1}`);
      const name = `${String(index + 1).padStart(2, "0")}-${id}.png`;
      const screenshot = await opened.chrome.cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: info.height > info.viewportHeight,
        clip: { x: Math.max(0, info.x), y: Math.max(0, info.y), width: Math.ceil(info.width), height: Math.ceil(info.height), scale: 1 },
      }, opened.sessionId);
      await fs.promises.writeFile(path.join(output, name), Buffer.from(screenshot.data, "base64"));
      tiles.push({ id: info.id, src: `${viewport.label}/${name}` });
    }
    return tiles;
  } finally {
    await opened.chrome.close();
  }
}

async function drawSheet(output, viewport, tiles) {
  const htmlName = `.sheet-${viewport.label}.html`;
  const htmlPath = path.join(output, htmlName);
  const sheetPath = path.join(output, `sheet-${viewport.label}.png`);
  await fs.promises.writeFile(htmlPath, sheetHtml({ title: viewport.label, tiles }));
  const server = await startServer(output);
  let opened;
  try {
    opened = await openPage({ url: `http://127.0.0.1:${server.port}/${encodeURIComponent(htmlName)}`, width: 1200, height: 800 });
    const size = await evaluate(opened.chrome.cdp, opened.sessionId, `(()=>{const rect=document.body.getBoundingClientRect();return {width:Math.ceil(rect.width),height:Math.ceil(rect.height)}})()`);
    await opened.chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, opened.sessionId);
    await evaluate(opened.chrome.cdp, opened.sessionId, "new Promise(resolve=>requestAnimationFrame(resolve))");
    const screenshot = await opened.chrome.cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    }, opened.sessionId);
    await fs.promises.writeFile(sheetPath, Buffer.from(screenshot.data, "base64"));
    return sheetPath;
  } finally {
    await Promise.allSettled([opened?.chrome.close(), server.close()]);
    await fs.promises.rm(htmlPath, { force: true });
  }
}

async function main() {
  const args = parseShotsArguments(process.argv.slice(2));
  const output = path.resolve(args.out);
  await fs.promises.mkdir(output, { recursive: true });
  const page = await resolvePage(args.page);
  const sheets = [];
  try {
    for (const viewport of args.widths) {
      const directory = path.join(output, viewport.label);
      await fs.promises.mkdir(directory, { recursive: true });
      const tiles = await captureSlides(page.url, viewport, args.slides, directory);
      sheets.push(await drawSheet(output, viewport, tiles));
    }
  } finally {
    await page.close();
  }
  for (const sheet of sheets) process.stdout.write(`${sheet}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`shots: ${error.message}\n`);
  process.exitCode = 1;
}
