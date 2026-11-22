# Sourcing textures and models

## Order of preference

1. Your own scripts: Blender geometry, and procedural materials baked to images.
2. CC0 libraries: Poly Haven (textures, HDRIs, models), ambientCG.
3. Generative 3D (Tripo, Hunyuan3D, TRELLIS and similar), only for a prop family that won a bake-off.
4. Anything with other licence terms, only when the person decides.

Never fetch third-party assets or spend paid credits without the person's approval, and never ship a file that has no manifest entry.

## Poly Haven

- Public API: `https://api.polyhaven.com/assets?t=textures`, `/info/<id>`, `/files/<id>` (download URLs per map and resolution).
- For glTF take the OpenGL normal map (`nor_gl`), plus diffuse, rough, ao (and arm/metal where present) at 1K or 2K.
- Manifest entry: path, `"license": "CC0-1.0"`, `"source"`: the asset page URL, `"author"`: the credited author, `"tool"`: the resolution and maps used.

## Generated meshes: bake-off first

Same prop, same input (prompt or image), same triangle budget, judged at the game camera:
- silhouette and readable detail at play distance;
- triangles after cleanup, and how much cleanup it needed;
- UV usability (seams, stretching, island packing);
- texture quality: melted detail, lighting baked into the albedo, resolution;
- licence and plan terms, checked on the vendor's site on the day.
Pick per prop family. A procedural Blender script often wins for architecture, because puzzle geometry needs exact dimensions.

Manifest entry for a generated mesh: generator and model version, plan, input, date, licence, and the cleanup script that produced the shipped file.

## Tripo (checked 2026-11-22; verify again before paying)

- The API is billed separately from the Studio subscription.
- Free-plan models are public and licensed CC BY 4.0 per Tripo's help pages; third-party sources disagree on commercial use. Paid plans give private models and commercial use.
- P2.0 claims native quad output and face-count targets; no independent topology test was found. Some praise on social media is labelled paid partnership.
- The person sets a credit cap per task; stop at the cap.
