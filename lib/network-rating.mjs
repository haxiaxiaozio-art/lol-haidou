export const INITIAL_RATING = 1500;
export const INITIAL_DEVIATION = 350;
export const MIN_DEVIATION = 60;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function expectedWinRate(ownRating, opponentRating) {
  return 1 / (1 + (10 ** ((opponentRating - ownRating) / 400)));
}

export function ratingKFactor(deviation) {
  return clamp(18 + ((deviation - MIN_DEVIATION) / (INITIAL_DEVIATION - MIN_DEVIATION)) * 30, 18, 48);
}

export function defaultRatingState() {
  return { rating: INITIAL_RATING, deviation: INITIAL_DEVIATION, games: 0, wins: 0 };
}

export function updateMatchRatings(match, currentStates) {
  const teams = new Map();
  for (const participant of match.participants ?? []) {
    const list = teams.get(participant.team) ?? [];
    list.push(participant);
    teams.set(participant.team, list);
  }
  if (teams.size !== 2 || [...teams.values()].some((team) => team.length !== 5)) {
    throw new Error("A rating match must contain two teams of five.");
  }

  const knownPlayers = match.participants.filter((participant) => (currentStates.get(participant.id)?.games ?? 0) > 0).length;
  const coverageWeight = 0.7 + 0.3 * (knownPlayers / 10);
  const teamRatings = new Map([...teams].map(([team, participants]) => [
    team,
    participants.reduce((sum, participant) => sum + (currentStates.get(participant.id)?.rating ?? INITIAL_RATING), 0) / participants.length,
  ]));
  const nextStates = new Map();

  for (const participant of match.participants) {
    const current = currentStates.get(participant.id) ?? defaultRatingState();
    const opponentTeam = [...teams.keys()].find((team) => team !== participant.team);
    const expected = expectedWinRate(teamRatings.get(participant.team), teamRatings.get(opponentTeam));
    const delta = ratingKFactor(current.deviation) * ((participant.won ? 1 : 0) - expected) * coverageWeight;
    nextStates.set(participant.id, {
      rating: clamp(current.rating + delta, 600, 3000),
      deviation: Math.max(MIN_DEVIATION, current.deviation * 0.97),
      games: current.games + 1,
      wins: current.wins + (participant.won ? 1 : 0),
    });
  }
  return nextStates;
}

export function ratingEstimate(state = defaultRatingState()) {
  const gamesConfidence = 1 - Math.exp(-state.games / 24);
  const deviationConfidence = 1 - ((state.deviation - MIN_DEVIATION) / (INITIAL_DEVIATION - MIN_DEVIATION));
  const confidence = clamp(Math.round((gamesConfidence * 0.65 + deviationConfidence * 0.35) * 100), 0, 99);
  const halfRange = Math.round(Math.max(45, state.deviation * 0.75));
  return {
    rating: Math.round(state.rating),
    low: Math.round(state.rating - halfRange),
    high: Math.round(state.rating + halfRange),
    confidence,
    games: state.games,
    wins: state.wins,
    status: state.games < 20 ? "calibrating" : state.games < 60 ? "provisional" : "stable",
  };
}
