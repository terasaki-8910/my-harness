import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templateDir = fileURLToPath(new URL("../templates/project/", import.meta.url));

function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(sourcePath, relativePath));
    if (entry.isFile()) files.push({ sourcePath, relativePath });
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stderr.write("Usage: node scripts/init-project.mjs <target-dir>\n");
    process.exitCode = 1;
    return;
  }

  const targetDir = args[0];
  let stats;
  try {
    stats = fs.statSync(targetDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stderr.write(`Target directory does not exist: ${targetDir}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    process.stderr.write(`Target is not a directory: ${targetDir}\n`);
    process.exitCode = 1;
    return;
  }

  for (const file of collectFiles(templateDir)) {
    const destinationRelative = file.relativePath.replace(/\.tmpl$/, "");
    const displayPath = destinationRelative.replaceAll(path.sep, "/");
    const destinationPath = path.join(targetDir, destinationRelative);
    if (fs.existsSync(destinationPath)) {
      process.stdout.write(`skip ${displayPath} (exists)\n`);
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(file.sourcePath, destinationPath);
    process.stdout.write(`create ${displayPath}\n`);
  }

  process.stdout.write("Next: fill in the <...> placeholders in AGENTS.md and docs/quality-gates.md.\n");
  process.exitCode = 0;
}

try {
  main();
} catch (error) {
  process.stderr.write(`init-project: ${error.message}\n`);
  process.exitCode = 1;
}
