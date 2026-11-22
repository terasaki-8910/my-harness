import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { auditGlb, parseGlb } from "../skills/game3d/scripts/lib/glb.mjs";
import { blenderCommandLine, findBlender, killProcessTree, parseBlenderArguments, parseBlenderVersion, runBlender } from "../skills/game3d/scripts/lib/blender.mjs";

function fakeFileSystem(files, directories = {}) {
  const known = new Set(files);
  return { exists: (candidate) => known.has(candidate), readdir: (directory) => directories[directory] ?? [] };
}

const WINDOWS_ENV = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)" };
const PF = "C:/Program Files/Blender Foundation";
const PF86 = "C:/Program Files (x86)/Blender Foundation";

test("findBlender on Windows prefers the highest version by number, not by text", () => {
  const fileSystem = fakeFileSystem(
    [`${PF}/Blender 4.4/blender.exe`, `${PF}/Blender 5.2/blender.exe`, `${PF}/Blender 4.9/blender.exe`, `${PF}/Blender 4.10/blender.exe`],
    { [PF]: ["Blender 4.4", "Blender 4.9", "Blender 5.2", "Blender 4.10", "Other"] },
  );
  const found = findBlender({ env: WINDOWS_ENV, platform: "win32", pathDirs: [], ...fileSystem });
  assert.equal(found.path, `${PF}/Blender 5.2/blender.exe`);

  const withoutFive = fakeFileSystem([`${PF}/Blender 4.9/blender.exe`, `${PF}/Blender 4.10/blender.exe`], { [PF]: ["Blender 4.9", "Blender 4.10"] });
  assert.equal(findBlender({ env: WINDOWS_ENV, platform: "win32", pathDirs: [], ...withoutFive }).path, `${PF}/Blender 4.10/blender.exe`);
});

test("findBlender on Windows merges both Program Files folders before sorting", () => {
  const fileSystem = fakeFileSystem([`${PF}/Blender 4.4/blender.exe`, `${PF86}/Blender 5.2/blender.exe`], { [PF]: ["Blender 4.4"], [PF86]: ["Blender 5.2"] });
  const found = findBlender({ env: WINDOWS_ENV, platform: "win32", pathDirs: [], ...fileSystem });
  assert.equal(found.path, `${PF86}/Blender 5.2/blender.exe`);
});

test("findBlender lists a missing BLENDER_BIN in tried and keeps searching", () => {
  const fileSystem = fakeFileSystem([`${PF}/Blender 4.4/blender.exe`], { [PF]: ["Blender 4.4"] });
  const found = findBlender({ env: { ...WINDOWS_ENV, BLENDER_BIN: "D:\\gone\\blender.exe" }, platform: "win32", pathDirs: [], ...fileSystem });
  assert.equal(found.path, `${PF}/Blender 4.4/blender.exe`);
  assert.deepEqual(found.tried.slice(0, 2), ["D:/gone/blender.exe", `${PF}/Blender 4.4/blender.exe`]);
});

test("findBlender: the flag wins over BLENDER_BIN and defaults, and a missing flag falls through", () => {
  const fileSystem = fakeFileSystem(["E:/tools/blender.exe", "D:/env/blender.exe", `${PF}/Blender 4.4/blender.exe`], { [PF]: ["Blender 4.4"] });
  const env = { ...WINDOWS_ENV, BLENDER_BIN: "D:\\env\\blender.exe" };
  assert.equal(findBlender({ flag: "E:\\tools\\blender.exe", env, platform: "win32", pathDirs: [], ...fileSystem }).path, "E:/tools/blender.exe");
  const fallback = findBlender({ flag: "E:/missing/blender.exe", env, platform: "win32", pathDirs: [], ...fileSystem });
  assert.equal(fallback.path, "D:/env/blender.exe");
  assert.deepEqual(fallback.tried, ["E:/missing/blender.exe", "D:/env/blender.exe"]);
});

