import { CALIBRATION_ROLES, ROLE_BLUEPRINTS, defaultCalibrationModel } from "./calibration-core.mjs";
import type { CalibrationModel, Role } from "./types";

type CalibrationSample = {
  id: string;
  matchHash: string;
  playedAt: string;
  patch: string;
  role: Role;
  secondaryRole: Role | null;
  dimensions: number[];
  secondaryScore: number | null;
  operationScore: number;
  deathsPerTen: number;
  recallApplied: boolean;
  won: boolean;
};

type RoleAggregate = {
  role: string;
  samples: number;
  d1: number | null;
  d2: number | null;
  d3: number | null;
  d4: number | null;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REGION_PATTERN = /^[A-Z0-9]{2,8}$/;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: JSON_HEADERS });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function validSample(value: unknown): value is CalibrationSample {
  if (!value || typeof value !== "object") return false;
  const sample = value as CalibrationSample;
  const playedAt = Date.parse(sample.playedAt);
  const now = Date.now();
  if (!HASH_PATTERN.test(String(sample.id)) || !HASH_PATTERN.test(String(sample.matchHash)) || !Number.isFinite(playedAt) || playedAt > now + 86_400_000 || playedAt < now - 3 * 365 * 86_400_000) return false;
  if (!CALIBRATION_ROLES.includes(sample.role) || (sample.secondaryRole !== null && !CALIBRATION_ROLES.includes(sample.secondaryRole))) return false;
  if (typeof sample.patch !== "string" || sample.patch.length < 2 || sample.patch.length > 24) return false;
  const limits = ROLE_BLUEPRINTS[sample.role]?.map((definition: { expected: number }) => definition.expected * 6) ?? [];
  if (!Array.isArray(sample.dimensions) || sample.dimensions.length !== 4 || sample.dimensions.some((item, index) => !Number.isFinite(item) || item < 0 || item > limits[index])) return false;
  if (sample.secondaryScore !== null && (!Number.isFinite(sample.secondaryScore) || sample.secondaryScore < 0 || sample.secondaryScore > 100)) return false;
  return Number.isFinite(sample.operationScore) && sample.operationScore >= 0 && sample.operationScore <= 100
    && Number.isFinite(sample.deathsPerTen) && sample.deathsPerTen >= 0 && sample.deathsPerTen <= 100
    && typeof sample.recallApplied === "boolean" && typeof sample.won === "boolean";
}

async function buildModel(db: D1Database): Promise<CalibrationModel> {
  const fallback = defaultCalibrationModel() as CalibrationModel;
  const roleRows = await db.prepare(`SELECT role, COUNT(*) AS samples,
    AVG(d1) AS d1, AVG(d2) AS d2, AVG(d3) AS d3, AVG(d4) AS d4
    FROM calibration_samples GROUP BY role`).all<RoleAggregate>();
  const roleMap = new Map<string, RoleAggregate>(roleRows.results.map((row: RoleAggregate) => [String(row.role), row]));
  const summary = await db.prepare(`SELECT COUNT(*) AS total,
    MAX(submitted_at) AS latest,
    AVG(CASE WHEN won = 1 THEN deaths_per_ten END) AS winner_deaths,
    AVG(CASE WHEN won = 0 THEN deaths_per_ten END) AS loser_deaths,
    COUNT(secondary_score) AS dual_samples,
    AVG(secondary_score) AS secondary_mean
    FROM calibration_samples`).first<Record<string, unknown>>();
  const totalSamples = Number(summary?.total ?? 0);
  const generatedAt = String(summary?.latest ?? "");
  const roles = (CALIBRATION_ROLES as Role[]).map((role) => {
    const row = roleMap.get(role);
    const samples = Number(row?.samples ?? 0);
    const confidence = clamp(samples / 100, 0, 1);
    const defaults = ROLE_BLUEPRINTS[role].map((definition: { expected: number }) => definition.expected);
    const observed = [row?.d1, row?.d2, row?.d3, row?.d4].map(Number);
    const expected = defaults.map((value: number, index: number) => {
      const candidate = observed[index];
      if (!Number.isFinite(candidate) || candidate <= 0) return value;
      const blend = samples >= 100 ? confidence * 0.65 : 0;
      return Math.round((value * (1 - blend) + candidate * blend) * 1000) / 1000;
    });
    return { role, samples, confidence: Math.round(confidence * 100), expected };
  });

  let highlightThreshold = fallback.highlightThreshold;
  if (totalSamples >= 200) {
    const histogram = await db.prepare(`SELECT CAST(ROUND(operation_score) AS INTEGER) AS score, COUNT(*) AS samples
      FROM calibration_samples GROUP BY CAST(ROUND(operation_score) AS INTEGER) ORDER BY score ASC`).all<{ score: number; samples: number }>();
    const target = Math.ceil(totalSamples * 0.85);
    let cumulative = 0;
    for (const bucket of histogram.results) {
      cumulative += Number(bucket.samples);
      if (cumulative >= target) {
        highlightThreshold = Math.round(clamp(Number(bucket.score), 84, 93));
        break;
      }
    }
  }

  const modelConfidence = clamp(totalSamples / 600, 0, 1);
  const winnerDeaths = Number(summary?.winner_deaths);
  const loserDeaths = Number(summary?.loser_deaths);
  const learnedDeathScale = Number.isFinite(winnerDeaths) && Number.isFinite(loserDeaths)
    ? clamp((loserDeaths - winnerDeaths) / 1.2, 0.85, 1.15)
    : 1;
  const deathPenaltyScale = Math.round((1 + (learnedDeathScale - 1) * modelConfidence) * 1000) / 1000;
  const dualSamples = Number(summary?.dual_samples ?? 0);
  const secondaryMean = Number(summary?.secondary_mean);
  const learnedSecondaryWeight = dualSamples >= 100 && Number.isFinite(secondaryMean) && secondaryMean > 0
    ? clamp(20 / secondaryMean, 0.35, 0.45)
    : 0.4;
  const secondaryBonusWeight = Math.round(learnedSecondaryWeight * 1000) / 1000;
  const readyRoles = roles.filter((role) => role.samples >= 100).length;
  const status = readyRoles === 6 && totalSamples >= 1200 ? "stable" : readyRoles === 6 ? "calibrating" : "collecting";
  const versionDate = generatedAt ? generatedAt.slice(0, 10).replaceAll("-", "") : "baseline";

  return {
    version: totalSamples ? `community-v1-${versionDate}-${totalSamples}` : fallback.version,
    generatedAt,
    status,
    totalSamples,
    minimumRoleSamples: 100,
    highlightThreshold,
    secondaryBonusWeight,
    deathPenaltyScale,
    roles,
  };
}

