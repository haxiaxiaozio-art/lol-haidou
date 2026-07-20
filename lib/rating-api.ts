import { defaultRatingState, ratingEstimate, updateMatchRatings } from "./network-rating.mjs";

type Participant = { id: string; team: string; won: boolean };
type RatingMatch = { id: string; playedAt: string; patch: string; participants: Participant[] };
type RatingState = { rating: number; deviation: number; games: number; wins: number };

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REGION_PATTERN = /^[A-Z0-9]{2,8}$/;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: JSON_HEADERS });

function validMatch(value: unknown, targetHash: string): value is RatingMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as RatingMatch;
  const playedAt = Date.parse(match.playedAt);
  const now = Date.now();
  if (!HASH_PATTERN.test(match.id) || !Number.isFinite(playedAt) || playedAt > now + 86_400_000 || playedAt < now - 3 * 365 * 86_400_000) return false;
  if (typeof match.patch !== "string" || match.patch.length < 2 || match.patch.length > 24) return false;
  if (!Array.isArray(match.participants) || match.participants.length !== 10) return false;
  const ids = new Set<string>();
  const teams = new Map<string, Participant[]>();
  for (const participant of match.participants) {
    if (!participant || !HASH_PATTERN.test(participant.id) || typeof participant.won !== "boolean") return false;
    const team = String(participant.team ?? "");
    if (!team || team.length > 12 || ids.has(participant.id)) return false;
    ids.add(participant.id);
    const members = teams.get(team) ?? [];
    members.push({ ...participant, team });
    teams.set(team, members);
  }
  if (!ids.has(targetHash) || teams.size !== 2 || [...teams.values()].some((members) => members.length !== 5)) return false;
  const outcomes = [...teams.values()].map((members) => new Set(members.map((member) => member.won)));
  return outcomes.every((outcome) => outcome.size === 1) && outcomes[0].has(true) !== outcomes[1].has(true);
}

async function loadStates(db: D1Database, region: string, ids: string[]) {
  const states = new Map<string, RatingState>();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const query = await db.prepare(`SELECT player_hash, rating, deviation, games, wins FROM rating_players WHERE region = ? AND player_hash IN (${placeholders})`).bind(region, ...chunk).all();
    for (const row of query.results as Array<Record<string, unknown>>) {
      states.set(String(row.player_hash), { rating: Number(row.rating), deviation: Number(row.deviation), games: Number(row.games), wins: Number(row.wins) });
    }
  }
  return states;
}

export async function handleRatingGet(db: D1Database, request: Request) {
  const url = new URL(request.url);
  const region = (url.searchParams.get("region") ?? "").toUpperCase();
  const playerHash = (url.searchParams.get("player") ?? "").toLowerCase();
  if (!REGION_PATTERN.test(region) || !HASH_PATTERN.test(playerHash)) return response({ error: "Invalid rating identity." }, 400);
  const row = await db.prepare("SELECT rating, deviation, games, wins FROM rating_players WHERE region = ? AND player_hash = ?").bind(region, playerHash).first<RatingState>();
  return response({ estimate: ratingEstimate(row ?? defaultRatingState()) });
}

export async function handleRatingPost(db: D1Database, request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const region = String(body.region ?? "").toUpperCase();
  const targetHash = String(body.targetHash ?? "").toLowerCase();
  const matches = body.matches;
  if (body.version !== 1 || !REGION_PATTERN.test(region) || !HASH_PATTERN.test(targetHash)) return response({ error: "Invalid rating submission." }, 400);
  if (!Array.isArray(matches) || matches.length < 1 || matches.length > 20 || !matches.every((match) => validMatch(match, targetHash))) return response({ error: "Invalid match graph." }, 400);

  const submittedAt = new Date().toISOString();
  const freshMatches: RatingMatch[] = [];
  for (const match of [...matches].sort((left, right) => Date.parse(left.playedAt) - Date.parse(right.playedAt)) as RatingMatch[]) {
    const claim = await db.prepare("INSERT OR IGNORE INTO rating_matches (region, match_hash, played_at, patch, processed, submitted_at) VALUES (?, ?, ?, ?, 0, ?)").bind(region, match.id, match.playedAt, match.patch, submittedAt).run();
    if ((claim.meta.changes ?? 0) > 0) freshMatches.push(match);
  }

  if (freshMatches.length > 0) {
    const ids = [...new Set(freshMatches.flatMap((match) => match.participants.map((participant) => participant.id)))];
    const states = await loadStates(db, region, ids);
    for (const match of freshMatches) {
      const updated = updateMatchRatings(match, states);
      for (const [id, state] of updated) states.set(id, state);
    }
    const lastPlayedByPlayer = new Map<string, string>();
    for (const match of freshMatches) for (const participant of match.participants) lastPlayedByPlayer.set(participant.id, match.playedAt);
    const statements = [...lastPlayedByPlayer].map(([id, lastPlayedAt]) => {
      const state = states.get(id) ?? defaultRatingState();
      return db.prepare(`INSERT INTO rating_players (region, player_hash, rating, deviation, games, wins, last_played_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(region, player_hash) DO UPDATE SET rating = excluded.rating, deviation = excluded.deviation,
          games = excluded.games, wins = excluded.wins, last_played_at = excluded.last_played_at, updated_at = excluded.updated_at`)
        .bind(region, id, state.rating, state.deviation, state.games, state.wins, lastPlayedAt, submittedAt);
    });
    statements.push(...freshMatches.map((match) => db.prepare("UPDATE rating_matches SET processed = 1 WHERE region = ? AND match_hash = ?").bind(region, match.id)));
    await db.batch(statements);
  }

  const target = await db.prepare("SELECT rating, deviation, games, wins FROM rating_players WHERE region = ? AND player_hash = ?").bind(region, targetHash).first<RatingState>();
  return response({ accepted: freshMatches.length, estimate: ratingEstimate(target ?? defaultRatingState()) });
}
