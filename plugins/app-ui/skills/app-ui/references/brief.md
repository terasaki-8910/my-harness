# Deciding the UI brief

Decide in this order. Each part limits the next, and choosing colours before the flow invites decoration in place of purpose.

## 1. Job

Write one sentence: "When <scene>, <who> opens the app to <goal>, because <what today's apps miss>." If it needs "and", there are two apps; pick one.

- Who is one concrete person, not a segment: their situation and what they use today.
- The scene sets the layout: one hand on a train, two hands at a desk, ten seconds or ten minutes.
- The twist is the one idea that makes the app the person's own. It must serve the goal and be visible in the demo. A dark mode, a chatbot added on top, or "AI" in the name is not a twist. Removing a step the person hates, or showing something no other app shows at that moment, is.

## 2. Main flow

- 3 to 5 screens. Each answers one question ("Which one fits me?", "Is it really OK?") and has one primary action.
- The first screen says what the app is for through its content, without a tutorial. No onboarding carousel, sign-up or splash screen in a 20 to 30 s demo; start at the value.
- After each primary action, the next screen shows what changed (a selection, a saved item, a result).
- Add an empty, error or done state only when it carries the story.

## 3. Content

Write the real content before generating anything: names, places, prices with units, dates, the longest name, a two-line title. Real content sets line lengths and density. Without it, the generator invents "John Doe" and "Item 1", and the layout is judged on text that will never ship.

## 4. Platform

Pick iOS or Android and follow its conventions; do not mix them.

| | iOS (HIG) | Android (Material 3) |
| --- | --- | --- |
| Top-level navigation | tab bar, 3 to 5 labelled items | navigation bar, 3 to 5 destinations |
| Screen header | navigation bar with back; large title on top-level screens | top app bar |
| Secondary tasks | sheets | bottom sheets, dialogs |
| One primary action | a filled button near the bottom | a filled button, or a FAB when it is the screen's main action |
| Tap target | 44 x 44 pt | 48 x 48 dp |
| Body text | 17 pt | 14 to 16 sp |
| Safe areas | status bar about 59 pt on current iPhones; home indicator 34 pt | status bar 24 dp; gesture area at the bottom |

Keep the primary action in the bottom half, where one thumb reaches it.

## 5. References

Choose 2 or 3 apps. For each, write one concrete thing to take and one thing not to take, for example: take "a dense list where the content is the interface"; do not take "the brand colour". Taking a whole look is copying, not a reference.

## 6. Direction

Give each choice a one-line reason tied to the job.

- Colour: neutrals carry the layout; one accent marks the primary action and selection; status colours appear only for status. Keep neutrals purely grey. The DESIGN.md lint checks contrast for component pairs.
- Type: one family that covers Japanese and Latin (for example Noto Sans JP, BIZ UDPGothic, IBM Plex Sans JP, M PLUS 1p), chosen for the tone. 5 to 7 sizes; 2 or 3 weights.
- Shape and depth: one radius scale; either flat with dividers, or one elevation level. Do not mix sharp and round corners on one screen.
- Spacing: a 4 or 8 px base, a 16 or 20 px screen margin, grouping by proximity.
- Motion: only for a change of state or place; at most 300 ms; ease-out; nothing moves under reduced motion.

## 7. Banned looks

Start from the person's UI rules (for example ~/.claude/rules/ui.md) and add the app's own. Generated screens often show: purple or indigo gradients, glass cards and blur, emoji in headings, grids of icon tiles, a large centred hero on a phone, stock photos of smiling people, every card at the same weight, and stock copy such as "Unlock your potential" or "Seamless experience".

## 8. Storyboard

Plan 20 to 30 s: 0 to 5 s show the purpose (screen 1); then 3 or 4 taps of the main flow, 3 to 6 s each, one action per beat; finish on the result for 3 to 5 s. Show the twist at least once. Leave no dead time.

## Approval

The person approves the brief. Only then set its Status line to approved, with the date.
