import assert from "node:assert/strict";
import test from "node:test";
import { createHaidouHelper } from "../helper/server.mjs";

test("local helper exposes health and protects private routes", async (context) => {
  const server = createHaidouHelper();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.service, "haidou-local-helper");
  assert.equal(healthBody.version, 2);

  const blocked = await fetch(`${base}/v1/session`, { method: "POST" });
  assert.equal(blocked.status, 403);

  const session = await fetch(`${base}/v1/session`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
  });
  assert.equal(session.status, 200);
  assert.match((await session.json()).token, /^[A-Za-z0-9_-]+$/);
});
