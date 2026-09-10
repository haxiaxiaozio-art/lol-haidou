import { parseJson } from "./importers";
import type { PlayerDataset } from "./types";

export function restoreReport(text: string): PlayerDataset {
  if (text.length > 5 * 1024 * 1024) throw new Error("战报文件不能超过 5 MB");
  const raw = JSON.parse(text);
  if (!raw || !["local-client", "imported"].includes(raw.source)) throw new Error("请恢复已导出的战报，不接受演示样本");
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.matches) || !raw.player
    || [raw.player.gameName, raw.player.tag, raw.player.region].some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error("战报缺少玩家身份或对局，请选择本站导出的 JSON 备份");
  }
  const dataset = parseJson(text);
  return { ...dataset, player: { ...dataset.player, updatedAt: Number.isFinite(Date.parse(raw.player.updatedAt)) ? raw.player.updatedAt : dataset.player.updatedAt } };
}
