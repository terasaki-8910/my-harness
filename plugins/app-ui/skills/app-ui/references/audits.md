# Audits

Each tool sees a different layer. Run them on rendered screens, then judge the flow sheet yourself. Versions are pinned so that results can be compared between rounds; raise a pin on purpose and say so in the plugin README.

| Tool | What it reads | What it catches |
| --- | --- | --- |
| `check.mjs` (this plugin) | each screen rendered at phone size | page errors, overflow, tap targets, text size, contrast, bars covering content, safe areas, more than one filled primary, drift from DESIGN.md, placeholder copy, emoji |
| `designmd lint` (`@google/design.md` 0.4.0) | DESIGN.md | broken references, missing primary or typography, contrast of component pairs, orphaned tokens, section order |
| impeccable 4.10.0 | a page served over HTTP | general signs of generated UI (its own rule set) |
| unslop | source files | signs of generated UI in code, against a rule canon |
| the person, with the flow sheet | the flow | purpose, hierarchy, flow, the twist, taste |

## DESIGN.md lint

```text
npx -y -p @google/design.md@0.4.0 designmd lint DESIGN.md
```

The `-p` form also works on Windows. Exit 1 means an error. Fix contrast warnings; an orphaned-token warning may stay when the token is meant for a later screen.

## impeccable

```text
python -m http.server 8765 --bind 127.0.0.1 --directory <folder with the screens>
npx -y impeccable@4.10.0 detect http://127.0.0.1:8765/<screen path>
```

Scan the served URL, not the file: the file scan does not compute `calc()` and reported false cramped-padding findings on 2026-11-15. Since 4.10 the npm package downloads an engine binary from the project's GitHub releases and checks it against the SHA-256 list it ships (a Windows x64 build is listed). The URL scan has not yet been run on Windows.

## unslop

unslop (github.com/0design/unslop-skill; code MIT, rule texts CC BY 4.0) is a Claude Code and Codex plugin. Its audit reads a rule canon from a third-party MCP server (oleg.design), runs a detector with 37 machine checks over CSS and markup, and writes fix plans to `plans/` without changing code. Installing it connects that server, so it is the person's decision:

```text
claude plugin marketplace add 0design/unslop-skill
claude plugin install unslop@unslop
```

It suits a codebase. Exported Stitch HTML is generated, so findings such as raw hex values, Tailwind palette classes or arbitrary values belong to the Stitch prompts and DESIGN.md, not to hand edits of the file. Its detector has not been run in this harness yet.

## Turning findings into fixes

- In Stitch, each finding becomes one edit prompt (references/stitch.md). Re-export and run the checks again.
- In code, fix the token or component at its source, not the single instance.
- A WARN that stays gets one line in the brief saying why.

## What no tool sees

Whether the first screen says what the app is for, whether one element leads each screen, whether each step leads to the next, whether the twist shows, and whether it looks generated. Read the sheet from `shots.mjs` for these, and show it to the person at the agreed gates.
