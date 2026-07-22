import { createHash } from "node:crypto";
import { buildCalibrationSample } from "../lib/calibration-core.mjs";

export const DEFAULT_CALIBRATION_API = "https://lol-haidou-rating.haxiaxiaozio.workers.dev/api/calibration";

const hashMatch = (region, id) => createHash("sha256")
  .update(`haidou-match-v1|${region}|${String(id)}`, "utf8")
  .digest("hex");

const rawPlayerId = (value) => value?.puuid
  ?? value?.accountId
  ?? value?.currentAccountId
  ?? value?.summonerId
  ?? value?.id;

const hashSample = (region, matchId, playerId) => createHash("sha256")
  .update(`haidou-calibration-sample-v1|${region}|${String(matchId)}|${String(playerId)}`, "utf8")
  .digest("hex");

const hashCohort = (region, playerId) => playerId ? createHash("sha256")
  .update(`haidou-calibration-cohort-v1|${region}|${String(playerId)}`, "utf8")
  .digest("hex")
  .slice(0, 24) : "";

async function requestCalibration(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`真实样本校准服务暂时不可用（${response.status}）`);
  const body = await response.json();
  if (!body?.model) throw new Error("真实样本校准服务返回的数据不完整");
  return body;
}

export async function syncCalibration(matches, player, region, contribute = false) {
  const regionCode = String(region ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const api = String(process.env.HAIDOU_CALIBRATION_API ?? DEFAULT_CALIBRATION_API).replace(/\/$/, "");
  const playerId = rawPlayerId(player);
  const cohort = hashCohort(regionCode, playerId);
  const patch = String(matches?.find((match) => /^\d{1,2}\.\d{1,2}/.test(String(match.patch ?? "")))?.patch ?? "").match(/^\d{1,2}\.\d{1,2}/)?.[0] ?? "";
  const modelUrl = new URL(api);
  if (cohort) modelUrl.searchParams.set("cohort", cohort);
  if (patch) modelUrl.searchParams.set("patch", patch);
  if (!contribute || regionCode.length < 2 || !Array.isArray(matches) || matches.length === 0) {
    const result = await requestCalibration(modelUrl, { headers: { "User-Agent": "HaiDouHelper/17" } });
    return { model: result.model, accepted: 0, quarantined: 0 };
  }
  const eligibleMatches = matches.filter((match) =>
    !match.dataQuality || (
      match.dataQuality.metricsPresent?.length === 8
      && match.dataQuality.roleSource === "champion-primary"
      && match.dataQuality.augmentsPresent === true
    ));
  if (!playerId) throw new Error("当前玩家缺少可匿名化的客户端标识");
  const samples = eligibleMatches.slice(0, 200).map((match) => buildCalibrationSample(
    match,
    hashSample(regionCode, match.id, playerId),
    hashMatch(regionCode, match.id),
  ));
  if (samples.length === 0) {
    const result = await requestCalibration(modelUrl, { headers: { "User-Agent": "HaiDouHelper/17" } });
    return { model: result.model, accepted: 0, quarantined: 0 };
  }
  const result = await requestCalibration(modelUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "HaiDouHelper/17" },
    body: JSON.stringify({ version: 1, region: regionCode, samples }),
  });
  return { model: result.model, accepted: Number(result.accepted ?? 0), quarantined: Number(result.quarantined ?? 0) };
}
