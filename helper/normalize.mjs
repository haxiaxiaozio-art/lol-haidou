const ROLE_MAP = {
  support: "辅助",
  mage: "法师",
  assassin: "刺客",
  tank: "坦克",
  marksman: "射手",
  fighter: "战士",
};

const ROLE_KEYS = ["support", "mage", "assassin", "tank", "marksman", "fighter"];

const numberValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const gameList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.games?.games)) return payload.games.games;
  if (Array.isArray(payload?.games)) return payload.games;
  if (Array.isArray(payload?.matches)) return payload.matches;
  return [];
};

const playerKeys = (player) => new Set([
  player?.puuid,
  player?.accountId,
  player?.summonerId,
  player?.id,
].filter(Boolean).map(String));

function locateParticipant(game, player) {
  const participants = game?.participants ?? game?.participantList ?? [];
  const identities = game?.participantIdentities ?? game?.identities ?? [];
  const keys = playerKeys(player);

  const direct = participants.find((participant) => {
    const values = [participant?.puuid, participant?.accountId, participant?.summonerId, participant?.player?.puuid, participant?.player?.accountId];
    return values.some((value) => value !== undefined && keys.has(String(value)));
  });
  if (direct) return direct;

  const identity = identities.find((item) => {
    const candidate = item?.player ?? item;
    return [candidate?.puuid, candidate?.accountId, candidate?.currentAccountId, candidate?.summonerId]
      .some((value) => value !== undefined && keys.has(String(value)));
  });
  if (identity?.participantId !== undefined) {
    return participants.find((participant) => participant?.participantId === identity.participantId);
  }

  return participants.length === 1 ? participants[0] : undefined;
}

function augmentIds(participant) {
  const stats = participant?.stats ?? participant ?? {};
  const candidates = [
    ...(Array.isArray(participant?.augments) ? participant.augments : []),
    ...(Array.isArray(stats?.augments) ? stats.augments : []),
    stats.playerAugment1,
    stats.playerAugment2,
    stats.playerAugment3,
    stats.playerAugment4,
    stats.playerAugment5,
    stats.playerAugment6,
  ];
  return [...new Set(candidates
    .map((value) => typeof value === "object" ? firstValue(value?.id, value?.augmentId, value?.name) : value)
    .filter((value) => value !== undefined && value !== null && String(value) !== "0" && String(value).trim() !== "")
    .map(String))];
}

function itemIds(participant) {
  const stats = participant?.stats ?? participant ?? {};
  const arrayItems = Array.isArray(participant?.items)
    ? participant.items
    : Array.isArray(stats?.items)
      ? stats.items
      : [];
  const candidates = arrayItems.length ? arrayItems : [
    stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5,
  ];
  return candidates
    .map((value) => typeof value === "object" ? firstValue(value?.id, value?.itemId) : value)
    .filter((value) => value !== undefined && value !== null && String(value) !== "0")
    .map(String);
}

function rolesForChampion(champion, participant) {
  const classify = (candidates) => {
    const roles = [];
    for (const value of candidates) {
      if (!value) continue;
      const candidate = String(value).toLowerCase();
      const selected = ROLE_KEYS.find((role) => candidate.includes(role));
      const mapped = selected ? ROLE_MAP[selected] : null;
      if (mapped && !roles.includes(mapped)) roles.push(mapped);
    }
    return roles;
  };

  const championRoles = classify(Array.isArray(champion?.roles) ? champion.roles : []);
  if (championRoles.length) {
    return { role: championRoles[0], secondaryRole: championRoles[1] };
  }

  const positionRole = classify([
    participant?.teamPosition,
    participant?.individualPosition,
    participant?.timeline?.role,
  ])[0] ?? "战士";
  return { role: positionRole };
}

function augmentLabel(id, augmentNames) {
  const name = augmentNames?.get?.(String(id)) ?? augmentNames?.[String(id)];
  return name ? String(name) : `海克斯 ${id}`;
}

function itemLabel(id, itemNames) {
  const name = itemNames?.get?.(String(id)) ?? itemNames?.[String(id)];
  return name ? String(name) : `装备 ${id}`;
}

