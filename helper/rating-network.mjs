import { createHash } from "node:crypto";

export const DEFAULT_RATING_API = "https://lol-haidou-rating.haxiaxiaozio.workers.dev/api/rating";

const hash = (namespace, region, value) => createHash("sha256")
  .update(`${namespace}|${region}|${String(value)}`, "utf8")
  .digest("hex");

const rawPlayerId = (value) => value?.puuid
  ?? value?.accountId
  ?? value?.currentAccountId
  ?? value?.summonerId
  ?? value?.id;

const gameId = (game) => game?.gameId ?? game?.id;

const gameTime = (game) => {
  const raw = Number(game?.gameCreation ?? game?.gameStartTimestamp ?? game?.gameStartTime);
  return new Date(raw < 10_000_000_000 ? raw * 1000 : raw).toISOString();
};

const wonGame = (participant) => {
  const value = participant?.stats?.win ?? participant?.win;
  return value === true || String(value).toLowerCase() === "win" || Number(value) === 1;
};

export function buildRatingGraph(games, targetPlayer, region, acceptedMatchIds = []) {
  const regionCode = String(region ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const targetRawId = rawPlayerId(targetPlayer);
  if (!targetRawId || regionCode.length < 2) return null;
  const targetHash = hash("haidou-player-v1", regionCode, targetRawId);
  const accepted = new Set(acceptedMatchIds.map(String));
  const matches = [];

  for (const game of Array.isArray(games) ? games : []) {
    if (game?.modelVersion !== 1) continue;
    const rawMatchId = gameId(game);
    if (!rawMatchId || (accepted.size > 0 && !accepted.has(String(rawMatchId)))) continue;
    const participants = Array.isArray(game?.participants) ? game.participants : [];
    const identities = Array.isArray(game?.participantIdentities) ? game.participantIdentities : [];
    const identityByParticipant = new Map(identities.map((identity) => [String(identity?.participantId), identity?.player ?? identity]));
    const anonymousParticipants = participants.map((participant) => {
      const identity = identityByParticipant.get(String(participant?.participantId)) ?? participant?.player ?? participant;
      const rawId = rawPlayerId(identity) ?? rawPlayerId(participant);
      const team = String(participant?.teamId ?? participant?.team ?? "");
      if (!rawId || !team) return null;
      return { id: hash("haidou-player-v1", regionCode, rawId), team, won: wonGame(participant) };
    }).filter(Boolean);
    if (anonymousParticipants.length !== 10 || new Set(anonymousParticipants.map((participant) => participant.id)).size !== 10) continue;
    const teams = new Map();
    for (const participant of anonymousParticipants) {
      const members = teams.get(participant.team) ?? [];
      members.push(participant);
      teams.set(participant.team, members);
    }
    if (teams.size !== 2 || [...teams.values()].some((members) => members.length !== 5)) continue;
    if (!anonymousParticipants.some((participant) => participant.id === targetHash)) continue;
    const playedAt = gameTime(game);
    if (!Number.isFinite(Date.parse(playedAt))) continue;
    matches.push({
      id: hash("haidou-match-v1", regionCode, rawMatchId),
      playedAt,
      patch: String(game?.gameVersion ?? game?.version ?? "unknown").slice(0, 24),
      participants: anonymousParticipants,
    });
  }

  return {
    version: 1,
    region: regionCode,
    targetHash,
    matches: matches.sort((left, right) => Date.parse(left.playedAt) - Date.parse(right.playedAt)).slice(-80),
  };
}

async function ratingRequest(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`网络估算服务暂时不可用（${response.status}）`);
  const body = await response.json();
  if (!body?.estimate) throw new Error("网络估算服务返回的数据不完整");
  return body;
}

export async function submitRatingGraph(graph) {
  if (!graph) return null;
  const api = String(process.env.HAIDOU_RATING_API ?? DEFAULT_RATING_API).replace(/\/$/, "");
  let lastResult = null;
  if (graph.matches.length === 0) {
    const query = new URL(api);
    query.searchParams.set("region", graph.region);
    query.searchParams.set("player", graph.targetHash);
    return (await ratingRequest(query, { headers: { "User-Agent": "HaiDouHelper/17" } })).estimate;
  }
  for (let offset = 0; offset < graph.matches.length; offset += 20) {
    const body = { ...graph, matches: graph.matches.slice(offset, offset + 20) };
    lastResult = await ratingRequest(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "HaiDouHelper/17" },
      body: JSON.stringify(body),
    });
  }
  return lastResult?.estimate ?? null;
}
