import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseSyncError } from "../helper/diagnostics.mjs";
import { historyGames } from "../helper/lcu.mjs";
import { isUnifiedHistoryGame, toUnifiedHistoryGame } from "../helper/match-model.mjs";
import { normalizeHistory } from "../helper/normalize.mjs";
import {
  extractEntitlementsAccessToken,
  querySgpHistory,
  resolveTencentSgpServer,
  SgpUnavailableError,
} from "../helper/sgp.mjs";

test("maps supported Tencent platforms to their local SGP endpoint", () => {
  assert.deepEqual(resolveTencentSgpServer("HN1"), {
    id: "TENCENT_HN1",
    subId: "HN1",
    baseUrl: "https://hn1-k8s-sgp.lol.qq.com:21019",
  });
  assert.equal(resolveTencentSgpServer(undefined, { webRegion: "HN10" })?.subId, "HN10");
  assert.equal(resolveTencentSgpServer("UNKNOWN"), null);
});

test("accepts only a usable entitlements token", () => {
  assert.equal(extractEntitlementsAccessToken({ accessToken: "a".repeat(32) }), "a".repeat(32));
  assert.throws(
    () => extractEntitlementsAccessToken({ accessToken: "short" }),
    (error) => error instanceof SgpUnavailableError && error.code === "SGP_TOKEN_UNAVAILABLE",
  );
});

test("classifies sync failures into five actionable diagnostic categories", () => {
  const cases = [
    ["CLIENT_NOT_LOGGED", "client-login"],
    ["SGP_REGION_UNSUPPORTED", "region-unavailable"],
    ["LCU_TIMEOUT", "interface-timeout"],
    ["SGP_AUTH_FAILED", "permission-denied"],
    ["MATCH_FIELD_MISSING", "field-missing"],
  ];
  for (const [code, category] of cases) {
    const diagnostic = diagnoseSyncError(Object.assign(new Error(code), { code }), "sgp");
    assert.equal(diagnostic.category, category);
    assert.ok(diagnostic.suggestion.length > 8);
  }
});

test("queries SGP in bounded pages without exposing the token in paths or results", async () => {
  const requests = [];
  const token = "secret-token-that-stays-local";
  const result = await querySgpHistory({
    credentials: { platformId: "HN1" },
    player: { puuid: "player-puuid" },
    region: { webRegion: "HN1" },
    count: 40,
    lcuRequest: async (_credentials, path) => {
      assert.equal(path, "/entitlements/v1/token");
      return { accessToken: token };
    },
    request: async (server, receivedToken, path) => {
      requests.push({ server, receivedToken, path });
      const startIndex = Number(new URL(path, "https://local.invalid").searchParams.get("startIndex"));
      return {
        games: Array.from({ length: 20 }, (_, index) => ({
          json: { gameId: 1000 - startIndex - index, gameCreation: 10_000 - startIndex - index },
        })),
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].server.subId, "HN1");
  assert.equal(requests[0].receivedToken, token);
  assert.match(requests[1].path, /startIndex=20/);
  assert.equal(requests.some((entry) => entry.path.includes(token)), false);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.length, 40);
});

test("converts SGP and LCU payloads into the same internal match model", () => {
  const shared = {
    gameId: 123,
    gameCreation: 1_720_000_000_000,
    gameDuration: 1200,
    gameMode: "ARAM",
    gameVersion: "16.14.1",
    mapId: 12,
    queueId: 450,
  };
  const lcu = toUnifiedHistoryGame({
    ...shared,
    participantIdentities: [{ participantId: 1, player: { puuid: "player" } }],
    participants: [{
      participantId: 1,
      teamId: 100,
      championId: 22,
      stats: { win: true, kills: 12, deaths: 4, assists: 18, playerAugment1: 311 },
    }],
  }, "lcu");
  const sgp = toUnifiedHistoryGame({
    json: {
      ...shared,
      participants: [{
        participantId: 1,
        puuid: "player",
        teamId: 100,
        championId: 22,
        win: true,
        kills: 12,
        deaths: 4,
        assists: 18,
        playerAugment1: 311,
      }],
    },
  }, "sgp");
  const comparable = (game) => ({
    gameId: game.gameId,
    gameMode: game.gameMode,
    queueId: game.queueId,
    puuid: game.participants[0].puuid,
    teamId: game.participants[0].teamId,
    championId: game.participants[0].championId,
    stats: game.participants[0].stats,
  });

  assert.equal(isUnifiedHistoryGame(lcu), true);
  assert.equal(isUnifiedHistoryGame(sgp), true);
  assert.deepEqual(comparable(sgp), comparable(lcu));
  const scoringContext = {
    player: { puuid: "player" },
    champions: new Map([["22", { name: "艾希", roles: ["Marksman", "Assassin"] }]]),
    augmentNames: new Map([["311", "终极刷新"]]),
    itemNames: new Map(),
  };
  assert.deepEqual(
    normalizeHistory([[sgp]], scoringContext),
    normalizeHistory([[lcu]], scoringContext),
  );
});

test("falls back from SGP to LCU and then local logs while deduplicating matches", async () => {
  const result = await historyGames({}, { puuid: "player" }, {}, 2, {
    sgp: async () => { throw Object.assign(new Error("temporary outage"), { code: "SGP_TIMEOUT" }); },
    lcu: async () => [{ gameId: 20, gameCreation: 20 }],
    logs: async () => [
      { gameId: 20, gameCreation: 20 },
      { gameId: 10, gameCreation: 10 },
    ],
  });

  assert.deepEqual(result.games.map((game) => game.gameId), [20, 10]);
  assert.equal(result.games.every(isUnifiedHistoryGame), true);
  assert.deepEqual(result.historySources, ["lcu", "logs"]);
  assert.deepEqual(result.sourceCounts, { sgp: 0, lcu: 1, logs: 1 });
  assert.match(result.fallbackReasons[0], /SGP/);
  assert.equal(result.diagnostics[0].category, "interface-timeout");
  assert.equal(result.diagnostics[0].severity, "warning");
});

test("reports missing match fields before invalid source data can reach scoring", async () => {
  const result = await historyGames({}, { puuid: "player" }, {}, 1, {
    sgp: async () => [{ participants: [] }],
    lcu: async () => [],
    logs: async () => [],
  });
  assert.equal(result.games.length, 0);
  assert.equal(result.diagnostics[0].category, "field-missing");
  assert.equal(result.diagnostics[0].severity, "error");
});
