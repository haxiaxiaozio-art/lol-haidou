import { ROLES, type MatchRecord, type PlayerDataset, type Role } from "./types";

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
  const augments = Array.isArray(value.augments)
    ? value.augments.map(String).filter(Boolean)
    : String(value.augments ?? "").split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
  const items = Array.isArray(value.items)
    ? value.items.map(String).filter(Boolean)
    : String(value.items ?? "").split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
  const recallMinute = value.recallPickMinute ?? value.recall_pick_minute;
  const hasRecall = recallMinute !== undefined && recallMinute !== null && String(recallMinute) !== "";
  return {
    id: String(value.id ?? value.match_id ?? `IMPORT-${index + 1}`),
    playedAt: String(value.playedAt ?? value.played_at ?? new Date().toISOString()),
    patch: String(value.patch ?? "未知"),
    champion: String(value.champion ?? "未知英雄"),
    role,
    secondaryRole: secondaryRole === role ? undefined : secondaryRole,
    win: booleanValue(value.win),
    durationMinutes,
    kills: numberValue(value.kills, "击杀"),
    deaths: numberValue(value.deaths, "死亡"),
    assists: numberValue(value.assists, "助攻"),
    metrics: {
      damage: numberValue(value.damage ?? (value.metrics as Record<string, unknown> | undefined)?.damage, "伤害"),
      controlSeconds: numberValue(value.controlSeconds ?? value.control_seconds ?? (value.metrics as Record<string, unknown> | undefined)?.controlSeconds, "控制时间"),
      healing: numberValue(value.healing ?? (value.metrics as Record<string, unknown> | undefined)?.healing, "治疗"),
      shielding: numberValue(value.shielding ?? (value.metrics as Record<string, unknown> | undefined)?.shielding, "护盾"),
      mitigated: numberValue(value.mitigated ?? (value.metrics as Record<string, unknown> | undefined)?.mitigated, "伤害减免"),
      damageTaken: numberValue(value.damageTaken ?? value.damage_taken ?? (value.metrics as Record<string, unknown> | undefined)?.damageTaken, "承伤"),
      selfHealing: numberValue(value.selfHealing ?? value.self_healing ?? (value.metrics as Record<string, unknown> | undefined)?.selfHealing, "自我治疗"),
      gold: numberValue(value.gold ?? (value.metrics as Record<string, unknown> | undefined)?.gold, "经济"),
    },
    augments,
    items,
    recall: hasRecall
      ? {
          pickedAtMinute: numberValue(recallMinute, "回城选择时间"),
          deathsBefore: numberValue(value.deathsBeforeRecall ?? value.deaths_before_recall ?? 0, "回城前死亡"),
          deathsAfter: numberValue(value.deathsAfterRecall ?? value.deaths_after_recall ?? 0, "回城后死亡"),
        }
      : undefined,
    dataQuality: {
      metricsPresent: ["damage", "controlSeconds", "healing", "shielding", "mitigated", "damageTaken", "selfHealing", "gold"],
      roleSource: "provided",
      augmentsPresent: value.augments !== undefined,
      itemsPresent: value.items !== undefined,
      recallTimeline: hasRecall ? "exact" : "unavailable",
    },
  };
};

const parseJson = (text: string): PlayerDataset => {
  const raw = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
  const container = Array.isArray(raw) ? { matches: raw } : raw;
  const rawMatches = container.matches;
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) throw new Error("JSON 中需要至少一局 matches 数据");
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
  };
};

const parseCsv = (text: string): PlayerDataset => {
  const [headers, ...rows] = parseCsvRows(text);
  if (!headers) throw new Error("CSV 文件为空");
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
