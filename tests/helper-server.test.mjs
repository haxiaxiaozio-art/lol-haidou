import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHaidouHelper } from "../helper/server.mjs";
import { augmentMap, gameBelongsToPlayer, itemMap, normalizeSearchIdentity, parseCommandLine, parseHistoryGameIds } from "../helper/lcu.mjs";
import { normalizeHistory } from "../helper/normalize.mjs";

test("champion primary class wins over Tencent ARAM timeline support", () => {
  const player = { puuid: "player-puuid" };
  const participant = {
    participantId: 1,
    championId: 67,
    timeline: { role: "SUPPORT" },
    stats: { playerAugment1: 311 },
  };
  const [match] = normalizeHistory([{ games: { games: [{
    gameId: 103,
    gameMode: "ARAM",
    participantIdentities: [{ participantId: 1, player }],
    participants: [participant],
  }] } }], {
    player,
    champions: new Map([["67", { name: "暗夜猎手", roles: ["marksman", "assassin"] }]]),
    augmentNames: new Map([["311", "终极刷新"]]),
  });

  assert.equal(match.role, "射手");
});

test("uses match position only when champion classes are missing", () => {
  const player = { puuid: "player-puuid" };
  const [match] = normalizeHistory([{ games: { games: [{
    gameId: 104,
    gameMode: "ARAM",
    participantIdentities: [{ participantId: 1, player }],
    participants: [{
      participantId: 1,
      championId: 999,
      timeline: { role: "SUPPORT" },
      stats: { playerAugment1: 311 },
    }],
  }] } }], {
    player,
    champions: new Map([["999", { name: "未知英雄", roles: [] }]]),
    augmentNames: new Map([["311", "终极刷新"]]),
  });

  assert.equal(match.role, "辅助");
});

test("maps Tencent cherry augment names and parses only the current platform history", () => {
  const names = augmentMap([
    { id: 1048, augmentNameId: "ARAM_JeweledGauntlet", nameTRA: "珠光护手" },
  ]);
  assert.equal(names.get("1048"), "珠光护手");

  const log = [
    'Match ids retrieved: ["HN1_111", "WT1_222", "HN1_333"]',
    'Match ids retrieved: ["HN1_111"]',
  ].join("\n");
  assert.deepEqual(parseHistoryGameIds(log, "HN1"), ["111", "333"]);
  assert.equal(gameBelongsToPlayer({
    participantIdentities: [{ player: { puuid: "current-player" } }],
  }, { puuid: "current-player" }), true);
  assert.equal(gameBelongsToPlayer({
    participantIdentities: [{ player: { puuid: "someone-else" } }],
  }, { puuid: "current-player" }), false);
});

test("LCU command line parser tolerates protected process fields", async () => {
  assert.equal(parseCommandLine(null), null);
  assert.equal(parseCommandLine(undefined), null);
  assert.equal(parseCommandLine(""), null);
  assert.deepEqual(
    parseCommandLine('--app-port=54321 --remoting-auth-token="secret" --app-protocol=https'),
    { port: 54321, password: "secret", protocol: "https" },
  );
  assert.deepEqual(
    parseCommandLine("000000.000| OKAY| Command line arguments: --region=TENCENT --rso_platform_id=HN1 --remoting-auth-token=secret --app-port=60202"),
    { port: 60202, password: "secret", protocol: "https", platformId: "HN1" },
  );
  const launcher = await readFile(new URL("../start-helper.cmd", import.meta.url), "utf8");
  assert.match(launcher, /-Verb RunAs/);
  assert.match(launcher, /taskkill\.exe/);
  assert.doesNotMatch(launcher, /-FilePath '%HAIDOU_NODE%'/);
  assert.doesNotMatch(launcher, /\^\| Select-Object/);
});

test("maps local client item ids to localized names", () => {
  const names = itemMap([{ id: 3031, name: "无尽之刃" }]);
  assert.equal(names.get("3031"), "无尽之刃");
});

test("normalizes an exact Riot ID before player lookup", () => {
  assert.deepEqual(normalizeSearchIdentity("  夜航船  ", "#0927"), {
    gameName: "夜航船",
    tagLine: "0927",
  });
  assert.throws(() => normalizeSearchIdentity("夜", "0927"), /游戏名/);
  assert.throws(() => normalizeSearchIdentity("夜航船", "1"), /尾标/);
});

test("local helper exposes health and protects private routes", async (context) => {
  const server = createHaidouHelper();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.service, "haidou-local-helper");
  assert.equal(healthBody.version, 11);
  assert.equal(healthBody.installMode, "node");

  const blocked = await fetch(`${base}/v1/session`, { method: "POST" });
  assert.equal(blocked.status, 403);

  const session = await fetch(`${base}/v1/session`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
  });
  assert.equal(session.status, 200);
  assert.match((await session.json()).token, /^[A-Za-z0-9_-]+$/);
});
