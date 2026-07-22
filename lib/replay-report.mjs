const ROLE_NAMES = ["辅助", "法师", "刺客", "坦克", "射手", "战士"];

export function normalizeScoringSnapshot(value) {
  if (!value || typeof value !== "object") return undefined;
  const model = value.model;
  if (!model || typeof model.version !== "string" || !Array.isArray(model.roles) || model.roles.length !== ROLE_NAMES.length) return undefined;
  if (!model.roles.every((entry) => entry && ROLE_NAMES.includes(entry.role) && Array.isArray(entry.expected) && entry.expected.length === 4)) return undefined;
  const scoredAt = String(value.scoredAt ?? "");
  if (!Number.isFinite(Date.parse(scoredAt))) return undefined;
  return { modelVersion: model.version, scoredAt, model };
}