test("findBlender falls back to PATH and reports everything tried when nothing exists", () => {
  const onPath = findBlender({ env: WINDOWS_ENV, platform: "win32", pathDirs: ["C:\\tools\\bin\\"], ...fakeFileSystem(["C:/tools/bin/blender.exe"]) });
  assert.equal(onPath.path, "C:/tools/bin/blender.exe");

  const none = findBlender({ env: WINDOWS_ENV, platform: "win32", pathDirs: ["C:/tools/bin"], ...fakeFileSystem([]) });
  assert.equal(none.path, null);
  assert.deepEqual(none.tried, ["C:/tools/bin/blender.exe"]);
});

test("findBlender checks the macOS app bundles, then PATH", () => {
  const app = "/Applications/Blender.app/Contents/MacOS/Blender";
  const user = "/Users/me/Applications/Blender.app/Contents/MacOS/Blender";
  assert.equal(findBlender({ env: { HOME: "/Users/me" }, platform: "darwin", pathDirs: [], ...fakeFileSystem([app, user]) }).path, app);
  assert.equal(findBlender({ env: { HOME: "/Users/me" }, platform: "darwin", pathDirs: [], ...fakeFileSystem([user]) }).path, user);
  const viaPath = findBlender({ env: { HOME: "/Users/me" }, platform: "darwin", pathDirs: ["/opt/homebrew/bin"], ...fakeFileSystem(["/opt/homebrew/bin/blender"]) });
  assert.equal(viaPath.path, "/opt/homebrew/bin/blender");
  assert.deepEqual(viaPath.tried, [app, user, "/opt/homebrew/bin/blender"]);
});

test("findBlender checks the Linux locations, then PATH from the environment", () => {
  assert.equal(findBlender({ env: {}, platform: "linux", pathDirs: [], ...fakeFileSystem(["/usr/bin/blender", "/usr/local/bin/blender"]) }).path, "/usr/bin/blender");
  assert.equal(findBlender({ env: {}, platform: "linux", pathDirs: [], ...fakeFileSystem(["/snap/bin/blender", "/usr/bin/blender"]) }).path, "/snap/bin/blender");
  const viaEnv = findBlender({ env: { PATH: "/home/me/blender:/usr/sbin" }, platform: "linux", ...fakeFileSystem(["/home/me/blender/blender"]) });
  assert.equal(viaEnv.path, "/home/me/blender/blender");
});

test("parseBlenderVersion reads the first line of blender --version", () => {
  const output = "Blender 4.4.3\n\tbuild date: 2025-04-29\n\tbuild time: 15:39:58\n\tbuild commit date: 2025-04-29\n\tbuild commit time: 14:09\n\tbuild hash: 802179c51ccc\n\tbuild platform: Windows\n\tbuild type: release\n";
  assert.equal(parseBlenderVersion(output), "4.4.3");
  assert.equal(parseBlenderVersion(output.replace(/\n/g, "\r\n")), "4.4.3");
  assert.equal(parseBlenderVersion("\nBlender 5.2.0 Alpha\n\tbuild date: x\n"), "5.2.0");
  assert.equal(parseBlenderVersion("Python 3.12.1"), null);
  assert.equal(parseBlenderVersion(""), null);
});

test("blender arguments: script, options and everything after -- for the script", () => {
  assert.deepEqual(parseBlenderArguments(["make.py", "--blender", "b.exe", "--timeout", "30", "--log", "run.log", "--", "--out", "x.glb", "--blender"]), {
    which: false,
    blender: "b.exe",
    script: "make.py",
    timeoutSec: 30,
    log: "run.log",
    args: ["--out", "x.glb", "--blender"],
  });
  assert.equal(parseBlenderArguments(["--which"]).which, true);
  assert.equal(parseBlenderArguments(["make.py"]).timeoutSec, 600);
  for (const invalid of [[], ["--timeout", "0", "a.py"], ["a.py", "--timeout"], ["a.py", "b.py"], ["a.py", "--bad"]]) assert.throws(() => parseBlenderArguments(invalid));
  assert.deepEqual(blenderCommandLine({ script: "s.py", args: ["a", "b"] }), ["--background", "--factory-startup", "--python-exit-code", "1", "--python", "s.py", "--", "a", "b"]);
});

