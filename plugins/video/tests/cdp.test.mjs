import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CdpConnection } from "../skills/demo-video/scripts/lib/cdp.mjs";

function harness() {
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const writes = [];
  outgoing.on("data", (chunk) => writes.push(chunk.toString()));
  return { incoming, outgoing, writes, cdp: new CdpConnection(incoming, outgoing) };
}

test("CDP handles split responses, joined messages, ids and session events", async () => {
  const { incoming, writes, cdp } = harness();
  const first = cdp.send("Page.enable", {}, "page-1");
  await new Promise((resolve) => setImmediate(resolve));
  const request = JSON.parse(writes.join("").split("\0")[0]);
  assert.equal(request.sessionId, "page-1");
  const events = [];
  cdp.on("Page.loadEventFired", (params, sessionId) => events.push({ params, sessionId }));
  const payload = `${JSON.stringify({ id: request.id, result: { ok: true } })}\0${JSON.stringify({ method: "Page.loadEventFired", params: { at: 1 }, sessionId: "page-1" })}\0`;
  incoming.write(payload.slice(0, 7));
  incoming.write(payload.slice(7));
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(events, [{ params: { at: 1 }, sessionId: "page-1" }]);
});

test("CDP rejects protocol errors and pending calls on close", async () => {
  const { incoming, writes, cdp } = harness();
  const failed = cdp.send("Bad.method");
  await new Promise((resolve) => setImmediate(resolve));
  const firstId = JSON.parse(writes.join("").split("\0")[0]).id;
  incoming.write(`${JSON.stringify({ id: firstId, error: { message: "no such method" } })}\0`);
  await assert.rejects(failed, /no such method/);
  const pending = cdp.send("Never.answers");
  incoming.end();
  await assert.rejects(pending, /pipe closed/);
});

test("CDP calls time out and remove their pending reply", async () => {
  const { incoming, writes, cdp } = harness();
  const pending = cdp.send("Runtime.evaluate", {}, "page-1", { timeout: 0.01 });
  await assert.rejects(pending, /CDP Runtime\.evaluate timed out after 0\.01 s/);
  const id = JSON.parse(writes.join("").split("\0")[0]).id;
  incoming.write(`${JSON.stringify({ id, result: { late: true } })}\0`);
  cdp.close();
});
