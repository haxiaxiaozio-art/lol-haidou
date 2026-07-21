import type {
  CalibrationModel,
  DimensionScore,
  MatchRecord,
  PlayerDataset,
  PlayerSummary,
  Role,
  ScoredMatch,
} from "./types";
import { ROLES } from "./types";
import { combineRoleScores } from "./role-scoring.mjs";
import { aggregatePlayerPreferences, reliableRoleScore } from "./player-summary.mjs";

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const perMinute = (value: number, match: MatchRecord) =>
  value / Math.max(match.durationMinutes, 1);

const metricScore = (value: number, expected: number) =>
  clamp(50 + 38 * Math.tanh((value / Math.max(expected, 0.001) - 1) * 1.2), 4, 98);

type DimensionDefinition = {
  label: string;
  weight: number;
  expected: number;
  value: (match: MatchRecord) => number;
  format: (value: number) => string;
};

const countPerMinute = (value: number) => `${value.toFixed(2)}/分钟`;
const integerPerMinute = (value: number) => `${Math.round(value)}/分钟`;

const ROLE_DIMENSIONS: Record<Role, DimensionDefinition[]> = {
  辅助: [
    { label: "队友护盾", weight: 0.3, expected: 470, value: (m) => perMinute(m.metrics.shielding, m), format: integerPerMinute },
    { label: "队友治疗", weight: 0.25, expected: 330, value: (m) => perMinute(m.metrics.healing, m), format: integerPerMinute },
    { label: "有效控制", weight: 0.25, expected: 2.8, value: (m) => perMinute(m.metrics.controlSeconds, m), format: (v) => `${v.toFixed(1)}秒/分钟` },
    { label: "助攻贡献", weight: 0.2, expected: 1.05, value: (m) => perMinute(m.assists, m), format: countPerMinute },
  ],
  法师: [
    { label: "英雄伤害", weight: 0.35, expected: 1500, value: (m) => perMinute(m.metrics.damage, m), format: integerPerMinute },
    { label: "有效控制", weight: 0.25, expected: 1.8, value: (m) => perMinute(m.metrics.controlSeconds, m), format: (v) => `${v.toFixed(1)}秒/分钟` },
    { label: "击杀贡献", weight: 0.2, expected: 0.48, value: (m) => perMinute(m.kills, m), format: countPerMinute },
    { label: "助攻贡献", weight: 0.2, expected: 0.72, value: (m) => perMinute(m.assists, m), format: countPerMinute },
  ],
  刺客: [
    { label: "击杀贡献", weight: 0.3, expected: 0.62, value: (m) => perMinute(m.kills, m), format: countPerMinute },
    { label: "英雄伤害", weight: 0.3, expected: 1420, value: (m) => perMinute(m.metrics.damage, m), format: integerPerMinute },
    { label: "终结效率", weight: 0.25, expected: 1.65, value: (m) => m.kills / Math.max(m.deaths, 1), format: (v) => `${v.toFixed(2)} K/D` },
    { label: "参战节奏", weight: 0.15, expected: 1.05, value: (m) => perMinute(m.kills + m.assists, m), format: countPerMinute },
  ],
  坦克: [
    { label: "伤害减免", weight: 0.3, expected: 1750, value: (m) => perMinute(m.metrics.mitigated, m), format: integerPerMinute },
    { label: "有效承伤", weight: 0.25, expected: 2900, value: (m) => perMinute(m.metrics.damageTaken, m) * (1.2 - Math.min(m.deaths / 18, 0.55)), format: integerPerMinute },
    { label: "有效控制", weight: 0.25, expected: 3.1, value: (m) => perMinute(m.metrics.controlSeconds, m), format: (v) => `${v.toFixed(1)}秒/分钟` },
    { label: "助攻贡献", weight: 0.2, expected: 0.92, value: (m) => perMinute(m.assists, m), format: countPerMinute },
  ],
  射手: [
    { label: "每分钟伤害", weight: 0.35, expected: 1850, value: (m) => perMinute(m.metrics.damage, m), format: integerPerMinute },
    { label: "经济转伤害", weight: 0.25, expected: 2.2, value: (m) => m.metrics.damage / Math.max(m.metrics.gold, 1), format: (v) => `${v.toFixed(2)} 伤害/金币` },
    { label: "击杀贡献", weight: 0.25, expected: 0.58, value: (m) => perMinute(m.kills, m), format: countPerMinute },
    { label: "输出存活", weight: 0.15, expected: 2.4, value: (m) => (m.kills + m.assists) / Math.max(m.deaths, 1), format: (v) => `${v.toFixed(2)} KDA` },
  ],
  战士: [
    { label: "英雄伤害", weight: 0.25, expected: 1450, value: (m) => perMinute(m.metrics.damage, m), format: integerPerMinute },
    { label: "击杀参与", weight: 0.25, expected: 1.08, value: (m) => perMinute(m.kills + m.assists, m), format: countPerMinute },
    { label: "攻防交换", weight: 0.25, expected: 3450, value: (m) => perMinute(m.metrics.mitigated + m.metrics.damageTaken, m), format: integerPerMinute },
    { label: "自我续航", weight: 0.25, expected: 430, value: (m) => perMinute(m.metrics.selfHealing, m), format: integerPerMinute },
  ],
};

