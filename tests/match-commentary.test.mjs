import test from "node:test";
import assert from "node:assert/strict";
import { buildMatchCommentary } from "../lib/match-commentary.mjs";

test("recall deaths receive a specific sharp improvement note", () => {
  const commentary = buildMatchCommentary({
    score: 54,
    survivalScore: 20,
    recallApplied: true,
    dimensions: [{ label: "队友护盾", score: 65 }],
    match: { id: "COMMENT-RECALL", role: "辅助", kills: 2, deaths: 8, assists: 18, recall: { deathsAfter: 6 } },
  });
  assert.match(commentary.improvement, /回城海克斯/);
  assert.match(commentary.improvement, /6 次/);
});

test("commentary is deterministic for the same match", () => {
  const scored = {
    score: 83,
    survivalScore: 72,
    recallApplied: false,
    dimensions: [{ label: "英雄伤害", score: 80 }, { label: "有效控制", score: 64 }],
    match: { id: "COMMENT-STABLE", role: "法师", win: true, kills: 12, deaths: 5, assists: 20 },
  };
  assert.deepEqual(buildMatchCommentary(scored), buildMatchCommentary(scored));
});