function sink() {
  const chunks = [];
  return { chunks, write: (chunk) => (chunks.push(String(chunk)), true), text: () => chunks.join("") };
}

function fakeSpawn(behavior) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 4242;
    calls.push({ command, args, options, child });
    setImmediate(() => behavior(child));
    return child;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}

function exits(code, { stdout = [], stderr = [] } = {}) {
  return async (child) => {
    const ended = Promise.all([once(child.stdout, "end"), once(child.stderr, "end")]);
    for (const chunk of stdout) {
      child.stdout.write(chunk);
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const chunk of stderr) {
      child.stderr.write(chunk);
      await new Promise((resolve) => setImmediate(resolve));
    }
    child.stdout.end();
    child.stderr.end();
    await ended;
    child.emit("close", code, null);
  };
}

test("runBlender returns 0 on a clean exit, runs without a shell and streams the output", async () => {
  const spawnImpl = fakeSpawn(exits(0, { stdout: ["Blender 4.4.3\n"], stderr: ["warning only\n"] }));
  const out = sink();
  const err = sink();
  const outcome = await runBlender({ blender: "C:/b/blender.exe", script: "make.py", args: ["--out", "x.glb"], spawnImpl, stdout: out, stderr: err });
  assert.equal(outcome.code, 0);
  assert.equal(outcome.sawTraceback, false);
  assert.equal(typeof outcome.seconds, "number");
  assert.equal(out.text(), "Blender 4.4.3\n");
  assert.equal(err.text(), "warning only\n");
  const [call] = spawnImpl.calls;
  assert.equal(call.command, "C:/b/blender.exe");
  assert.deepEqual(call.args, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", "make.py", "--", "--out", "x.glb"]);
  assert.notEqual(call.options.shell, true);
});

test("runBlender turns a Python traceback into code 1 even when the exit code is 0", async () => {
  const stderr = ["Traceback (most recent call last):\n", '  File "make.py", line 1\n', "RuntimeError: boom\n"];
  const outcome = await runBlender({ blender: "b", script: "s.py", spawnImpl: fakeSpawn(exits(0, { stderr })), stdout: sink(), stderr: sink() });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.sawTraceback, true);
});

test("runBlender finds a traceback marker split across two chunks", async () => {
  const stdout = ["Traceback (most recent ", "call last):\n"];
  const outcome = await runBlender({ blender: "b", script: "s.py", spawnImpl: fakeSpawn(exits(0, { stdout })), stdout: sink(), stderr: sink() });
  assert.equal(outcome.sawTraceback, true);
  assert.equal(outcome.code, 1);
});

test("runBlender maps any non-zero exit to code 1", async () => {
  for (const code of [1, 255]) {
    const outcome = await runBlender({ blender: "b", script: "s.py", spawnImpl: fakeSpawn(exits(code)), stdout: sink(), stderr: sink() });
    assert.equal(outcome.code, 1);
    assert.equal(outcome.sawTraceback, false);
  }
});

test("runBlender kills the tree and returns 124 when the child never exits", async () => {
  const spawnImpl = fakeSpawn(() => {});
  const killed = [];
  const outcome = await runBlender({ blender: "b", script: "s.py", timeoutSec: 0.2, spawnImpl, killTree: (child) => killed.push(child.pid), stdout: sink(), stderr: sink() });
  assert.equal(outcome.code, 124);
  assert.deepEqual(killed, [4242]);
  assert.ok(outcome.seconds >= 0.1);
});