export async function handleCalibrationGet(db: D1Database) {
  return response({ model: await buildModel(db) });
}

export async function handleCalibrationPost(db: D1Database, request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const region = String(body.region ?? "").toUpperCase();
  const samples = body.samples;
  if (body.version !== 1 || !REGION_PATTERN.test(region) || !Array.isArray(samples) || samples.length < 1 || samples.length > 200 || !samples.every(validSample)) {
    return response({ error: "Invalid calibration submission." }, 400);
  }
  const submittedAt = new Date().toISOString();
  const submittedSamples = [...new Map((samples as CalibrationSample[]).map((sample) => [sample.id, sample])).values()];
  const verifiedIds = new Set<string>();
  for (let offset = 0; offset < submittedSamples.length; offset += 80) {
    const chunk = submittedSamples.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT match_hash FROM rating_matches WHERE region = ? AND processed = 1 AND match_hash IN (${placeholders})`)
      .bind(region, ...chunk.map((sample) => sample.matchHash)).all<{ match_hash: string }>();
    for (const row of rows.results) verifiedIds.add(String(row.match_hash));
  }
  const verifiedSamples = submittedSamples.filter((sample) => verifiedIds.has(sample.matchHash));
  const matchHashes = [...new Set(verifiedSamples.map((sample) => sample.matchHash))];
  const existingCounts = new Map<string, number>();
  for (let offset = 0; offset < matchHashes.length; offset += 80) {
    const chunk = matchHashes.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT match_hash, COUNT(*) AS samples FROM calibration_samples
      WHERE region = ? AND match_hash IN (${placeholders}) GROUP BY match_hash`)
      .bind(region, ...chunk).all<{ match_hash: string; samples: number }>();
    for (const row of rows.results) existingCounts.set(String(row.match_hash), Number(row.samples));
  }
  const acceptedCandidates: CalibrationSample[] = [];
  for (const sample of verifiedSamples) {
    const count = existingCounts.get(sample.matchHash) ?? 0;
    if (count >= 10) continue;
    existingCounts.set(sample.matchHash, count + 1);
    acceptedCandidates.push(sample);
  }
  const statements = acceptedCandidates.map((sample) => db.prepare(`INSERT OR IGNORE INTO calibration_samples
      (region, sample_hash, match_hash, played_at, patch, role, secondary_role, d1, d2, d3, d4, secondary_score, operation_score, deaths_per_ten, recall_applied, won, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(region, sample.id, sample.matchHash, sample.playedAt, sample.patch, sample.role, sample.secondaryRole,
        sample.dimensions[0], sample.dimensions[1], sample.dimensions[2], sample.dimensions[3],
        sample.secondaryScore, sample.operationScore, sample.deathsPerTen, sample.recallApplied ? 1 : 0, sample.won ? 1 : 0, submittedAt));
  const results = statements.length ? await db.batch(statements) : [];
  const accepted = results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0);
  return response({ accepted, rejected: submittedSamples.length - accepted, model: await buildModel(db) });
}
