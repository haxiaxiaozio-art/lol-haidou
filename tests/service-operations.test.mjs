import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitBucket, routePolicy, shouldRecordHealth } from "../lib/service-operations.ts";

test("rate limit policies protect write endpoints more strictly", () => {
  assert.equal(routePolicy("/api/rating", "POST").limit, 30);
  assert.equal(routePolicy("/api/calibration", "POST").limit, 10);
  assert.equal(routePolicy("/api/calibration", "GET").limit, 120);
  assert.equal(routePolicy("/api/calibration/governance", "POST").limit, 10);
});

test("rate limit buckets are anonymous and deterministic per minute", async () => {
  const request = new Request("https://rating.example/api/rating", { headers: { "CF-Connecting-IP": "203.0.113.7" } });
  const first = await rateLimitBucket(request, "rating:post", "test-salt", 120_000);
  const second = await rateLimitBucket(request, "rating:post", "test-salt", 120_999);
  const nextMinute = await rateLimitBucket(request, "rating:post", "test-salt", 180_000);
  assert.equal(first, second);
  assert.notEqual(first, nextMinute);
  assert.doesNotMatch(first, /203\.0\.113\.7/);
});

test("health telemetry keeps only slow, throttled, and failed requests", () => {
  assert.equal(shouldRecordHealth(200, 150), false);
  assert.equal(shouldRecordHealth(200, 2_100), true);
  assert.equal(shouldRecordHealth(429, 20), true);
  assert.equal(shouldRecordHealth(503, 20), true);
});
