import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScoringSnapshot } from "../lib/replay-report.mjs";
import { defaultCalibrationModel } from "../lib/calibration-core.mjs";

test("JSON reports preserve a valid historical scoring snapshot", () => {
  const model = { ...defaultCalibrationModel(), version: "community-v3-p26_14-test", patch: "26.14" };
  const snapshot = normalizeScoringSnapshot({ modelVersion: model.version, scoredAt: "2026-07-20T12:00:00.000Z", model });
  assert.equal(snapshot?.modelVersion, model.version);
  assert.equal(snapshot?.model.patch, "26.14");
});