function isHaidou(game, augments) {
  if (augments.length === 0) return false;
  const mode = String(firstValue(game?.gameMode, game?.mode, game?.gameType, "")).toUpperCase();
  const queueId = numberValue(firstValue(game?.queueId, game?.queue?.id), -1);
  const mapId = numberValue(game?.mapId, -1);
  return mode.includes("ARAM") || queueId === 450 || mapId === 12;
}

function gameTime(game) {
  const raw = firstValue(game?.gameCreation, game?.gameStartTimestamp, game?.gameStartTime, game?.timestamp, Date.now());
  const timestamp = numberValue(raw, Date.now());
  return new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp).toISOString();
}

function durationMinutes(game, stats) {
  const seconds = numberValue(firstValue(game?.gameDuration, stats?.timePlayed, stats?.gameDuration), 0);
  if (seconds > 0) return Math.round((seconds / 60) * 10) / 10;
  return 0.1;
}

export function normalizeMatch(game, context) {
  const participant = locateParticipant(game, context.player);
  if (!participant) return null;
  const stats = participant.stats ?? participant;
  const augments = augmentIds(participant);
  if (!isHaidou(game, augments)) return null;

  const championId = String(firstValue(participant?.championId, stats?.championId, ""));
  const champion = context.champions?.get?.(championId) ?? {};
  const championName = firstValue(participant?.championName, champion?.name, champion?.alias, championId ? `英雄 ${championId}` : "未知英雄");
  const gameVersion = String(firstValue(game?.gameVersion, game?.version, "未知版本"));
  const patchParts = gameVersion.split(".");
  const roles = rolesForChampion(champion, participant);

  return {
    id: String(firstValue(game?.gameId, game?.id, `${Date.now()}-${championId}`)),
    playedAt: gameTime(game),
    patch: patchParts.length >= 2 ? `${patchParts[0]}.${patchParts[1]}` : gameVersion,
    champion: String(championName),
    ...roles,
    win: Boolean(firstValue(stats?.win, participant?.win, false)),
    durationMinutes: durationMinutes(game, stats),
    kills: numberValue(stats?.kills),
    deaths: numberValue(stats?.deaths),
    assists: numberValue(stats?.assists),
    metrics: {
      damage: numberValue(firstValue(stats?.totalDamageDealtToChampions, stats?.damageDealtToChampions)),
      controlSeconds: numberValue(firstValue(stats?.timeCCingOthers, stats?.totalTimeCCDealt, stats?.totalTimeCrowdControlDealt)),
      healing: numberValue(firstValue(stats?.totalHealsOnTeammates, stats?.totalHealOnTeammates)),
      shielding: numberValue(firstValue(stats?.totalDamageShieldedOnTeammates, stats?.damageShieldedOnTeammates)),
      mitigated: numberValue(firstValue(stats?.damageSelfMitigated, stats?.totalDamageMitigated)),
      damageTaken: numberValue(stats?.totalDamageTaken),
      selfHealing: numberValue(firstValue(stats?.totalHeal, stats?.totalSelfHeal)),
      gold: numberValue(stats?.goldEarned),
    },
    augments: augments.map((id) => augmentLabel(id, context.augmentNames)),
    items: itemIds(participant).map((id) => itemLabel(id, context.itemNames)),
  };
}

export function normalizeHistory(payloads, context) {
  const games = payloads.flatMap(gameList);
  const seen = new Set();
  const matches = [];
  for (const game of games) {
    const match = normalizeMatch(game, context);
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    matches.push(match);
  }
  return matches.sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
}

export function buildPlayerDataset({ player, region, matches }) {
  return {
    schemaVersion: 1,
    source: "local-client",
    player: {
      gameName: String(firstValue(player?.gameName, player?.displayName, "当前玩家")),
      tag: String(firstValue(player?.tagLine, region?.webRegion, region?.region, "CN")),
      region: String(firstValue(region?.webRegion, region?.region, region?.locale, "国服")),
      updatedAt: new Date().toISOString(),
    },
    matches,
  };
}

export function extractGames(payload) {
  return gameList(payload);
}
