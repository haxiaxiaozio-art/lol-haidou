import { ROLES, type MatchRecord, type PlayerDataset, type Role } from "./types";
import { normalizeScoringSnapshot } from "./replay-report.mjs";
import { PERFORMANCE_VERSION } from "./performance-v2.mjs";

const REQUIRED_HEADERS = [
  "match_id", "played_at", "patch", "champion", "role", "win", "duration_minutes",
  "kills", "deaths", "assists", "damage", "control_seconds", "healing", "shielding",
  "mitigated", "damage_taken", "self_healing", "gold", "augments",
] as const;

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const numberValue = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} 必须是非负数字`);
  return parsed;
};

const booleanValue = (value: unknown) =>
  ["true", "1", "win", "胜利", "是"].includes(String(value).trim().toLowerCase());

const normalizeMatch = (value: Record<string, unknown>, index: number): MatchRecord => {
  const role = String(value.role ?? "") as Role;
  if (!ROLES.includes(role)) throw new Error(`第 ${index + 1} 局职业必须是：${ROLES.join("、")}`);
  const secondaryRoleValue = value.secondaryRole ?? value.secondary_role;
  const secondaryRole = secondaryRoleValue ? String(secondaryRoleValue) as Role : undefined;
  if (secondaryRole && !ROLES.includes(secondaryRole)) throw new Error(`第 ${index + 1} 局副职业必须是：${ROLES.join("、")}`);
  const durationMinutes = numberValue(value.durationMinutes ?? value.duration_minutes, "对局时长");
  if (durationMinutes <= 0) throw new Error(`第 ${index + 1} 局对局时长必须大于 0`);
  for (const key of ["augments", "augmentIds", "items", "itemIds"] as const) {
    const entries = Array.isArray(value[key]) ? value[key] : String(value[key] ?? "").split(/[|；;]/);
    if (entries.length > 16 || entries.some((item) => !["string", "number"].includes(typeof item) || String(item).length > 120)) {
      throw new Error(`第 ${index + 1} 局 ${key} 最多 16 项，每项不超过 120 个字符`);
    }
  }
  const augments = Array.isArray(value.augments)
    ? value.augments.map((item) => String(item).trim())
    : String(value.augments ?? "").split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
  const items = Array.isArray(value.items)
    ? value.items.map(String).filter(Boolean)
    : String(value.items ?? "").split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
  const recall = value.recall as Record<string, unknown> | undefined;
  const recallMinute = value.recallPickMinute ?? value.recall_pick_minute ?? recall?.pickedAtMinute;
  const hasRecall = recallMinute !== undefined && recallMinute !== null && String(recallMinute) !== "";
  const quality = value.dataQuality as MatchRecord["dataQuality"];
  const metricFields = { damage: "damage", controlSeconds: "control_seconds", healing: "healing", shielding: "shielding", mitigated: "mitigated", damageTaken: "damage_taken", selfHealing: "self_healing", gold: "gold" };
  const metrics = {} as MatchRecord["metrics"];
  const metricsPresent: Array<keyof MatchRecord["metrics"]> = [];
  for (const [key, alias] of Object.entries(metricFields)) {
    const typedKey = key as keyof MatchRecord["metrics"];
    const raw = value[key] ?? value[alias] ?? (value.metrics as Record<string, unknown> | undefined)?.[key];
    const present = raw !== undefined && raw !== null && raw !== "" && (!quality || quality.metricsPresent?.includes(typedKey));
    metrics[typedKey] = present ? numberValue(raw, key) : 0;
    if (present) metricsPresent.push(typedKey);
  }
  const rawTeam = value.teamTotals as Record<string, unknown> | undefined;
  const teamTotals: MatchRecord["teamTotals"] = rawTeam?.participants === 5 ? { participants: 5 } : undefined;
  if (teamTotals) for (const key of ["damage", "gold", "controlSeconds"] as const) {
    if (typeof rawTeam?.[key] === "number" && Number.isFinite(rawTeam[key]) && rawTeam[key] >= metrics[key]) teamTotals[key] = rawTeam[key];
  }
  const playedAt = String(value.playedAt ?? value.played_at ?? new Date().toISOString());
  if (!Number.isFinite(Date.parse(playedAt))) throw new Error(`第 ${index + 1} 局日期无效`);
  const parsedRecall = hasRecall ? {
    pickedAtMinute: numberValue(recallMinute, "回城选择时间"),
    deathsBefore: numberValue(value.deathsBeforeRecall ?? value.deaths_before_recall ?? recall?.deathsBefore ?? 0, "回城前死亡"),
    deathsAfter: numberValue(value.deathsAfterRecall ?? value.deaths_after_recall ?? recall?.deathsAfter ?? 0, "回城后死亡"),
  } : undefined;
  if (parsedRecall && (parsedRecall.pickedAtMinute > durationMinutes || parsedRecall.deathsBefore + parsedRecall.deathsAfter !== Number(value.deaths))) throw new Error(`第 ${index + 1} 局回城时间或前后死亡数不一致`);
  return {
    id: String(value.id ?? value.match_id ?? `IMPORT-${index + 1}`),
    playedAt,
    patch: String(value.patch ?? "未知"),
    champion: String(value.champion ?? "未知英雄"),
    championId: value.championId ? String(value.championId) : undefined,
    championKey: typeof value.championKey === "string" && /^[a-zA-Z]+$/.test(value.championKey) ? value.championKey : undefined,
    augmentIds: Array.isArray(value.augmentIds) ? value.augmentIds.map(String) : undefined,
    itemIds: Array.isArray(value.itemIds) ? value.itemIds.map(String) : undefined,
    teamTotals,
    role,
    secondaryRole: secondaryRole === role ? undefined : secondaryRole,
    win: booleanValue(value.win),
    durationMinutes,
    kills: numberValue(value.kills, "击杀"),
    deaths: numberValue(value.deaths, "死亡"),
    assists: numberValue(value.assists, "助攻"),
    metrics,
    augments,
    items,
    recall: parsedRecall,
    dataQuality: {
      metricsPresent,
      roleSource: "provided",
      augmentsPresent: quality?.augmentsPresent !== false && (augments.some(Boolean) || (Array.isArray(value.augmentIds) && value.augmentIds.length > 0)),
      itemsPresent: quality?.itemsPresent !== false && (value.items !== undefined || value.itemIds !== undefined),
      recallTimeline: hasRecall ? "exact" : "unavailable",
    },
  };
};

export const parseJson = (text: string): PlayerDataset => {
  const raw = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
  const container = Array.isArray(raw) ? { matches: raw } : raw;
  if (container.scoringEngine === "performance-v2" && container.scoringEngineVersion && container.scoringEngineVersion !== PERFORMANCE_VERSION) throw new Error("该报告使用不同的 V2 规则版本，暂不支持原分数重放，请使用对应版本网站。");
  const rawMatches = container.matches;
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) throw new Error("JSON 中需要至少一局 matches 数据");
  if (rawMatches.length > 500) throw new Error("单份战报最多导入 500 场，请拆分文件后导入");
  const player = (container.player ?? {}) as Record<string, unknown>;
  return {
    schemaVersion: 1,
    source: "imported",
    player: {
      gameName: String(player.gameName ?? "导入玩家"),
      tag: String(player.tag ?? "LOCAL"),
      region: String(player.region ?? "本地数据"),
      updatedAt: new Date().toISOString(),
    },
    matches: rawMatches.map((match, index) => normalizeMatch(match as Record<string, unknown>, index)),
    scoringEngine: container.scoringEngine === "performance-v2" ? "performance-v2" : container.scoringEngine === "legacy" || container.scoringSnapshot ? "legacy" : undefined,
    scoringEngineVersion: container.scoringEngine === "performance-v2" ? PERFORMANCE_VERSION : undefined,
    scoringSnapshot: normalizeScoringSnapshot(container.scoringSnapshot) as PlayerDataset["scoringSnapshot"],
  };
};

const parseCsv = (text: string): PlayerDataset => {
  const [headers, ...rows] = parseCsvRows(text);
  if (!headers) throw new Error("CSV 文件为空");
  if (rows.length > 500) throw new Error("单份战报最多导入 500 场，请拆分文件后导入");
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV 缺少字段：${missing.join("、")}`);
  const matches = rows.map((row, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    return normalizeMatch(record, rowIndex);
  });
  if (!matches.length) throw new Error("CSV 中需要至少一局数据");
  return {
    schemaVersion: 1,
    source: "imported",
    player: { gameName: "导入玩家", tag: "LOCAL", region: "本地数据", updatedAt: new Date().toISOString() },
    matches,
  };
};

export async function importDataset(file: File): Promise<PlayerDataset> {
  if (file.size > 5 * 1024 * 1024) throw new Error("文件不能超过 5 MB");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "json"].includes(extension)) throw new Error("仅支持 .csv 或 .json 文件");
  const text = await file.text();
  return extension === "json" ? parseJson(text) : parseCsv(text);
}

export const CSV_HEADERS = [
  ...REQUIRED_HEADERS.slice(0, 5),
  "secondary_role",
  ...REQUIRED_HEADERS.slice(5),
  "items",
  "recall_pick_minute",
  "deaths_before_recall",
  "deaths_after_recall",
];
