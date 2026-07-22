const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const identityValue = (identity, participant, key) => firstValue(
  identity?.[key],
  identity?.player?.[key],
  participant?.[key],
  participant?.player?.[key],
);

function identityMap(game) {
  const identities = Array.isArray(game?.participantIdentities)
    ? game.participantIdentities
    : Array.isArray(game?.identities)
      ? game.identities
      : [];
  return new Map(identities.map((identity) => [String(identity?.participantId ?? ""), identity]));
}

function participantStats(participant) {
  if (participant?.stats && typeof participant.stats === "object") return { ...participant.stats };
  const stats = { ...(participant ?? {}) };
  for (const key of [
    "participantId", "puuid", "accountId", "currentAccountId", "summonerId",
    "gameName", "tagLine", "summonerName", "player", "teamId", "championId",
    "championName", "spell1Id", "spell2Id", "summoner1Id", "summoner2Id",
    "teamPosition", "individualPosition", "timeline", "stats",
  ]) delete stats[key];
  return stats;
}

export function toUnifiedParticipant(participant, identity = {}) {
  const stats = participantStats(participant);
  const participantId = firstValue(participant?.participantId, identity?.participantId);
  const puuid = identityValue(identity, participant, "puuid");
  const accountId = firstValue(
    identityValue(identity, participant, "accountId"),
    identityValue(identity, participant, "currentAccountId"),
  );
  const summonerId = identityValue(identity, participant, "summonerId");
  const gameName = firstValue(
    identityValue(identity, participant, "gameName"),
    identityValue(identity, participant, "displayName"),
    identityValue(identity, participant, "summonerName"),
  );
  const tagLine = identityValue(identity, participant, "tagLine");

  return {
    participantId,
    puuid,
    accountId,
    summonerId,
    gameName,
    tagLine,
    teamId: firstValue(participant?.teamId, stats?.teamId),
    championId: firstValue(participant?.championId, stats?.championId),
    championName: firstValue(participant?.championName, stats?.championName),
    spell1Id: firstValue(participant?.spell1Id, stats?.summoner1Id),
    spell2Id: firstValue(participant?.spell2Id, stats?.summoner2Id),
    teamPosition: firstValue(participant?.teamPosition, stats?.teamPosition),
    individualPosition: firstValue(participant?.individualPosition, stats?.individualPosition),
    timeline: participant?.timeline && typeof participant.timeline === "object" ? participant.timeline : {},
    stats: {
      ...stats,
      win: firstValue(stats?.win, participant?.win, false),
    },
  };
}

export function toUnifiedHistoryGame(rawGame, historySource) {
  const game = rawGame?.json && typeof rawGame.json === "object" ? rawGame.json : rawGame;
  if (!game || typeof game !== "object") return null;
  const identities = identityMap(game);
  const rawParticipants = Array.isArray(game.participants)
    ? game.participants
    : Array.isArray(game.participantList)
      ? game.participantList
      : [];
  const participants = rawParticipants.map((participant) => toUnifiedParticipant(
    participant,
    identities.get(String(participant?.participantId ?? "")),
  ));
  const participantIdentities = participants.map((participant) => ({
    participantId: participant.participantId,
    player: {
      puuid: participant.puuid,
      accountId: participant.accountId,
      summonerId: participant.summonerId,
      gameName: participant.gameName,
      tagLine: participant.tagLine,
    },
  }));
  const gameId = firstValue(game.gameId, game.id);
  if (gameId === undefined) return null;

  return {
    modelVersion: 1,
    historySource,
    gameId,
    gameCreation: firstValue(game.gameCreation, game.gameStartTimestamp, game.gameStartTime),
    gameStartTimestamp: firstValue(game.gameStartTimestamp, game.gameCreation, game.gameStartTime),
    gameEndTimestamp: game.gameEndTimestamp,
    gameDuration: firstValue(game.gameDuration, game.duration),
    gameMode: firstValue(game.gameMode, game.mode),
    gameType: game.gameType,
    gameVersion: firstValue(game.gameVersion, game.version),
    mapId: firstValue(game.mapId, game.map?.id),
    queueId: firstValue(game.queueId, game.queue?.id),
    platformId: game.platformId,
    teams: Array.isArray(game.teams) ? game.teams : [],
    participantIdentities,
    participants,
  };
}

export function toUnifiedHistoryGames(rawGames, historySource) {
  return (Array.isArray(rawGames) ? rawGames : [])
    .map((game) => toUnifiedHistoryGame(game, historySource))
    .filter(Boolean);
}

export function isUnifiedHistoryGame(game) {
  return game?.modelVersion === 1
    && typeof game?.historySource === "string"
    && Array.isArray(game?.participants)
    && Array.isArray(game?.participantIdentities);
}
