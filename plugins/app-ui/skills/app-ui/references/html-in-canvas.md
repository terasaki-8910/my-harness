# HTML-in-Canvas in a demo

HTML-in-Canvas draws live, interactive DOM into a canvas (2D, WebGL or WebGPU). Chrome made it stable in Chrome 157 (Chrome for Developers, 2026-10-26). Stitch does not use it, and an app UI does not need it. In this harness it is only for presenting a prototype in a demo.

## API (Chrome 155 and later names)

- Opt in: `<canvas content="drawable">`; the children to draw carry `drawable`. The earlier name was the `layoutsubtree` attribute.
- 2D: `ctx.drawElementImage(element, dx, dy[, dwidth, dheight])` inside the canvas `paint` event (`CanvasPaintEvent.changedElements`); `canvas.requestPaint()` asks for one. Hit testing follows the drawn position in 2D.
- WebGL: `gl.texElementSubImage2D(target, level, x, y, element)` into a texture allocated first. WebGPU: `queue.drawElementImageToTexture(source, destination)`. Under a 3D transform, keep hit testing right with `canvas.updateElementGeometry(element, { canvasTransform })`.
- Output: `toDataURL()`, `toBlob()` and `captureStream()`.
- Feature check, from Google's docs:

```js
const probe = document.createElement("canvas");
probe.setAttribute("content", "drawable");
const supported = probe.content === "drawable";
```

## Checked here

On 2026-11-23, Windows 11, Chrome 158.0.8127.36, through the video plugin's headless CDP path (default backend and `--use-angle=gl`): the feature check was true, and `drawElementImage` in the paint event drew a DOM element (pixel read back). Outside the paint event it threw "No cached paint record for element". With `--headless --disable-gpu --dump-dom` no paint event fired. Edge 159 is installed but was not tested.

## Support

Chrome and Edge 157 or later only, according to the announcement; Safari and Firefox do not have it. A demo that uses it is recorded as video, or shown live in Chrome or Edge.

## When to use it

Only when it shows something about the app that plain screens cannot, for example the live prototype on a device that turns once to reveal the next screen, or one wipe from before to after. Write the purpose into the storyboard first.

- One effect per demo; it never runs while the viewer reads.
- Without support, or under `prefers-reduced-motion: reduce`, show the plain DOM screen.
- No showpiece effects that the person's UI rules ban (glass, blur, jelly, shatter, liquid).
- Check the recorded frames with the video plugin's `check.mjs` and look at them: a headless paint can differ from a headed one.
