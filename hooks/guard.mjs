import { decide, loadConfig } from "./guard-lib.mjs";

async function main() {
  let rawInput = "";
  for await (const chunk of process.stdin) rawInput += chunk;

  let input;
  try {
    input = JSON.parse(rawInput);
  } catch (error) {
    process.stderr.write(`core guard: could not parse hook input: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const { rules, warnings } = loadConfig(projectDir);
  const decision = decide(input, { projectDir, rules });

  if (decision.action === "deny") {
    process.stderr.write(`${decision.reason}\n`);
    for (const warning of warnings) process.stderr.write(`core guard: ${warning}\n`);
    process.exitCode = 2;
    return;
  }

  if (warnings.length > 0) {
    for (const warning of warnings) process.stderr.write(`core guard: ${warning}\n`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`core guard: internal error: ${error.message}\n`);
  process.exitCode = 1;
}