test("runBlender reports 124 when the killed child closes before the kill finishes", async () => {
  const spawnImpl = fakeSpawn(() => {});
  const outcome = await runBlender({
    blender: "b",
    script: "s.py",
    timeoutSec: 0.1,
    spawnImpl,
    killTree: (child) => {
      child.emit("close", 1, null);
    },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(outcome.code, 124);
});

test("runBlender copies the output to the log file and creates its folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-log-"));
  try {
    const log = path.join(dir, "nested", "run.log");
    const spawnImpl = fakeSpawn(exits(0, { stdout: ["to stdout\n"], stderr: ["to stderr\n"] }));
    await runBlender({ blender: "b", script: "s.py", log, spawnImpl, stdout: sink(), stderr: sink() });
    const content = fs.readFileSync(log, "utf8");
    assert.match(content, /to stdout/);
    assert.match(content, /to stderr/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runBlender rejects when the executable cannot be started", async () => {
  const spawnImpl = fakeSpawn((child) => child.emit("error", new Error("spawn ENOENT")));
  await assert.rejects(runBlender({ blender: "missing", script: "s.py", spawnImpl, stdout: sink(), stderr: sink() }), /ENOENT/);
});

test("killProcessTree uses taskkill /T /F on Windows and SIGKILL elsewhere", async () => {
  const taskkills = [];
  const taskkill = (command, args) => {
    taskkills.push([command, ...args]);
    const killer = new EventEmitter();
    setImmediate(() => killer.emit("close", 0));
    return killer;
  };
  await killProcessTree({ pid: 77, kill: () => assert.fail("must not signal directly") }, { platform: "win32", spawnImpl: taskkill });
  assert.deepEqual(taskkills, [["taskkill", "/pid", "77", "/T", "/F"]]);

  const signals = [];
  await killProcessTree({ pid: 78, kill: (signal) => signals.push(signal) }, { platform: "linux", spawnImpl: taskkill });
  assert.deepEqual(signals, ["SIGKILL"]);
  assert.equal(taskkills.length, 1);
});

const CUBE_SCRIPT = `import sys
import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2.0)
cube = bpy.context.active_object
if not cube.data.uv_layers:
    cube.data.uv_layers.new(name="UVMap")

image = bpy.data.images.new("gate_test", width=4, height=4, alpha=True)
image.pixels = [0.2, 0.4, 0.8, 1.0] * 16
image.pack()

material = bpy.data.materials.new("GateTest")
material.use_nodes = True
nodes = material.node_tree.nodes
links = material.node_tree.links
texture = nodes.new("ShaderNodeTexImage")
texture.image = image
links.new(texture.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
cube.data.materials.append(material)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
`;

const found = findBlender({});

test("integration: a real Blender exports a textured cube that the GLB audit reads", async (t) => {
  if (!found.path) {
    t.skip(`Blender not found; tried ${found.tried.join(", ")}`);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game3d-blender-"));
  try {
    const script = path.join(dir, "make_cube.py");
    const output = path.join(dir, "cube.glb").replace(/\\/g, "/");
    fs.writeFileSync(script, CUBE_SCRIPT);
    const out = sink();
    const err = sink();
    const outcome = await runBlender({ blender: found.path, script, args: [output], timeoutSec: 300, stdout: out, stderr: err });
    assert.equal(outcome.code, 0, `${out.text()}\n${err.text()}`);
    assert.equal(outcome.sawTraceback, false);

    const buffer = fs.readFileSync(output);
    const metrics = auditGlb(parseGlb(buffer), { fileBytes: buffer.length, dir });
    assert.equal(metrics.triangles, 12);
    assert.equal(metrics.drawCalls, 1);
    assert.equal(metrics.textures.length, 1);
    assert.equal(metrics.textures[0].width, 4);
    assert.deepEqual(metrics.textures[0].slots, ["baseColor"]);
    assert.deepEqual(metrics.missingUVs, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
