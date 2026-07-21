import type { CalibrationModel, PlayerDataset, Role } from "./types";

export type SourceDiagnostics = {
  requestedCount: number | null;
  scannedCount: number;
  haidouCount: number;
};

export type DataQualityReport = {
  score: number;
  status: "完整" | "可用" | "需补字段";
  sourceLabel: string;
  sampleLabel: string;
  indicators: Array<{
    key: string;
    label: string;
    value: number;
    detail: string;
    tone: "good" | "warn" | "muted";
  }>;
  missingReasons: string[];
  calibrationRoles: Array<{ role: Role; samples: number; target: number; progress: number }>;
};

const percent = (value: number, total: number) => Math.round((value / Math.max(total, 1)) * 100);
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function analyzeDataQuality(
  dataset: PlayerDataset,
  diagnostics: SourceDiagnostics,
  calibration: CalibrationModel | null,
): DataQualityReport {
  const matches = dataset.matches;
  const metricsCoverage = Math.round(average(matches.map((match) =>
    match.dataQuality ? percent(match.dataQuality.metricsPresent.length, 8) : 100)));
  const roleCoverage = percent(matches.filter((match) =>
    !match.dataQuality || ["champion-primary", "provided"].includes(match.dataQuality.roleSource)).length, matches.length);
  const augmentCoverage = percent(matches.filter((match) =>
    match.dataQuality?.augmentsPresent ?? match.augments.length > 0).length, matches.length);
  const itemCoverage = percent(matches.filter((match) =>
    match.dataQuality?.itemsPresent ?? Array.isArray(match.items)).length, matches.length);
  const timelineCoverage = percent(matches.filter((match) =>
    match.dataQuality?.recallTimeline === "exact" || Boolean(match.recall)).length, matches.length);
  const scanCoverage = diagnostics.requestedCount
    ? percent(diagnostics.scannedCount, diagnostics.requestedCount)
    : 100;
  const haidouShare = percent(diagnostics.haidouCount, diagnostics.scannedCount);
  const score = Math.round(metricsCoverage * 0.4 + roleCoverage * 0.2 + augmentCoverage * 0.15 + itemCoverage * 0.2 + timelineCoverage * 0.05);
  const status = score >= 88 ? "完整" : score >= 68 ? "可用" : "需补字段";
  const missingReasons: string[] = [];

  if (dataset.source === "demo") missingReasons.push("当前是演示样本，不代表真实客户端字段覆盖。");
  if (diagnostics.requestedCount && diagnostics.scannedCount < diagnostics.requestedCount) {
    missingReasons.push(`请求 ${diagnostics.requestedCount} 场，客户端与本机日志实际返回 ${diagnostics.scannedCount} 场。`);
  }
  if (diagnostics.haidouCount < 5) missingReasons.push("本次筛出的海斗不足 5 场，操作总分暂不具备稳定性。");
  if (metricsCoverage < 100) missingReasons.push("部分战斗指标缺失，缺失字段不会被当作真实的 0 表现解释。");
  if (roleCoverage < 100) missingReasons.push("部分英雄缺少客户端主分类，已回退到对局位置或战士分类。");
  if (itemCoverage < 100) missingReasons.push("部分对局没有最终装备栏，出装偏好只基于可用场次。");
  if (timelineCoverage < 100) missingReasons.push("客户端历史战绩没有完整海克斯选择时间线，回城前后死亡只在存在精确时间线时启用。");
  if (matches.some((match) => [...match.augments, ...(match.items ?? [])].some((name) => /(?:海克斯|装备)\s*\d+/i.test(name)))) {
    missingReasons.push("仍有海克斯或装备只返回数字 ID，名称表覆盖不完整。");
  }
  if (!calibration) missingReasons.push("未取得社区校准模型，本次评分继续使用版本化固定基线。");

  const target = calibration?.minimumRoleSamples ?? 100;
  const calibrationRoles = (calibration?.roles ?? []).map((entry) => ({
    role: entry.role,
    samples: entry.samples,
    target,
    progress: Math.min(100, percent(entry.samples, target)),
  }));

  return {
    score,
    status,
    sourceLabel: dataset.source === "local-client" ? "LOL 客户端 + 本机日志" : dataset.source === "imported" ? "本地 CSV / JSON" : "内置演示数据",
    sampleLabel: `${diagnostics.scannedCount} 场扫描 · ${diagnostics.haidouCount} 场海斗`,
    indicators: [
      { key: "scan", label: "扫描返回", value: scanCoverage, detail: diagnostics.requestedCount ? `${diagnostics.scannedCount}/${diagnostics.requestedCount} 场` : `${diagnostics.scannedCount} 场`, tone: scanCoverage >= 90 ? "good" : "warn" },
      { key: "filter", label: "海斗筛选", value: haidouShare, detail: `${diagnostics.haidouCount}/${Math.max(diagnostics.scannedCount, 0)} 场`, tone: diagnostics.haidouCount >= 5 ? "good" : "warn" },
      { key: "role", label: "职业识别", value: roleCoverage, detail: roleCoverage === 100 ? "主分类完整" : "含位置回退", tone: roleCoverage >= 95 ? "good" : "warn" },
      { key: "metrics", label: "战斗字段", value: metricsCoverage, detail: "8 项核心指标", tone: metricsCoverage >= 95 ? "good" : "warn" },
      { key: "items", label: "装备覆盖", value: itemCoverage, detail: `${itemCoverage}% 对局可用`, tone: itemCoverage >= 90 ? "good" : "warn" },
      { key: "timeline", label: "时序精度", value: timelineCoverage, detail: timelineCoverage ? "含精确回城节点" : "仅赛后汇总", tone: timelineCoverage >= 80 ? "good" : "muted" },
    ],
    missingReasons,
    calibrationRoles,
  };
}
