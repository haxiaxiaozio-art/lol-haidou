import assert from "node:assert/strict";
import test from "node:test";
import { combineRoleScores } from "../lib/role-scoring.mjs";

test("secondary role adds a 40 percent bonus instead of averaging down the primary score", () => {
  assert.deepEqual(combineRoleScores(72, 64), {
    primaryScore: 72,
    secondaryScore: 64,
    secondaryBonus: 26,
    total: 98,
  });
});

test("dual-role positive score is capped at 100", () => {
  assert.deepEqual(combineRoleScores(80, 70), {
    primaryScore: 80,
    secondaryScore: 70,
    secondaryBonus: 28,
    total: 100,
  });
});

test("single-role score remains unchanged", () => {
  assert.deepEqual(combineRoleScores(72), {
    primaryScore: 72,
    secondaryScore: null,
    secondaryBonus: 0,
    total: 72,
  });
});
