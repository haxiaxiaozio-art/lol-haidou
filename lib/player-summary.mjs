export function reliableRoleScore(score, games) {
  if (games <= 0) return 0;
  const sampleWeight = games / (games + 6);
  return Math.round(50 + sampleWeight * (score - 50));
}

export function aggregatePlayerPreferences(matches) {
  const heroMap = new Map();
  const augmentMap = new Map();
  const itemMap = new Map();
  for (const match of matches) {
    const hero = heroMap.get(match.champion) ?? { games: 0, wins: 0 };
    hero.games += 1;
    hero.wins += Number(match.win);
    heroMap.set(match.champion, hero);
    for (const augment of match.augments ?? []) augmentMap.set(augment, (augmentMap.get(augment) ?? 0) + 1);
    const uniqueItems = new Set(match.items ?? []);
    for (const item of match.items ?? []) {
      const stat = itemMap.get(item) ?? { picks: 0, games: 0 };
      stat.picks += 1;
      itemMap.set(item, stat);
    }
    for (const item of uniqueItems) {
      const stat = itemMap.get(item) ?? { picks: 0, games: 0 };
      stat.games += 1;
      itemMap.set(item, stat);
    }
  }

  const heroes = [...heroMap.entries()]
    .map(([name, stat]) => ({
      name,
      ...stat,
      winRate: Math.round((stat.wins / stat.games) * 100),
      smoothedWinRate: ((stat.wins + 5) / (stat.games + 10)) * 100,
    }))
    .sort((a, b) => b.games - a.games || b.smoothedWinRate - a.smoothedWinRate);
  const totalAugmentPicks = [...augmentMap.values()].reduce((sum, value) => sum + value, 0);
  const augments = [...augmentMap.entries()]
    .map(([name, picks]) => ({ name, picks, share: Math.round((picks / Math.max(totalAugmentPicks, 1)) * 100) }))
    .sort((a, b) => b.picks - a.picks);
  const favoriteItems = [...itemMap.entries()]
    .map(([name, stat]) => ({
      name,
      ...stat,
      gameShare: Math.round((stat.games / Math.max(matches.length, 1)) * 100),
    }))
    .sort((a, b) => b.games - a.games || b.picks - a.picks || a.name.localeCompare(b.name, "zh-CN"));
  return { heroes, augments, favoriteItems };
}
