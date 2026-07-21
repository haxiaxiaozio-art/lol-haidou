import assert from "node:assert/strict";
import test from "node:test";
import { buildCalibrationSample, defaultCalibrationModel } from "../lib/calibration-core.mjs";

const match = {
  id: "raw-client-match-id",
  playedAt: "2026-07-20T00:00:00.000Z",
  patch: "26.14",
  champion: "莫甘娜",
  role: "辅助",
  secondaryRole: "法师",
  win: true,
  durationMinutes: 20,
  kills: 6,
  deaths: 5,
  assists: 24,
  metrics: {
    damage: 28000,
    controlSeconds: 62,
    healing: 4500,
    shielding: 8200,
    mitigated: 9000,
    damageTaken: 22000,
    selfHealing: 1800,
    gold: 13000,
  },
  augments: ["珠光护手"],
  items: ["中娅沙漏"],
};

test("calibration sample keeps scoring signals but removes player-facing content", () => {
  const sample = buildCalibrationSample(match, "a".repeat(64), "b".repeat(64));
  assert.equal(sample.id, "a".repeat(64));
  assert.equal(sample.matchHash, "b".repeat(64));
  assert.equal(sample.role, "辅助");
  assert.equal(sample.secondaryRole, "法师");
  assert.equal(sample.dimensions.length, 4);
  assert.ok(sample.operationScore > 0 && sample.operationScore <= 100);
  assert.equal("champion" in sample, false);
  assert.equal("augments" in sample, false);
  assert.equal("items" in sample, false);
});

test("baseline calibration model is versioned and requires 100 samples per role", () => {
  const model = defaultCalibrationModel();
  assert.equal(model.version, "rules-2026.07");
  assert.equal(model.minimumRoleSamples, 100);
  assert.equal(model.roles.length, 6);
  assert.ok(model.roles.every((role) => role.samples === 0 && role.expected.length === 4));
});
