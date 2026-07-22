import { CALIBRATION_ROLES, ROLE_BLUEPRINTS, defaultCalibrationModel } from "./calibration-core.mjs";

export const CALIBRATION_POLICY_VERSION = "calibration-policy-2026.08";
export const DEFAULT_CANARY_PERCENTAGE = 10;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => Number.isFinite(Number(value));

/**
 * @param {any} sample
 * @param {{count: number, means: number[], deviations: number[]}|null} [history]
 */
export function detectCalibrationAnomaly(sample, history = null) {
  const reasons = [];
  let score = 0;
  const add = (code, message, weight) => {
    reasons.push({ code, message });
    score += weight;
  };

  const blueprint = ROLE_BLUEPRINTS[sample.role] ?? [];
  const expected = blueprint.map((item) => Number(item.expected));
  const dimensions = Array.isArray(sample.dimensions) ? sample.dimensions.map(Number) : [];

  if (sample.secondaryRole && sample.secondaryRole === sample.role) {
    add("DUPLICATE_ROLE", "主副职业相同，样本职业标记异常", 100);
  }
  if (sample.secondaryRole && !finite(sample.secondaryScore)) {
    add("SECONDARY_SCORE_MISSING", "存在副职业但缺少副职业得分", 80);
  }
  if (!sample.secondaryRole && sample.secondaryScore !== null) {
    add("SECONDARY_ROLE_MISSING", "存在副职业得分但缺少副职业", 80);
  }
  if (dimensions.length === 4 && dimensions.every((value) => value <= 0.001) && Number(sample.operationScore) > 30) {
    add("EMPTY_DIMENSIONS", "四项职业指标为空但操作分异常偏高", 100);
  }
  if (Number(sample.deathsPerTen) > 25) {
    add("DEATH_RATE_EXTREME", "每十分钟有效死亡超过可信范围", 100);
  } else if (Number(sample.deathsPerTen) > 18) {
    add("DEATH_RATE_HIGH", "每十分钟有效死亡显著偏高", 45);
  }
  if (Number(sample.operationScore) >= 97 && Number(sample.deathsPerTen) >= 14) {
    add("SCORE_SURVIVAL_CONFLICT", "极高操作分与极高死亡率同时出现", 70);
  }

  dimensions.forEach((value, index) => {
    const baseline = expected[index];
    if (finite(value) && finite(baseline) && baseline > 0 && value / baseline > 4.5) {
      add(`DIMENSION_${index + 1}_EXTREME`, `第 ${index + 1} 项职业指标超过基线 4.5 倍`, 55);
    }
    const count = Number(history?.count ?? 0);
    const mean = Number(history?.means?.[index]);
    const deviation = Number(history?.deviations?.[index]);
    if (count >= 30 && finite(mean) && finite(deviation) && deviation > 0.001) {
      const zScore = Math.abs((value - mean) / deviation);
      if (zScore > 6) add(`DIMENSION_${index + 1}_ROBUST_OUTLIER`, `第 ${index + 1} 项职业指标偏离同职业历史分布`, 45);
    }
  });

  const anomalyScore = clamp(score, 0, 100);
  return {
    action: anomalyScore >= 80 ? "quarantine" : "accept",
    score: anomalyScore,
    reasons,
    policyVersion: CALIBRATION_POLICY_VERSION,
  };
}

export function evaluateCalibrationCandidate(candidate, active = defaultCalibrationModel()) {
  const reasons = [];
  const candidateRoles = new Map((candidate?.roles ?? []).map((entry) => [entry.role, entry]));
  const activeRoles = new Map((active?.roles ?? []).map((entry) => [entry.role, entry]));
  let maxExpectedDrift = 0;

  if (!candidate || !Array.isArray(candidate.roles) || candidate.roles.length !== CALIBRATION_ROLES.length) {
    reasons.push("候选模型缺少六职业完整参数");
  }

  for (const role of CALIBRATION_ROLES) {
    const next = candidateRoles.get(role);
    const previous = activeRoles.get(role) ?? defaultCalibrationModel().roles.find((entry) => entry.role === role);
    if (!next || !Array.isArray(next.expected) || next.expected.length !== 4) {
      reasons.push(`${role} 参数不完整`);
      continue;
    }
    next.expected.forEach((value, index) => {
      const before = Number(previous?.expected?.[index] ?? value);
      if (!finite(value) || Number(value) <= 0) {
        reasons.push(`${role} 第 ${index + 1} 项参数无效`);
        return;
      }
      const drift = Math.abs(Number(value) - before) / Math.max(Math.abs(before), 0.001);
      maxExpectedDrift = Math.max(maxExpectedDrift, drift);
    });
  }

  const highlightDrift = Math.abs(Number(candidate?.highlightThreshold) - Number(active?.highlightThreshold ?? 88));
  const secondaryDrift = Math.abs(Number(candidate?.secondaryBonusWeight) - Number(active?.secondaryBonusWeight ?? 0.4));
  const deathDrift = Math.abs(Number(candidate?.deathPenaltyScale) - Number(active?.deathPenaltyScale ?? 1));

  if (maxExpectedDrift > 0.28) reasons.push("职业指标基线单次漂移超过 28%");
  if (highlightDrift > 4) reasons.push("高光阈值单次变化超过 4 分");
  if (secondaryDrift > 0.06) reasons.push("副职业奖励单次变化超过 6%");
  if (deathDrift > 0.15) reasons.push("死亡惩罚系数单次变化超过 0.15");
  if (Number(candidate?.totalSamples ?? 0) < Number(active?.totalSamples ?? 0)) reasons.push("候选模型样本量低于当前稳定版本");

  const qualityScore = Math.round(clamp(
    100 - maxExpectedDrift * 120 - highlightDrift * 3 - secondaryDrift * 100 - deathDrift * 40 - reasons.length * 8,
    0,
    100,
  ));

  return {
    safe: reasons.length === 0,
    qualityScore,
    maxExpectedDrift: Math.round(maxExpectedDrift * 10_000) / 10_000,
    reasons,
    policyVersion: CALIBRATION_POLICY_VERSION,
  };
}

export function calibrationCohortBucket(cohort) {
  const text = String(cohort ?? "public");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function selectCalibrationRelease(active, candidate, cohort, rolloutPercentage = DEFAULT_CANARY_PERCENTAGE) {
  const rollout = clamp(Math.round(Number(rolloutPercentage) || 0), 0, 100);
  const bucket = calibrationCohortBucket(cohort);
  const useCandidate = Boolean(candidate) && rollout > 0 && bucket < rollout;
  return {
    model: useCandidate ? candidate : active,
    channel: useCandidate ? "canary" : active?.version === "rules-2026.07" ? "baseline" : "stable",
    bucket,
    rolloutPercentage: rollout,
  };
}
