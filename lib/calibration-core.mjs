export const CALIBRATION_ROLES = ["辅助", "法师", "刺客", "坦克", "射手", "战士"];

export const ROLE_BLUEPRINTS = {
  辅助: [
    { key: "shielding", expected: 470, weight: 0.3, value: (m) => perMinute(m.metrics.shielding, m) },
    { key: "healing", expected: 330, weight: 0.25, value: (m) => perMinute(m.metrics.healing, m) },
    { key: "control", expected: 2.8, weight: 0.25, value: (m) => perMinute(m.metrics.controlSeconds, m) },
    { key: "assists", expected: 1.05, weight: 0.2, value: (m) => perMinute(m.assists, m) },
  ],
  法师: [
    { key: "damage", expected: 1500, weight: 0.35, value: (m) => perMinute(m.metrics.damage, m) },
    { key: "control", expected: 1.8, weight: 0.25, value: (m) => perMinute(m.metrics.controlSeconds, m) },
    { key: "kills", expected: 0.48, weight: 0.2, value: (m) => perMinute(m.kills, m) },
    { key: "assists", expected: 0.72, weight: 0.2, value: (m) => perMinute(m.assists, m) },
  ],
  刺客: [
    { key: "kills", expected: 0.62, weight: 0.3, value: (m) => perMinute(m.kills, m) },
    { key: "damage", expected: 1420, weight: 0.3, value: (m) => perMinute(m.metrics.damage, m) },
    { key: "killDeath", expected: 1.65, weight: 0.25, value: (m) => m.kills / Math.max(m.deaths, 1) },
    { key: "participation", expected: 1.05, weight: 0.15, value: (m) => perMinute(m.kills + m.assists, m) },
  ],
  坦克: [
    { key: "mitigated", expected: 1750, weight: 0.3, value: (m) => perMinute(m.metrics.mitigated, m) },
    { key: "damageTaken", expected: 2900, weight: 0.25, value: (m) => perMinute(m.metrics.damageTaken, m) * (1.2 - Math.min(m.deaths / 18, 0.55)) },
    { key: "control", expected: 3.1, weight: 0.25, value: (m) => perMinute(m.metrics.controlSeconds, m) },
    { key: "assists", expected: 0.92, weight: 0.2, value: (m) => perMinute(m.assists, m) },
  ],
  射手: [
    { key: "damage", expected: 1850, weight: 0.35, value: (m) => perMinute(m.metrics.damage, m) },
    { key: "damageGold", expected: 2.2, weight: 0.25, value: (m) => m.metrics.damage / Math.max(m.metrics.gold, 1) },
    { key: "kills", expected: 0.58, weight: 0.25, value: (m) => perMinute(m.kills, m) },
    { key: "kda", expected: 2.4, weight: 0.15, value: (m) => (m.kills + m.assists) / Math.max(m.deaths, 1) },
  ],
  战士: [
    { key: "damage", expected: 1450, weight: 0.25, value: (m) => perMinute(m.metrics.damage, m) },
    { key: "participation", expected: 1.08, weight: 0.25, value: (m) => perMinute(m.kills + m.assists, m) },
    { key: "durability", expected: 3450, weight: 0.25, value: (m) => perMinute(m.metrics.mitigated + m.metrics.damageTaken, m) },
    { key: "selfHealing", expected: 430, weight: 0.25, value: (m) => perMinute(m.metrics.selfHealing, m) },
  ],
};

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const perMinute = (value, match) => Number(value ?? 0) / Math.max(Number(match.durationMinutes ?? 0), 1);

export const metricScoreForCalibration = (value, expected) =>
  clamp(50 + 38 * Math.tanh((value / Math.max(expected, 0.001) - 1) * 1.2), 4, 98);

export function calibrationVector(match, role) {
  const definitions = ROLE_BLUEPRINTS[role] ?? ROLE_BLUEPRINTS.战士;
  return definitions.map((definition) => definition.value(match));
}

export function calibrationRoleScore(match, role, expected) {
  const definitions = ROLE_BLUEPRINTS[role] ?? ROLE_BLUEPRINTS.战士;
  const values = calibrationVector(match, role);
  return values.reduce((total, value, index) => {
    const target = Number(expected?.[index] ?? definitions[index].expected);
    return total + metricScoreForCalibration(value, target) * definitions[index].weight;
  }, 0);
}

export function buildCalibrationSample(match, sampleHash, matchHash = sampleHash) {
  const vector = calibrationVector(match, match.role);
  const primaryScore = calibrationRoleScore(match, match.role);
  const secondaryRole = match.secondaryRole === match.role ? undefined : match.secondaryRole;
  const secondaryScore = secondaryRole ? calibrationRoleScore(match, secondaryRole) : null;
  const positiveScore = Math.min(100, primaryScore + (secondaryScore ?? 0) * 0.4);
  const effectiveDeaths = match.recall
    ? match.recall.deathsBefore + match.recall.deathsAfter * 2.5
    : match.deaths;
  const deathsPerTen = (effectiveDeaths / Math.max(match.durationMinutes, 1)) * 10;
  const survivalScore = clamp(50 + 38 * Math.tanh((5.3 - deathsPerTen) / 2.7), 4, 98);
  const operationScore = match.recall
    ? 0.65 * positiveScore + 0.35 * survivalScore
    : 0.85 * positiveScore + 0.15 * survivalScore;

  return {
    id: sampleHash,
    matchHash,
    playedAt: match.playedAt,
    patch: String(match.patch ?? "unknown").slice(0, 24),
    role: match.role,
    secondaryRole: secondaryRole ?? null,
    dimensions: vector.map((value) => Math.round(value * 1000) / 1000),
    secondaryScore: secondaryScore === null ? null : Math.round(secondaryScore * 100) / 100,
    operationScore: Math.round(operationScore * 100) / 100,
    deathsPerTen: Math.round(deathsPerTen * 1000) / 1000,
    recallApplied: Boolean(match.recall),
    won: Boolean(match.win),
  };
}

export function defaultCalibrationModel() {
  return {
    version: "rules-2026.07",
    generatedAt: "",
    status: "collecting",
    totalSamples: 0,
    minimumRoleSamples: 100,
    highlightThreshold: 88,
    secondaryBonusWeight: 0.4,
    deathPenaltyScale: 1,
    roles: CALIBRATION_ROLES.map((role) => ({
      role,
      samples: 0,
      confidence: 0,
      expected: ROLE_BLUEPRINTS[role].map((definition) => definition.expected),
    })),
  };
}
