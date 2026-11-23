# Working in Google Stitch

Stitch (stitch.google.com) generates UI screens from natural-language prompts. Read on 2026-11-23 from Google's posts, the DESIGN.md repository (google-labs-code/design.md) and the SDK README (google-labs-code/stitch-sdk); the Stitch docs pages render client-side and could not be read.

Stated by those sources:
- Stitch reads and writes DESIGN.md, an open draft format (version alpha; `@google/design.md` 0.4.0 has eight sections: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts).
- Screens can be linked and played as a prototype ("Play"), and Stitch can generate the next screen from a click.
- An MCP server (`https://stitch.googleapis.com/mcp`) and an SDK (`@google/stitch-sdk`, labelled "not an officially supported Google product") use an API key created in Stitch's settings. The SDK can generate, edit and vary screens and return their HTML and image.

Not confirmed: the menu steps for importing DESIGN.md, the layout of an exported screen, whether the HTML loads the Tailwind CDN, Google Fonts or remote images, usage limits, and how well Japanese prompts work. Check them on the first project and record what you find in the plugin README.

## Who sends the prompts

When the work is the person's (an assignment, a portfolio piece), Claude drafts the prompts and the person sends them in Stitch. Driving Stitch through the MCP server or the SDK needs the person's decision and their API key.

## Setting up a project

1. A new mobile (app) project.
2. Load the approved DESIGN.md. If no import is offered, paste its tokens and its Do's and Don'ts into the first prompt.
3. Keep every screen of the flow in this project, so the design system applies to all of them.

## First prompt for a screen

Write in English and put the UI text in Japanese inside quotes. Keep it under about 150 words and follow this order:

```text
Mobile app screen for <app>: <who>, <scene>, wants to <goal>.
Screen <n> of <total>, "<screen name>", answers: <the screen's question>.
Top to bottom: <regions, in order>.
Content: <the real content from the brief>.
The only filled button is "<label>", in the primary color. Other actions are text or outlined buttons.
Follow DESIGN.md. No gradients, glass or blur effects, emoji, or placeholder text.
```

Generate the next screen from the previous one or with the same structure, then check that it still follows DESIGN.md.

## Edit prompts

Make one change per prompt. Name the element by its visible text and its position, and give the target. "Make it cleaner" or "more modern" invites a new generic layout.

| Finding | Edit prompt |
| --- | --- |
| target | Make the back icon button at the top left 44 x 44 pt. |
| contrast | Use on-surface-variant (#5F5F5F) for the date under each title. |
| primary | Keep only "予約する" as a filled button; make "共有" a text button. |
| token-color | Replace the purple "NEW" badge with the primary color, or remove it. |
| token-size, token-font | Use body-md for the review text; no other size. |
| fixed-cover | Add bottom padding so the last row scrolls above the tab bar. |
| safe-area | Move the header below the status bar. |
| placeholder | Replace "John Doe" with "佐藤 遥" and the price with "¥12,800". |

## Comparing directions

Before the flow, generate 2 or 3 variants of the first screen when the direction is open (the SDK names its ranges REFINE, EXPLORE and REIMAGINE). Choose against the brief, not by which looks best on the canvas.

## Prompt log

Record each prompt in `prompts.md`: date, screen, the prompt as sent, what changed. It supports the note on AI use and lets a screen be rebuilt.

## Export

For the checks, export each screen's HTML into `screens/<id>/` and point `flow.json` at it. For a Figma prototype, copy the screens to Figma. For the demo, either record Stitch's or Figma's own prototype, or record the exported screens with the video plugin; the person chooses.
