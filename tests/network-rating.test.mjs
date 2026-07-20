import test from "node:test";
import assert from "node:assert/strict";
import { defaultRatingState, expectedWinRate, ratingEstimate, updateMatchRatings } from "../lib/network-rating.mjs";

const match = (winningTeam = "100") => ({
  participants: Array.from({ length: 10 }, (_, index) => ({
    id: `p${index}`,
    team: index < 5 ? "100" : "200",
    won: (index < 5 ? "100" : "200") === winningTeam,
  })),
});

test("equal new teams receive symmetric and bounded updates", () => {
  const updated = updateMatchRatings(match(), new Map());
  assert.equal(Math.round(updated.get("p0").rating * 10) / 10, 1516.8);
  assert.equal(Math.round(updated.get("p5").rating * 10) / 10, 1483.2);
  assert.equal(updated.get("p0").games, 1);
  assert.equal(updated.get("p0").wins, 1);
});

test("beating a stronger team earns more than beating an equal team", () => {
  const equal = new Map(Array.from({ length: 10 }, (_, index) => [`p${index}`, { rating: 1500, deviation: 70, games: 100, wins: 50 }]));
  const stronger = new Map(equal);
  for (let index = 5; index < 10; index += 1) stronger.set(`p${index}`, { rating: 1700, deviation: 70, games: 100, wins: 50 });
  const equalGain = updateMatchRatings(match(), equal).get("p0").rating - 1500;
  const upsetGain = updateMatchRatings(match(), stronger).get("p0").rating - 1500;
  assert.ok(upsetGain > equalGain);
  assert.ok(expectedWinRate(1500, 1700) < 0.5);
});

test("estimate exposes a range, confidence and stability state", () => {
  assert.equal(ratingEstimate(defaultRatingState()).status, "calibrating");
  const estimate = ratingEstimate({ rating: 1624.4, deviation: 88, games: 80, wins: 46 });
  assert.equal(estimate.rating, 1624);
  assert.equal(estimate.status, "stable");
  assert.ok(estimate.low < estimate.rating && estimate.high > estimate.rating);
  assert.ok(estimate.confidence >= 80);
});
