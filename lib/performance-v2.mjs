// Rule estimates, not population percentiles or official MMR.
export const PERFORMANCE_VERSION = "performance-v2.1";
const clamp = (n, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const valid = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
export const hasMetric = (m, key) => valid(m.metrics?.[key]) && (!m.dataQuality || m.dataQuality.metricsPresent?.includes(key));
const perMinute = (m, key) => hasMetric(m, key) && m.durationMinutes > 0 ? m.metrics[key] / m.durationMinutes : null;
export function teamShare(m, key) {
  const total = m.teamTotals?.[key];
  return m.teamTotals?.participants === 5 && hasMetric(m, key) && valid(total) && total > 0 && total >= m.metrics[key]
    ? m.metrics[key] / total : null;
}
export function patchKey(patch) {
  const parts = String(patch).match(/^(\d+)\.(\d+)/);
  if (!parts) return "unknown";
  const major = Number(parts[1]);
  // Riot markets 2026 as 26.x; the actual client/Data Dragon version is 16.x.
  return `${major >= 25 && major <= 30 ? major - 10 : major}.${Number(parts[2])}`;
}
const specs = {
  damage: { label: "持续输出", expected: 1600, format: (v) => `${Math.round(v)} / 分钟`, value: (m) => perMinute(m, "damage") },
  protection: { label: "治疗保护", expected: 650, format: (v) => `${Math.round(v)} / 分钟`, value: (m) => hasMetric(m, "healing") && hasMetric(m, "shielding") ? (m.metrics.healing + m.metrics.shielding) / m.durationMinutes : null },
  tanking: { label: "承伤负担", expected: 2400, format: (v) => `${Math.round(v)} / 分钟`, value: (m) => perMinute(m, "damageTaken") },
  control: { label: "控制贡献", expected: 2, format: (v) => `${v.toFixed(1)} 秒 / 分钟`, value: (m) => perMinute(m, "controlSeconds") },
  efficiency: { label: "经济转化", expected: 2.3, format: (v) => `${v.toFixed(2)} 伤害 / 金币`, value: (m) => hasMetric(m, "damage") && hasMetric(m, "gold") && m.metrics.gold > 0 ? m.metrics.damage / m.metrics.gold : null },
  involvement: { label: "参战节奏", expected: 1.15, format: (v) => `${v.toFixed(2)} 击杀参与 / 分钟`, value: (m) => valid(m.kills) && valid(m.assists) ? (m.kills + m.assists) / m.durationMinutes : null },
  damageShare: { label: "队内输出", expected: .22, format: (v) => `${(v * 100).toFixed(1)}%`, value: (m) => teamShare(m, "damage") },
};
const roles = {
  辅助: { damage: .1, protection: .32, control: .25, involvement: .23, tanking: .1 },
  法师: { damage: .3, control: .2, efficiency: .2, damageShare: .2, involvement: .1 },
  刺客: { damage: .3, efficiency: .25, involvement: .25, damageShare: .2 },
  坦克: { tanking: .4, control: .3, involvement: .2, damage: .1 },
  射手: { damage: .35, efficiency: .25, damageShare: .25, involvement: .15 },
  战士: { damage: .3, tanking: .25, efficiency: .15, control: .15, involvement: .15 },
};
// Explicit champion-kit rules. Unlisted champions fall back to role rules, disclosed in UI.
// Protection merges healing and shielding: Morgana is never penalized for having no heal.
const kits = {
  "25": { names: ["莫甘娜", "Morgana"], weights: { damage: .2, protection: .25, control: .3, involvement: .15, efficiency: .1 }, expected: { protection: 260, control: 2.8 } },
  "147": { names: ["萨勒芬妮", "Seraphine"], weights: { protection: .35, control: .25, damage: .15, involvement: .25 }, expected: { protection: 950, control: 2.8 } },
  "84": { names: ["阿卡丽", "Akali"], weights: roles.刺客, expected: { damage: 1500 } },
  "112": { names: ["维克托", "Viktor"], weights: roles.法师, expected: { damage: 1850, control: 1.5 } },
  "516": { names: ["奥恩", "Ornn"], weights: roles.坦克, expected: { tanking: 2700, control: 3.2 } },
  "222": { names: ["金克丝", "Jinx"], weights: roles.射手, expected: { damage: 2000, efficiency: 2.7 } },
  "266": { names: ["亚托克斯", "Aatrox"], weights: roles.战士, expected: { tanking: 2200, damage: 1700 } },
  "12": { names: ["阿利斯塔", "Alistar"], weights: roles.坦克, expected: { tanking: 2600, control: 3.3 } },
  "89": { names: ["蕾欧娜", "Leona"], weights: roles.坦克, expected: { control: 3.5 } },
  "111": { names: ["诺提勒斯", "Nautilus"], weights: roles.坦克, expected: { control: 3.3 } },
  "555": { names: ["派克", "Pyke"], weights: roles.刺客, expected: { damage: 1150 } },
  "16": { names: ["索拉卡", "Soraka"], weights: { protection: .6, control: .1, involvement: .3 }, expected: { protection: 1200, control: .7 } },
};
const median = (values) => {
  const a = [...values].sort((a, b) => a - b);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const relativeScore = (v, expected) => clamp(70 + 24 * Math.tanh((v / Math.max(expected, .001) - 1) * 1.2), 20, 96);
export function evaluatePerformance(match, history = []) {
  const kit = kits[String(match.championId)] ?? Object.values(kits).find((k) => k.names.includes(match.champion));
  const seen = new Set([String(match.id)]);
  const peers = history.filter((m) => {
    if (seen.has(String(m.id))) return false;
    seen.add(String(m.id));
    return (match.championId && m.championId ? String(m.championId) === String(match.championId) : m.champion === match.champion)
      && patchKey(match.patch) !== "unknown" && patchKey(m.patch) === patchKey(match.patch)
      && m.durationMinutes >= match.durationMinutes * .75 && m.durationMinutes <= match.durationMinutes * 1.25;
  });
  const scoreWeights = (weights) => {
    let weightPresent = 0;
    let weightedScore = 0;
    const dimensions = Object.entries(weights).map(([key, weight]) => {
      const spec = specs[key];
      const value = spec.value(match);
      const base = kit?.expected?.[key] ?? spec.expected;
      const samples = peers.map(spec.value).filter((v) => v !== null && valid(v));
      const sampleWeight = samples.length >= 5 ? Math.min(.5, samples.length / (samples.length + 20)) : 0;
      const expected = sampleWeight ? base * (1 - sampleWeight) + clamp(median(samples), base * .5, base * 2) * sampleWeight : base;
      let score = value === null ? null : relativeScore(value, expected);
      if (key === "tanking" && score !== null) {
        // Taking damage alone is not effective tanking; deaths can only reduce its reward.
        score -= Math.min(18, Math.max(0, match.deaths / match.durationMinutes * 10 - 4.5) * 3);
      }
      if (score !== null) { weightPresent += weight; weightedScore += score * weight; }
      return { label: spec.label, score: score === null ? 70 : Math.round(score), missing: score === null,
        displayValue: value === null ? "缺少字段，不计入权重" : spec.format(value), expected: spec.format(expected), samples: samples.length, weight };
    });
    const coverage = weightPresent / Object.values(weights).reduce((a, b) => a + b, 0);
    const observedScore = weightPresent ? weightedScore / weightPresent : 70;
    return { dimensions, coverage, score: 70 + (observedScore - 70) * coverage };
  };
  const primary = scoreWeights(kit?.weights ?? roles[match.role] ?? roles.战士);
  const secondary = match.secondaryRole && match.secondaryRole !== match.role ? scoreWeights(roles[match.secondaryRole] ?? roles.战士) : null;
  const bonus = secondary ? Math.min(6, Math.max(0, secondary.score - 70) * .4) : 0;
  const positiveScore = clamp(primary.score + bonus);
  const recall = match.recall;
  const validRecall = recall && valid(recall.pickedAtMinute) && recall.pickedAtMinute <= match.durationMinutes
    && valid(recall.deathsBefore) && valid(recall.deathsAfter) && recall.deathsBefore + recall.deathsAfter === match.deaths;
  const deaths = validRecall ? recall.deathsBefore + recall.deathsAfter * 2.5 : match.deaths;
  const survivalScore = clamp(70 + 22 * Math.tanh((4.5 - deaths / match.durationMinutes * 10) / 2.7), 20, 94);
  const recallReduction = validRecall ? 1 - .15 * (1 - recall.pickedAtMinute / match.durationMinutes) : 1;
  const score = (validRecall ? .65 : .9) * positiveScore * recallReduction + (validRecall ? .35 : .1) * survivalScore;
  return {
    match, score: Math.round(clamp(score)), positiveScore: Math.round(positiveScore), survivalScore: Math.round(survivalScore),
    recallApplied: Boolean(validRecall), dimensions: primary.dimensions,
    roleComponents: [{ role: match.role, kind: "primary", weight: 1, score: Math.round(primary.score), contribution: Math.round(primary.score) },
      ...(secondary ? [{ role: match.secondaryRole, kind: "secondary", weight: .4, score: Math.round(secondary.score), contribution: Math.round(bonus) }] : [])],
    evaluation: { version: PERFORMANCE_VERSION, baseline: 70, coverage: Math.round(primary.coverage * 100), peers: peers.length,
      championSpecific: Boolean(kit), basis: peers.length >= 5 ? "规则 + 同英雄个人历史" : "英雄规则估算", provisional: true },
  };
}

export function performanceTable(matches) {
  const definitions = [
    { key: "protection", label: "治疗保护", note: "给队友的治疗 + 护盾；不含自疗", value: specs.protection.value, format: specs.protection.format },
    { key: "tanking", label: "承伤", note: "受到的伤害 / 分钟，不等同于有效承伤", value: specs.tanking.value, format: specs.tanking.format },
    { key: "damage", label: "输出", note: "对英雄伤害 / 分钟", value: specs.damage.value, format: specs.damage.format },
    { key: "damageShare", label: "输出占比", note: "个人对英雄伤害 / 同队五人对英雄伤害", value: (m) => teamShare(m, "damage"), format: specs.damageShare.format },
    { key: "goldShare", label: "经济占比", note: "个人金币 / 同队五人金币；高低不直接加分", value: (m) => teamShare(m, "gold"), format: specs.damageShare.format },
    { key: "controlShare", label: "控制占比", note: "个人控制时长 / 同口径五人控制时长", value: (m) => teamShare(m, "controlSeconds"), format: specs.damageShare.format },
  ];
  return definitions.map((d) => {
    const values = matches.map(d.value).filter((v) => v !== null && valid(v));
    const value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { key: d.key, label: d.label, note: d.note, value, displayValue: value === null ? "暂无数据" : d.format(value), games: values.length };
  });
}

export function describePlaystyle(matches) {
  const rows = performanceTable(matches);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  if (matches.length < 5) return "先多打几场。这点样本，还看不出稳定的打法。";
  const protection = by.protection.value;
  const paired = matches.map((m) => ({ damage: teamShare(m, "damage"), gold: teamShare(m, "gold") })).filter((p) => p.damage !== null && p.gold !== null);
  const output = paired.length ? paired.reduce((sum, p) => sum + p.damage, 0) / paired.length : 0;
  const gold = paired.length ? paired.reduce((sum, p) => sum + p.gold, 0) / paired.length : 0;
  const control = by.controlShare.value;
  if (by.protection.games >= 5 && protection >= 550) return `你更习惯替队友兜底，平均每分钟送出 ${Math.round(protection)} 点治疗和护盾。别只盯着队友血条，也给自己留条退路。`;
  if (paired.length >= 5 && output >= .25 && output > gold + .04) return "吃的经济不算多，打出来的伤害倒很扎实。你更像队里的高效输出点，活到下一轮技能往往比追一个残血更值。";
  if (by.controlShare.games >= 5 && control >= .3) return "开团和留人的活，你接得比较多。控制交完别急着往前走，先看看队友能不能跟上。";
  if (by.tanking.games >= 5 && by.tanking.value >= 2500) return "你经常站在前面吃伤害。不过扛得多不一定扛得好，能让队友跟上输出的那一波才算赚。";
  if (by.damage.games >= 5 && by.damage.value >= 1800) return "你偏向持续打伤害，存在感不只在人头上。下一步可以留意输出窗口，少打两下前排，多等一次关键技能。";
  return "目前看是偏均衡的打法，还没有特别突出的单项。先看每局哪一项掉得最多，比给自己硬贴一个标签更有用。";
}
