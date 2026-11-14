# ai-harness

Personal Claude Code plugin marketplace. The repository root is also the `core` plugin. README.md is the spec.

## Commands
- Test: `node --test`
- Validate manifests, agents and skills: `claude plugin validate .`
- Always-on token cost: `claude --plugin-dir . plugin details core`
- Eval (uses plan quota): `claude plugin eval . --runs 1 --allow-tools Write --no-publish`

## Rules
- Hooks and scripts: Node 20+ standard library only (no npm dependencies, no bash or jq). They must work on native Windows, WSL2, macOS and Ubuntu: handle paths as strings with forward slashes and call scripts as `node <file>.mjs`.
- Skill and agent descriptions load every turn: one line each, saying only when to use it.
- Core holds only what every project needs. Domain plugins (game/3D, video, docs) go under `plugins/<name>/` with their own entry in marketplace.json and are enabled per project.
- Before adding or changing a component, record its always-on cost in docs/measurements.md. Keep it only if the fixed tasks improve.
- Files under templates/ end in `.tmpl`; scripts/init-project.mjs strips the suffix when copying.
- Bump `version` in .claude-plugin/plugin.json for changes that other machines should receive.
