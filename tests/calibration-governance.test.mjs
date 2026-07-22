import assert from "node:assert/strict";
import test from "node:test";
import { CALIBRATION_ROLES, defaultCalibrationModel } from "../lib/calibration-core.mjs";
import {
  CALIBRATION_POLICY_VERSION,
  calibrationCohortBucket,
  detectCalibrationAnomaly,
  evaluateCalibrationCandidate,
  selectCalibrationRelease,
} from "../lib/calibration-governance.mjs";

const role = CALIBRATION_ROLES[1];
const normalSample = {
  id: "a".repeat(64),
  matchHash: "b".repeat(64),
  playedAt: "2026-07-20T00:00:00.000Z",
  patch: "26.14",
  role,
  secondaryRole: null,
  dimensions: [1500, 1.8, 0.48, 0.72],
  secondaryScore: null,
  operationScore: 72,
  deathsPerTen: 4.5,
  recallApplied: false,
  won: true,
};

test("normal calibration sample passes anomaly policy", () => {
  const result = detectCalibrationAnomaly(normalSample);
  assert.equal(result.action, "accept");
  assert.equal(result.score, 0);
  assert.equal(result.policyVersion, CALIBRATION_POLICY_VERSION);
});

test("conflicting extreme sample is quarantined with explainable reasons", () => {
  const result = detectCalibrationAnomaly({
    ...normalSample,
    dimensions: [0, 0, 0, 0],
    operationScore: 99,
    deathsPerTen: 28,
  });
  assert.equal(result.action, "quarantine");
  assert.ok(result.reasons.some((reason) => reason.code === "EMPTY_DIMENSIONS"));
  assert.ok(result.reasons.some((reason) => reason.code === "DEATH_RATE_EXTREME"));
});

test("candidate guardrails reject excessive parameter drift", () => {
  const active = defaultCalibrationModel();
  const candidate = structuredClone(active);
  candidate.version = "candidate-extreme";
  candidate.totalSamples = 500;
  candidate.roles[0].expected[0] *= 1.5;
  const result = evaluateCalibrationCandidate(candidate, active);
  assert.equal(result.safe, false);
  assert.ok(result.reasons.some((reason) => reason.includes("28%")));
});

test("gray release uses deterministic anonymous cohort buckets", () => {
  const active = defaultCalibrationModel();
  const candidate = { ...structuredClone(active), version: "candidate-safe" };
  assert.equal(calibrationCohortBucket("same-cohort"), calibrationCohortBucket("same-cohort"));
  assert.equal(selectCalibrationRelease(active, candidate, "same-cohort", 0).model.version, active.version);
  assert.equal(selectCalibrationRelease(active, candidate, "same-cohort", 100).model.version, candidate.version);
});
