# Writing the art brief

The brief is the fixed target that every review compares against. Without it, reviews turn into taste, each round drifts back to the generic default look, and "make it less cheap" never converges.

## References

- Use real photographs or finished production art of the target look, seen at roughly the game camera's distance. Concept sketches and AI images are weak references: they hide how materials behave under light.
- Exactly three, each with its own job unless the person says otherwise: material and wear, light and atmosphere, form and silhouette.
- For each one, write what to take and what not to take. Example: "take the travertine's warm grey and soft roughness variation; do not take the tourist clutter or the wide-angle distortion".
- Record source URL, author and licence in docs/art/refs/README.md. References are internal working material; ship them only if their licence allows it.

## Value structure first

Decide what is brightest, middle and darkest in a typical frame before choosing colours. In a game the walkable path and the interactive objects must read first; the background sits lower in contrast and saturation. Most "cheap" scenes fail here, not in texture resolution.

## Materials

One row per material, with measurable ranges: base colour (sRGB range), roughness range, metallic, and wear stated as cause and place:
- feet: walkway centre lines smoother and slightly darker, edges dustier;
- hands: handrails and console grips darker and glossier;
- water: streaks below ledges and sills, grime at the foot of walls;
- sun: faded colour on exposed tops.
Random noise without a cause reads as fake dirt.

## Light and atmosphere

Time of day; sun elevation, azimuth and colour; sky or HDRI; fog by distance band (near, play area, background); the tone-mapping candidates to compare against the references; exposure.

## Forms

Bevel widths, trim and cornice profiles, column and railing language, how often an identical piece may repeat before it needs a variant, and which details are geometry (they change the silhouette at play distance) versus normal map.

## Camera and shots

Field of view, typical distance, and the fixed review shots: id and what each must show. These are the shots `shots.mjs` captures. Say which shots players see most (the follow camera) and which are inspection angles, so reviews weigh them correctly.

Backdrops folded or curved around the play area (FOLD / CITY, 2026-11-24):
- A city surface that faces the main camera head-on reads as a map, however detailed: roofs, streets and dots of trees seen from above. A wall of city straight ahead of the play camera did this.
- Curl the surface across the main camera's view axis, so its walls run alongside the view and show facades at grazing angles. Example: a canyon, then walls creased at right angles, then a tube.
- Measure it with a debug view that paints the backdrop by the angle between view ray and surface normal. The roof-on share fell from 20-23 % to 0 % in the play shots.
- Views turned sideways still see a wall square-on. Show such views to the owner as a known trade-off.

## Banned looks

Concrete failures to avoid, taken from the current build: untextured boxes, uniform roughness, noise-only dirt, glow on everything, default purple gradients, salt-and-pepper window dots, identical pieces in long rows.

## Budgets

Provisional numbers marked as provisional until measured on the target device class: first download, triangles on screen, draw calls, texture size and total, frame time p95.

## Approval

The person approves the brief before modelling starts. Any later change to it is their decision, recorded with the date.
