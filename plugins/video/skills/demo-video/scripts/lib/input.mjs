const KEYS = new Map([
  ["Escape", { key: "Escape", code: "Escape", virtualKeyCode: 27 }],
  ["Enter", { key: "Enter", code: "Enter", virtualKeyCode: 13, text: "\r" }],
  ["Tab", { key: "Tab", code: "Tab", virtualKeyCode: 9 }],
  ["Space", { key: " ", code: "Space", virtualKeyCode: 32, text: " " }],
  ["ArrowLeft", { key: "ArrowLeft", code: "ArrowLeft", virtualKeyCode: 37 }],
  ["ArrowUp", { key: "ArrowUp", code: "ArrowUp", virtualKeyCode: 38 }],
  ["ArrowRight", { key: "ArrowRight", code: "ArrowRight", virtualKeyCode: 39 }],
  ["ArrowDown", { key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 }],
  ["PageUp", { key: "PageUp", code: "PageUp", virtualKeyCode: 33 }],
  ["PageDown", { key: "PageDown", code: "PageDown", virtualKeyCode: 34 }],
  ["End", { key: "End", code: "End", virtualKeyCode: 35 }],
  ["Home", { key: "Home", code: "Home", virtualKeyCode: 36 }],
]);

export function keyEvents(key) {
  let description = KEYS.get(key);
  if (!description && typeof key === "string" && [...key].length === 1) {
    const upper = key.toUpperCase();
    description = {
      key,
      code: /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(key) ? `Digit${key}` : key,
      virtualKeyCode: upper.codePointAt(0),
      text: key,
    };
  }
  if (!description) throw new Error(`Unsupported key: ${key}`);
  const common = {
    key: description.key,
    code: description.code,
    windowsVirtualKeyCode: description.virtualKeyCode,
  };
  const down = description.text === undefined
    ? { type: "rawKeyDown", ...common }
    : { type: "keyDown", ...common, text: description.text, unmodifiedText: description.text };
  return [down, { type: "keyUp", ...common }];
}