export function scoreMatch(match: MatchRecord, calibration?: CalibrationModel | null): ScoredMatch {
  const scoreRole = (role: Role) => {
    const definitions = ROLE_DIMENSIONS[role];
    const calibratedRole = calibration?.roles.find((entry) => entry.role === role);
    const dimensions: DimensionScore[] = definitions.map((definition, index) => {
      const value = definition.value(match);
      const expected = calibratedRole?.expected[index] ?? definition.expected;
      return {
        label: definition.label,
        score: Math.round(metricScore(value, expected)),
        displayValue: definition.format(value),
      };
    });
    const score = dimensions.reduce(
      (total, dimension, index) => total + dimension.score * definitions[index].weight,
      0,
    );
    return { dimensions, score };
  };

  const primary = scoreRole(match.role);
  const secondaryRole = match.secondaryRole === match.role ? undefined : match.secondaryRole;
  const secondary = secondaryRole ? scoreRole(secondaryRole) : null;
  const secondaryBonusWeight = calibration?.secondaryBonusWeight ?? 0.4;
  const combinedRoleScore = combineRoleScores(primary.score, secondary?.score, secondaryBonusWeight);
  const roleComponents = secondary && secondaryRole
    ? [
        {
          role: match.role,
          kind: "primary" as const,
          weight: 1,
          score: combinedRoleScore.primaryScore,
          contribution: combinedRoleScore.primaryScore,
        },
        {
          role: secondaryRole,
          kind: "secondary" as const,
          weight: secondaryBonusWeight,
          score: combinedRoleScore.secondaryScore ?? 0,
          contribution: combinedRoleScore.secondaryBonus,
        },
      ]
    : [{
        role: match.role,
        kind: "primary" as const,
        weight: 1,
        score: combinedRoleScore.primaryScore,
        contribution: combinedRoleScore.primaryScore,
      }];
  const positiveScore = combinedRoleScore.total;

  const dimensions: DimensionScore[] = primary.dimensions;

  const effectiveDeaths = match.recall
    ? match.recall.deathsBefore + match.recall.deathsAfter * 2.5
    : match.deaths;
  const deathsPerTen = (effectiveDeaths / Math.max(match.durationMinutes, 1)) * 10 * (calibration?.deathPenaltyScale ?? 1);
  const survivalScore = clamp(50 + 38 * Math.tanh((5.3 - deathsPerTen) / 2.7), 4, 98);

  let finalScore: number;
  if (match.recall) {
    const beforeShare = clamp(match.recall.pickedAtMinute / match.durationMinutes, 0, 1);
    const adjustedPositive = positiveScore * (beforeShare + 0.8 * (1 - beforeShare));
    finalScore = 0.65 * adjustedPositive + 0.35 * survivalScore;
  } else {
    finalScore = 0.85 * positiveScore + 0.15 * survivalScore;
  }

  return {
    match,
    score: Math.round(clamp(finalScore)),
    positiveScore: Math.round(positiveScore),
    survivalScore: Math.round(survivalScore),
    recallApplied: Boolean(match.recall),
    dimensions,
    roleComponents,
  };
}

export function summarizePlayer(dataset: PlayerDataset, calibration?: CalibrationModel | null): PlayerSummary {
  const scoredMatches = [...dataset.matches]
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
    .map((match) => scoreMatch(match, calibration));
  const wins = dataset.matches.filter((match) => match.win).length;
  const confidenceFactor = dataset.matches.length / (dataset.matches.length + 10);
  const weighted = scoredMatches.reduce(
    (acc, item, index) => {
      const weight = Math.exp(-index / 18);
      return { total: acc.total + item.score * weight, weight: acc.weight + weight };
    },
    { total: 0, weight: 0 },
  );
  const rawAverage = weighted.weight ? weighted.total / weighted.weight : 50;

  const roleScores = ROLES.map((role) => {
    const roleMatches = scoredMatches.filter((item) => item.match.role === role);
    const score = roleMatches.length
      ? Math.round(roleMatches.reduce((sum, item) => sum + item.score, 0) / roleMatches.length)
      : 0;
    return {
      role,
      games: roleMatches.length,
      score,
      reliableScore: reliableRoleScore(score, roleMatches.length),
    };
  });

  const { heroes, augments, favoriteItems } = aggregatePlayerPreferences(dataset.matches);

  return {
    scoredMatches,
    overallScore:
      dataset.matches.length >= 5 ? Math.round(50 + confidenceFactor * (rawAverage - 50)) : null,
    confidence: Math.round(confidenceFactor * 100),
    wins,
    winRate: Math.round((wins / Math.max(dataset.matches.length, 1)) * 100),
    roleScores,
    heroes,
    augments,
    favoriteItems,
    highlights: scoredMatches.filter((item) => item.score >= (calibration?.highlightThreshold ?? 88)).slice(0, 5),
  };
}
