@AGENTS.md

## Claude Code
- Check hook changes in a real session with `claude --plugin-dir .`. Add `--setting-sources project,local` so user-level hooks do not mask the result, and look for the core guard's own message ("Blocked by core guard").
