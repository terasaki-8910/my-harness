#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const starter = fileURLToPath(new URL("../starter/", import.meta.url));
const names = (await fs.promises.readdir(starter, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .toSorted();

async function main(argv) {
  if (argv.length !== 1) throw new Error("Usage: new.mjs <dir>");
  const destination = path.resolve(argv[0]);
  const existing = names.filter((name) => fs.existsSync(path.join(destination, name)));
  if (existing.length > 0) {
    process.stderr.write(`Refusing to overwrite existing files:\n${existing.map((name) => `- ${path.join(destination, name)}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  await fs.promises.mkdir(destination, { recursive: true });
  for (const name of names) await fs.promises.copyFile(path.join(starter, name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
  for (const name of names) process.stdout.write(`${path.join(destination, name)}\n`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`new: ${error.message}\n`);
  process.exitCode = 1;
}
