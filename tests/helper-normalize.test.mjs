import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerDataset, normalizeHistory } from "../helper/normalize.mjs";

const player = { puuid: "player-puuid", gameName: "夜航船", tagLine: "0927" };
const participant = (augment) => ({
  participantId: 1,
  championId: 22,
  stats: {
    win: true,
    kills: 12,
    deaths: 4,
    assists: 18,
    totalDamageDealtToChampions: 32100,
    timeCCingOthers: 44,
    totalHealsOnTeammates: 500,
    totalDamageShieldedOnTeammates: 900,
    damageSelfMitigated: 4100,
    totalDamageTaken: 12000,
    totalHeal: 2200,
    goldEarned: 14800,
    playerAugment1: augment,
  },
});

const baseGame = {
  gameMode: "ARAM",
  queueId: 450,
  mapId: 12,
  gameVersion: "16.14.1.1234",
  gameCreation: 1_720_000_000_000,
  gameDuration: 1_200,
  participantIdentities: [{ participantId: 1, player: { puuid: player.puuid } }],
};

test("normalizes the current player and keeps only augment ARAM matches", () => {
  const matches = normalizeHistory([{ games: { games: [
    { ...baseGame, gameId: 101, participants: [participant(311)] },
    { ...baseGame, gameId: 102, participants: [participant(0)] },
  ] } }], {
    player,
    champions: new Map([["22", { name: "艾希", roles: ["Marksman"] }]]),
    augmentNames: new Map([["311", "终极刷新"]]),
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "101");
  assert.equal(matches[0].champion, "艾希");
  assert.equal(matches[0].role, "射手");
  assert.deepEqual(matches[0].augments, ["终极刷新"]);
  assert.equal(matches[0].metrics.damage, 32100);
  assert.equal(matches[0].durationMinutes, 20);
});

test("builds a browser-ready local client dataset", () => {
  const dataset = buildPlayerDataset({
    player,
    region: { webRegion: "HN1" },
    matches: [],
  });
  assert.equal(dataset.source, "local-client");
  assert.equal(dataset.player.gameName, "夜航船");
  assert.equal(dataset.player.tag, "0927");
  assert.equal(dataset.player.region, "HN1");
});
