import test from "node:test";
import assert from "node:assert/strict";
import { buildRatingGraph } from "../helper/rating-network.mjs";

function rawGame(id, time, winningTeam = 100) {
  return {
    gameId: id,
    gameCreation: time,
    gameVersion: "16.14.1",
    participantIdentities: Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1,
      player: { puuid: `raw-puuid-${index}`, gameName: `VisibleName${index}` },
    })),
    participants: Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1,
      teamId: index < 5 ? 100 : 200,
      stats: { win: (index < 5 ? 100 : 200) === winningTeam },
    })),
  };
}

test("rating graph contains only anonymous match relationships", () => {
  const newer = rawGame("9002", Date.UTC(2026, 6, 2));
  const older = rawGame("9001", Date.UTC(2026, 6, 1));
  const graph = buildRatingGraph([newer, older], { puuid: "raw-puuid-0" }, "HN1", ["9001", "9002"]);
  assert.ok(graph);
  assert.equal(graph.matches.length, 2);
  assert.equal(graph.matches[0].playedAt, new Date(Date.UTC(2026, 6, 1)).toISOString());
  assert.match(graph.targetHash, /^[a-f0-9]{64}$/);
  assert.equal(graph.matches[0].participants.length, 10);
  const serialized = JSON.stringify(graph);
  assert.equal(serialized.includes("raw-puuid"), false);
  assert.equal(serialized.includes("VisibleName"), false);
  assert.equal(serialized.includes("9001"), false);
});

test("rating graph rejects incomplete participant data", () => {
  const game = rawGame("9003", Date.UTC(2026, 6, 3));
  game.participantIdentities.pop();
  const graph = buildRatingGraph([game], { puuid: "raw-puuid-0" }, "HN1", ["9003"]);
  assert.equal(graph.matches.length, 0);
});
