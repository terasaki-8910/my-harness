# Review rubric

Judge every fixed shot against the brief and its three reference images. Each criterion is PASS, FAIL or NEEDS HUMAN, with the shot id and where in the frame. A FAIL names the smallest change that would fix it.

1. Read: the walkable surfaces and interactive objects are the first thing the eye finds; the background is lower in contrast and saturation.
2. Form: silhouettes and edges hold up at play distance (bevels visible, no "box with a texture" look); repetition is broken.
3. Material: each material matches its row in the brief (base colour, roughness variation, wear where the brief puts it); nothing reads as uniform plastic.
4. Light: sun direction, colour temperature, fog and shadow softness agree with the references and between shots.
5. Palette: within the brief; the accent colour appears only where the brief allows.
6. Integrity: no z-fighting, stretched or seamed textures, floating or intersecting parts, blown-out or crushed areas, crawling aliasing.
7. Budget: glb-audit and perf numbers within the brief, taken from the reports, never estimated from images.

Fun, game feel and taste at the real display size are NEEDS HUMAN.

Process notes from FOLD / CITY (2026-11-23):
- The maker's own review twice reported items as met that a fresh reviewer measured as failing (value order, the hanging city). Keep the independent review mandatory, and use a fresh reviewer each round so it is not anchored on its earlier findings.
- Ask the reviewer for measured evidence (pixel coordinates, L* or V values, ratios) and for the single most "cheap" element. The second question finds the next fix faster than the criteria list.
- Review shots that never run the animation show the rest pose. Cloth, hover and walk motion are NEEDS HUMAN unless frames in motion are captured.

Closing the loop (FOLD / CITY background, 2026-11-24: four fresh reviews, all FAIL, while each round fixed most of the previous list):
- A fresh reviewer told to assume faults and list up to 8 always finds 8, so PASS is not reachable that way. The owner's eye is the gate. The loop needs a count of closed findings, not a verdict.
- Findings flip between reviewers. Treat a flip as an owner choice, build both sides behind a URL flag, and do not chase it as a target.
  - Window grids everywhere failed; fading far windows then failed as plain boxes.
  - A ruler-straight slot of sky failed; the next reviewer asked for a crisp straight slot.
  - A muddy veil failed; a lighter haze then failed as no darks.
- Pin numeric targets in a fixed script, given unchanged to maker and reviewer. Two reviewers measuring different regions disagreed on whether the city was darker than the walkway. FOLD / CITY's tone.py checks the brief's value tiers on a play/background/sky mask: the city median at least 8 L* below the play area's median, its p95 below the play area's p90, and the frame's p5 at 25 L* or below.
- For the final round, hand the reviewer every earlier finding and ask fixed, partly fixed, not fixed or regressed for each, then the few new problems and a ship or no-ship call.
- State the camera roles accurately in the prompt: which shots players see most (the follow camera), and which are inspection angles. A prompt that called a sideways inspection angle "seen most" inflated one finding for three rounds.

How to review well:
- Read the brief and the references before the shots.
- Assume there are problems and look for them; a shot that "looks fine" has not been reviewed yet.
- Compare like with like: the same shot id before and after, at the same size.
- Prefer one contact sheet to many single frames.
