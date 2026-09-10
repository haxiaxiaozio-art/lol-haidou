export const AUGMENT_WIN_MIN_GAMES = 10;

const clean = (value) => String(value ?? "").normalize("NFKC").trim();
const validId = (value) => /^\d+$/.test(clean(value)) && Number(value) > 0;
const percent = (part, total) => total ? Math.round(part / total * 1000) / 10 : null;
const byName = (a, b) => a.name.localeCompare(b.name, "zh-CN") || a.key.localeCompare(b.key);

// ID is authoritative. A legacy name can join an ID only if that name is unambiguous.
function aliasesFor(matches, kind) {
  const aliases = new Map();
  for (const match of matches) {
    const names = kind === "hero" ? [match.champion] : match.augments ?? [];
    const ids = kind === "hero" ? [match.championId] : match.augmentIds ?? [];
    names.forEach((name, i) => {
      if (!clean(name) || !validId(ids[i])) return;
      const key = clean(name);
      const values = aliases.get(key) ?? new Set();
      values.add(clean(ids[i]));
      aliases.set(key, values);
    });
  }
  return aliases;
}

function identity(name, id, aliases, fallback) {
  const label = clean(name);
  const candidates = aliases.get(label);
  const placeholderId = label.match(new RegExp(`^${fallback}\\s*(\\d+)$`))?.[1];
  const resolved = validId(id) ? clean(id) : validId(placeholderId) ? placeholderId : candidates?.size === 1 ? [...candidates][0] : null;
  if (!resolved && !label) return null;
  return { key: resolved ? `id:${resolved}` : `name:${label}`, name: label || `${fallback} ${resolved}` };
}

function addGame(map, entity, win) {
  if (!entity) return;
  const previous = map.get(entity.key);
  const row = previous ?? { ...entity, games: 0, wins: 0 };
  // An old report can contain only an ID. Prefer a resolved name when one is available.
  if (/^(海克斯|英雄)\s*\d+$/.test(row.name) && !/^(海克斯|英雄)\s*\d+$/.test(entity.name)) row.name = entity.name;
  row.games += 1;
  row.wins += Number(win);
  map.set(entity.key, row);
}

export function analyzePreferences(records) {
  const seen = new Set();
  const matches = records.filter((match) => {
    const id = clean(match.id);
    if (!id || seen.has(id) || typeof match.win !== "boolean") return false;
    seen.add(id);
    return true;
  });
  const heroes = new Map();
  const augments = new Map();
  const heroAliases = aliasesFor(matches, "hero");
  // Missing or partial records do not define either the numerator or the denominator.
  const complete = matches.filter((m) => {
    const names = m.augments ?? [];
    const ids = m.augmentIds ?? [];
    return m.dataQuality?.augmentsPresent !== false && Math.max(names.length, ids.length) > 0
      && Array.from({ length: Math.max(names.length, ids.length) }, (_, i) => clean(names[i]) || validId(ids[i])).every(Boolean);
  });
  const augmentAliases = aliasesFor(complete, "augment");
  for (const match of matches) addGame(heroes, identity(match.champion, match.championId, heroAliases, "英雄"), match.win);
  for (const match of complete) {
    const perGame = new Map();
    const names = match.augments ?? [];
    const ids = match.augmentIds ?? [];
    for (let i = 0; i < Math.max(names.length, ids.length); i += 1) {
      const entity = identity(names[i], ids[i], augmentAliases, "海克斯");
      if (entity) perGame.set(entity.key, entity);
    }
    for (const entity of perGame.values()) addGame(augments, entity, match.win);
  }
  const finish = (map, total) => [...map.values()].map((r) => ({ ...r, pickRate: percent(r.games, total), winRate: percent(r.wins, r.games) }))
    .sort((a, b) => b.games - a.games || byName(a, b));
  const heroRows = finish(heroes, matches.length);
  const augmentRows = finish(augments, complete.length);
  const winRanking = [...augmentRows].filter((r) => r.games >= AUGMENT_WIN_MIN_GAMES)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games || byName(a, b));
  return {
    totalGames: matches.length,
    duplicateOrInvalidGames: records.length - matches.length,
    augmentGames: complete.length,
    coverage: percent(complete.length, matches.length),
    heroes: heroRows,
    augments: augmentRows,
    winRanking,
    favoriteHeroes: heroRows.filter((r) => r.games === heroRows[0]?.games),
    favoriteAugments: augmentRows.filter((r) => r.games === augmentRows[0]?.games),
    periodStart: matches.map((m) => m.playedAt).filter((d) => Number.isFinite(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
    periodEnd: matches.map((m) => m.playedAt).filter((d) => Number.isFinite(Date.parse(d))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
  };
}

export function buildPreferenceStories(stats) {
  if (!stats.totalGames) return [];
  const stories = [];
  const hero = stats.favoriteHeroes[0];
  if (hero && stats.favoriteHeroes.length === 1 && hero.games >= 3) {
    stories.push({ title: "老熟人又来了", text: `${hero.name}在这份战报里出场最多，${stats.totalGames} 局里打了 ${hero.games} 局，赢了 ${hero.wins} 局。${hero.pickRate >= 50 ? "英雄池不一定深，这位是真的熟。" : "这段时间的常驻嘉宾，位置给你留好了。"}` });
  } else if (hero && stats.favoriteHeroes.length > 1) {
    stories.push({ title: "雨露均沾", text: `${stats.favoriteHeroes.slice(0, 3).map((r) => r.name).join("、")}${stats.favoriteHeroes.length > 3 ? `等 ${stats.favoriteHeroes.length} 位英雄` : ""}各打了 ${hero.games} 局，并列最多。暂时不用给谁颁本命奖。` });
  }
  const augment = stats.favoriteAugments[0];
  if (augment && stats.favoriteAugments.length === 1 && augment.games >= 5) {
    stories.push({ title: "背包常驻嘉宾", text: `${augment.name}陪你打了 ${augment.games} 局，赢下 ${augment.wins} 局。${stats.augmentGames} 局有记录的海斗里，${augment.pickRate}% 都带着它。熟面孔归熟面孔，不能据此说见到就必选。` });
  }
  const winner = stats.winRanking[0];
  if (winner && winner.winRate > 50) {
    stories.push({ title: "这搭配有点顺", text: `带着${winner.name}打了 ${winner.games} 局，赢了 ${winner.wins} 局，携带胜率 ${winner.winRate}%。这段战绩挺顺，但功劳不能全记在一枚海克斯头上。` });
  }
  if (!stories.length) stories.push({ title: "先别急着立人设", text: `目前只有 ${stats.totalGames} 局可用记录，还看不出稳定偏好。多打几局，再看谁是老搭档。` });
  return stories.slice(0, 3);
}

/** @param {ReturnType<typeof analyzePreferences>} stats */
export function preferencePage(stats, ranking, query, page) {
  const source = ranking === "wins" ? stats.winRanking : stats.augments;
  const needle = clean(query).toLocaleLowerCase();
  const filtered = source.filter((r) => `${r.name} ${r.key}`.normalize("NFKC").toLocaleLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  const current = Math.max(0, Math.min(Number.isFinite(page) ? Math.floor(page) : 0, pages - 1));
  return { rows: filtered.slice(current * 30, (current + 1) * 30), matched: filtered.length, total: source.length, pages, current };
}
