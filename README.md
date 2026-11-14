# ai-harness

`ai-harness` is a personal Claude Code plugin marketplace following a personal harness design guide (2026-11-07): keep what loads every turn small, enforce rules with hooks and permissions instead of prose, and verify output with checks that run outside the model. v0.1 contains only the `core` plugin. Domain plugins (game/3D, video, documents) are added later one at a time under `plugins/<name>/`, enabled only in projects that use them, and kept only if measurements improve.

## What loads every turn

| Component | Path | Context cost |
| --- | --- | --- |
| guard hook | `hooks/` | none: runs outside the model; only a block reason reaches Claude. |
| verifier agent | `agents/verifier.md` | its one-line description every turn; the body only when called, in a separate context. |
| templates and init script | `templates/`, `scripts/` | none: copied into projects. |
| eval case | `evals/` | none: run by `claude plugin eval`. |

## Requirements

- Claude Code (built with 2.1.325; `claude plugin eval` needs 2.1.269 or later).
- Node.js 20 or later on every environment, because the hook is a Node script.

## Install

Install once per environment. Native Windows and WSL2 are separate installs.

```text
claude plugin marketplace add <path-to-this-repo>
claude plugin install core@ai-harness
```

After pushing to GitHub, `<owner>/<repo>` can replace `<path-to-this-repo>`. The same commands work inside a session as `/plugin marketplace add ...` and `/plugin install core@ai-harness`.

Update and then restart Claude Code:

```text
claude plugin marketplace update ai-harness
claude plugin update core@ai-harness
```

Installing from the marketplace has not been tested yet; only `--plugin-dir` has.

## Develop

`claude --plugin-dir .` loads this checkout without installing.

```text
node --test
claude plugin validate .
claude --plugin-dir . plugin details core
claude plugin eval . --runs 1 --allow-tools Write --no-publish
```

Record the `plugin details` result in `docs/measurements.md`. Use one eval run while tuning; the default of 3 runs is for decisions. `--no-publish` keeps the report local. The first run asks you to trust the plugin.

## Guard hook

The defaults block reading or writing `.env` and `.env.*`, except `.env.example`, `.env.sample` and `.env.template`. They also block writing inside `.git` or to `.claude/guard.json`. Covered tools are Read, Grep (its path), Edit, Write, MultiEdit and NotebookEdit. A block stops the tool call (exit code 2), and the reason goes to Claude.

Per-project additions go in `.claude/guard.json`:

```json
{ "secrets": ["*.pem", "*.key"], "readOnly": ["assets/master/**"], "allow": [".env.test"] }
```

Patterns without `/` match the file name at any depth. A leading `**/` means anywhere. Any other pattern containing `/` is relative to the project root. Matching ignores case, and `allow` wins over everything. Claude cannot edit `guard.json` itself because it is read-only by default. An invalid `guard.json` leaves the defaults on and prints a warning on every call until fixed.

Not covered in v0.1: Bash and PowerShell commands (for example `cat .env`) and symbolic links. Permission rules do not catch these reliably either, so use the sandbox (macOS, Linux, WSL2; native Windows has none) or review `git status` at the end of a turn.

## Verifier agent

Call the verifier once at the end of a feature, not after every step. Pass the check commands, artifact paths and optionally one section of `docs/quality-gates.md`. It replies with a verdict (PASS, FAIL or INCOMPLETE) and per-check PASS / FAIL / NOT RUN / NEEDS HUMAN. Stop after 3 fix rounds; this is a design choice from the guide, not an official limit.

## Templates

```text
node scripts/init-project.mjs <project-dir>
```

This creates `AGENTS.md`, `CLAUDE.md` (which imports `AGENTS.md`), `.claude/settings.json`, `.gitattributes` and `docs/quality-gates.md`, and never overwrites existing files. `templates/user/settings.json.tmpl` holds `permissions.disableBypassPermissionsMode: "disable"` for the user settings file; merge it by hand. The settings template's `Read(.env.*)` deny also blocks reading `.env.example`; remove that rule if a project needs it.

## Measure, then add

Following the guide:

1. Day 1: record `/context`, `/usage` and one fixed task per area.
2. Week 1: use core only.
3. Then add one domain plugin at a time. Suggested order: web game, video, Unity or Unreal, app. Run the fixed task 3 times before and after, and remove the plugin if nothing improves.
4. Monthly, run `/skill-doctor` and `/doctor` and remove what is unused.
5. When the model changes, rerun the fixed tasks and evals with `--model` fixed.

## Not confirmed in official docs or not tested

- The repository root as both marketplace and plugin (`marketplace.json` and `plugin.json` side by side, `"source": "./"`): the docs show a plugin at the marketplace root with `"source": "./"`, but the pages read do not state this two-manifest layout. Installing from the marketplace has not been run.
- Hook behavior on native Windows (Git Bash or PowerShell), WSL2 and Ubuntu: not run; only macOS was tested. The docs say `${CLAUDE_PLUGIN_ROOT}` is substituted (with forward slashes on Windows) and also exported as an environment variable.
- The tool input fields of MultiEdit and NotebookEdit (`file_path`, `notebook_path`) are not documented on the pages read; the guard checks both names.
- Read and Grep path checks do not catch every way file content can reach the model (for example, Grep over a whole directory).
- The 3-round limit and "at most 6 images" are design choices, not official numbers. LF line endings via .gitattributes is common practice, not from the Claude Code docs.
- The verifier uses only the frontmatter keys name, description, tools and model; other documented keys (for example `omitClaudeMd`, `maxTurns`) were not tested.
- Plugins cannot ship permission rules: no page read documents a plugin-level settings file for permissions, so permissions live in the templates.
