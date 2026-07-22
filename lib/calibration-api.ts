import { CALIBRATION_ROLES, ROLE_BLUEPRINTS, defaultCalibrationModel } from "./calibration-core.mjs";
import {
  CALIBRATION_POLICY_VERSION,
  DEFAULT_CANARY_PERCENTAGE,
  detectCalibrationAnomaly,
  evaluateCalibrationCandidate,
  selectCalibrationRelease,
} from "./calibration-governance.mjs";
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

type RoleAggregate = { role: string; samples: number; d1: number | null; d2: number | null; d3: number | null; d4: number | null };
type HistoryAggregate = RoleAggregate & { q1: number | null; q2: number | null; q3: number | null; q4: number | null };
type HistoryStats = { count: number; means: number[]; deviations: number[] };
type GovernanceRow = {
  active_version: string;
  candidate_version: string | null;
  previous_stable_version: string | null;
  rollback_version: string | null;
  rollout_percentage: number;
  updated_at: string;
};
type VersionRow = {
  version: string;
  scope: string;
  status: string;
  model_json: string;
  quality_score: number;
  max_expected_drift: number;
  sample_count: number;
  rollout_percentage: number;
  parent_version: string | null;
  rollback_version: string | null;
  policy_version: string;
  notes: string;
  created_at: string;
  activated_at: string | null;
  retired_at: string | null;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REGION_PATTERN = /^[A-Z0-9]{2,8}$/;
const PATCH_PATTERN = /^\d{1,2}\.\d{1,2}$/;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: JSON_HEADERS });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizePatch = (value: unknown) => {
  const match = String(value ?? "").trim().match(/^(\d{1,2}\.\d{1,2})/);
  return match?.[1] ?? "";
};
const patchScope = (patch: string) => `patch:${patch || "baseline"}`;

async function requestedPatch(db: D1Database, request?: Request) {
  const requested = request ? normalizePatch(new URL(request.url).searchParams.get("patch")) : "";
  if (requested) return requested;
  const latest = await db.prepare(`SELECT patch FROM calibration_samples
    WHERE patch GLOB '[0-9]*.[0-9]*' ORDER BY played_at DESC LIMIT 1`).first<{ patch: string }>();
  return normalizePatch(latest?.patch);
}

function validSample(value: unknown): value is CalibrationSample {
  if (!value || typeof value !== "object") return false;
  const sample = value as CalibrationSample;
  const playedAt = Date.parse(sample.playedAt);
  const now = Date.now();
  if (!HASH_PATTERN.test(String(sample.id)) || !HASH_PATTERN.test(String(sample.matchHash)) || !Number.isFinite(playedAt) || playedAt > now + 86_400_000 || playedAt < now - 3 * 365 * 86_400_000) return false;
  if (!CALIBRATION_ROLES.includes(sample.role) || (sample.secondaryRole !== null && !CALIBRATION_ROLES.includes(sample.secondaryRole))) return false;
  if (!PATCH_PATTERN.test(normalizePatch(sample.patch))) return false;
  const limits = ROLE_BLUEPRINTS[sample.role]?.map((definition: { expected: number }) => definition.expected * 6) ?? [];
  if (!Array.isArray(sample.dimensions) || sample.dimensions.length !== 4 || sample.dimensions.some((item, index) => !Number.isFinite(item) || item < 0 || item > limits[index])) return false;
  if (sample.secondaryScore !== null && (!Number.isFinite(sample.secondaryScore) || sample.secondaryScore < 0 || sample.secondaryScore > 100)) return false;
  return Number.isFinite(sample.operationScore) && sample.operationScore >= 0 && sample.operationScore <= 100
    && Number.isFinite(sample.deathsPerTen) && sample.deathsPerTen >= 0 && sample.deathsPerTen <= 100
    && typeof sample.recallApplied === "boolean" && typeof sample.won === "boolean";
}

function baselineModel(patch: string): CalibrationModel {
  const fallback = defaultCalibrationModel() as CalibrationModel;
  return patch ? { ...fallback, patch, version: `${fallback.version}-p${patch.replace(".", "_")}` } : fallback;
}

export async function buildCalibrationModel(db: D1Database, patch = ""): Promise<CalibrationModel> {
  const scopedPatch = normalizePatch(patch);
  const fallback = baselineModel(scopedPatch);
  if (!scopedPatch) return fallback;
  const roleRows = await db.prepare(`SELECT role, COUNT(*) AS samples,
    AVG(d1) AS d1, AVG(d2) AS d2, AVG(d3) AS d3, AVG(d4) AS d4
    FROM calibration_samples WHERE patch = ? GROUP BY role`).bind(scopedPatch).all<RoleAggregate>();
  const roleMap = new Map<string, RoleAggregate>(roleRows.results.map((row: RoleAggregate) => [String(row.role), row]));
  const summary = await db.prepare(`SELECT COUNT(*) AS total,
    MAX(submitted_at) AS latest,
    AVG(CASE WHEN won = 1 THEN deaths_per_ten END) AS winner_deaths,
    AVG(CASE WHEN won = 0 THEN deaths_per_ten END) AS loser_deaths,
    COUNT(secondary_score) AS dual_samples,
    AVG(secondary_score) AS secondary_mean
    FROM calibration_samples WHERE patch = ?`).bind(scopedPatch).first<Record<string, unknown>>();
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
      FROM calibration_samples WHERE patch = ? GROUP BY CAST(ROUND(operation_score) AS INTEGER) ORDER BY score ASC`)
      .bind(scopedPatch).all<{ score: number; samples: number }>();
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
    version: totalSamples ? `community-v3-p${scopedPatch.replace(".", "_")}-${versionDate}-${totalSamples}` : fallback.version,
    patch: scopedPatch,
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

async function anomalyWindow(db: D1Database, patch: string) {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const acceptedRow = await db.prepare("SELECT COUNT(*) AS total FROM calibration_samples WHERE patch = ? AND submitted_at >= ?")
    .bind(patch, cutoff).first<{ total: number }>();
  const quarantinedRow = await db.prepare("SELECT COUNT(*) AS total FROM calibration_sample_anomalies WHERE patch = ? AND submitted_at >= ?")
    .bind(patch, cutoff).first<{ total: number }>();
  const accepted = Number(acceptedRow?.total ?? 0);
  const quarantined = Number(quarantinedRow?.total ?? 0);
  const total = accepted + quarantined;
  return { accepted, quarantined, quarantineRate: total ? Math.round((quarantined / total) * 1000) / 10 : 0, windowDays: 7 };
}

async function loadVersion(db: D1Database, version: string | null): Promise<{ model: CalibrationModel; row: VersionRow } | null> {
  if (!version) return null;
  const row = await db.prepare("SELECT * FROM calibration_model_versions WHERE version = ?").bind(version).first<VersionRow>();
  if (!row) return null;
  try {
    return { model: JSON.parse(row.model_json) as CalibrationModel, row };
  } catch {
    return null;
  }
}

async function saveVersion(db: D1Database, scope: string, model: CalibrationModel, status: string, evaluation: ReturnType<typeof evaluateCalibrationCandidate>, parentVersion: string | null, rolloutPercentage = 0) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO calibration_model_versions
    (version, scope, status, model_json, quality_score, max_expected_drift, sample_count, rollout_percentage, parent_version, rollback_version, policy_version, notes, created_at, activated_at, retired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`)
    .bind(model.version, scope, status, JSON.stringify(model), evaluation.qualityScore, evaluation.maxExpectedDrift, model.totalSamples,
      rolloutPercentage, parentVersion, CALIBRATION_POLICY_VERSION, JSON.stringify(evaluation.reasons), now, status === "active" ? now : null).run();
}

async function ensureGovernanceRow(db: D1Database, scope: string, patch: string) {
  const fallback = baselineModel(patch);
  const evaluation = evaluateCalibrationCandidate(fallback, fallback);
  await saveVersion(db, scope, fallback, "active", evaluation, null, 100);
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO calibration_governance
    (scope, active_version, candidate_version, previous_stable_version, rollback_version, rollout_percentage, updated_at)
    VALUES (?, ?, NULL, NULL, NULL, 0, ?)`).bind(scope, fallback.version, now).run();
  return db.prepare("SELECT * FROM calibration_governance WHERE scope = ?").bind(scope).first<GovernanceRow>();
}

async function promoteCandidate(db: D1Database, scope: string, governance: GovernanceRow, candidate: VersionRow) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE calibration_model_versions SET status = 'stable', rollout_percentage = 100, activated_at = COALESCE(activated_at, ?) WHERE version = ?").bind(now, candidate.version),
    db.prepare("UPDATE calibration_model_versions SET status = 'superseded', retired_at = ? WHERE version = ? AND version <> ?").bind(now, governance.active_version, candidate.version),
    db.prepare(`UPDATE calibration_governance SET active_version = ?, candidate_version = NULL,
      previous_stable_version = ?, rollback_version = NULL, rollout_percentage = 0, updated_at = ? WHERE scope = ?`)
      .bind(candidate.version, governance.active_version, now, scope),
  ]);
}

async function rollbackCandidate(db: D1Database, governance: GovernanceRow, candidate: VersionRow, reasons: string[]) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE calibration_model_versions SET status = 'rolled_back', rollback_version = ?, notes = ?, rollout_percentage = 0, retired_at = ? WHERE version = ?")
      .bind(governance.active_version, JSON.stringify(reasons), now, candidate.version),
    db.prepare(`UPDATE calibration_governance SET candidate_version = NULL, rollback_version = ?, rollout_percentage = 0, updated_at = ? WHERE scope = ?`)
      .bind(candidate.version, now, candidate.scope),
  ]);
}

async function buildGovernedModel(db: D1Database, request?: Request): Promise<CalibrationModel> {
  const patch = await requestedPatch(db, request);
  const scope = patchScope(patch);
  const observed = await buildCalibrationModel(db, patch);
  let governance = await ensureGovernanceRow(db, scope, patch);
  if (!governance) throw new Error("Calibration governance state is unavailable.");
  let activeEntry = await loadVersion(db, governance.active_version);
  if (!activeEntry) activeEntry = { model: baselineModel(patch), row: {} as VersionRow };
  let candidateEntry = await loadVersion(db, governance.candidate_version);
  const window = await anomalyWindow(db, patch);
  let rolledBack = false;

  if (candidateEntry) {
    const guard = evaluateCalibrationCandidate(candidateEntry.model, activeEntry.model);
    const canaryAge = Date.now() - Date.parse(candidateEntry.row.created_at);
    if (!guard.safe || (window.quarantined >= 10 && window.quarantineRate > 25)) {
      await rollbackCandidate(db, governance, candidateEntry.row, guard.reasons.length ? guard.reasons : ["异常样本隔离率超过 25%"]);
      candidateEntry = null;
      governance = await ensureGovernanceRow(db, scope, patch) as GovernanceRow;
      rolledBack = true;
    } else if (canaryAge >= 24 * 60 * 60 * 1000 && window.accepted >= 50 && window.quarantineRate <= 10) {
      await promoteCandidate(db, scope, governance, candidateEntry.row);
      governance = await ensureGovernanceRow(db, scope, patch) as GovernanceRow;
      activeEntry = await loadVersion(db, governance.active_version) ?? activeEntry;
      candidateEntry = null;
    }
  }

  const minimumSnapshotDelta = activeEntry.model.version.startsWith("rules-2026.07") ? 100 : 200;
  if (!candidateEntry && observed.totalSamples >= activeEntry.model.totalSamples + minimumSnapshotDelta) {
    const evaluation = evaluateCalibrationCandidate(observed, activeEntry.model);
    if (evaluation.safe && window.quarantineRate <= 20) {
      await saveVersion(db, scope, observed, "canary", evaluation, activeEntry.model.version, DEFAULT_CANARY_PERCENTAGE);
      const now = new Date().toISOString();
      await db.prepare("UPDATE calibration_governance SET candidate_version = ?, rollout_percentage = ?, rollback_version = NULL, updated_at = ? WHERE scope = ?")
        .bind(observed.version, DEFAULT_CANARY_PERCENTAGE, now, scope).run();
      governance = await ensureGovernanceRow(db, scope, patch) as GovernanceRow;
      candidateEntry = await loadVersion(db, observed.version);
    } else if (!evaluation.safe) {
      await saveVersion(db, scope, observed, "rejected", evaluation, activeEntry.model.version, 0);
      await db.prepare("UPDATE calibration_governance SET rollback_version = ?, updated_at = ? WHERE scope = ?")
        .bind(observed.version, new Date().toISOString(), scope).run();
      governance = await ensureGovernanceRow(db, scope, patch) as GovernanceRow;
      rolledBack = true;
    }
  }

  const cohort = request ? new URL(request.url).searchParams.get("cohort") : null;
  const release = selectCalibrationRelease(
    activeEntry.model,
    candidateEntry?.model ?? null,
    cohort,
    cohort ? governance.rollout_percentage : 0,
  );
  const progressModel = release.model.version.startsWith("rules-2026.07") && observed.totalSamples > 0
    ? { ...release.model, generatedAt: observed.generatedAt, status: observed.status, totalSamples: observed.totalSamples, roles: observed.roles }
    : release.model;
  const evaluation = evaluateCalibrationCandidate(candidateEntry?.model ?? activeEntry.model, activeEntry.model);

  return {
    ...progressModel,
    governance: {
      policyVersion: CALIBRATION_POLICY_VERSION,
      patch,
      activeVersion: activeEntry.model.version,
      candidateVersion: candidateEntry?.model.version ?? null,
      rollbackVersion: governance.rollback_version,
      channel: rolledBack || (!candidateEntry && governance.rollback_version) ? "rollback" : release.channel,
      rolloutPercentage: candidateEntry ? governance.rollout_percentage : 0,
      cohortBucket: cohort ? release.bucket : null,
      qualityScore: evaluation.qualityScore,
      maxExpectedDrift: evaluation.maxExpectedDrift,
      anomalyWindow: window,
    },
  };
}

async function historicalRoleStats(db: D1Database, patch: string): Promise<Map<string, HistoryStats>> {
  const rows = await db.prepare(`SELECT role, COUNT(*) AS samples,
    AVG(d1) AS d1, AVG(d2) AS d2, AVG(d3) AS d3, AVG(d4) AS d4,
    AVG(d1 * d1) AS q1, AVG(d2 * d2) AS q2, AVG(d3 * d3) AS q3, AVG(d4 * d4) AS q4
    FROM calibration_samples WHERE patch = ? GROUP BY role`).bind(patch).all<HistoryAggregate>();
  return new Map<string, HistoryStats>(rows.results.map((row: HistoryAggregate) => {
    const means = [row.d1, row.d2, row.d3, row.d4].map(Number);
    const squares = [row.q1, row.q2, row.q3, row.q4].map(Number);
    const deviations = means.map((mean, index) => Math.sqrt(Math.max(0, squares[index] - mean * mean)));
    return [String(row.role), { count: Number(row.samples), means, deviations }];
  }));
}

export async function handleCalibrationGet(db: D1Database, request?: Request) {
  return response({ model: await buildGovernedModel(db, request) });
}

export async function handleCalibrationReplayGet(db: D1Database, request: Request) {
  const url = new URL(request.url);
  const version = String(url.searchParams.get("version") ?? "").trim();
  const patch = normalizePatch(url.searchParams.get("patch"));
  const at = String(url.searchParams.get("at") ?? "").trim();
  let entry: { model: CalibrationModel; row: VersionRow } | null = null;

  if (version) {
    entry = await loadVersion(db, version);
  } else {
    if (!patch || !Number.isFinite(Date.parse(at))) return response({ error: "A model version, or patch plus replay time, is required." }, 400);
    const row = await db.prepare(`SELECT * FROM calibration_model_versions
      WHERE scope = ? AND created_at <= ? ORDER BY created_at DESC LIMIT 1`)
      .bind(patchScope(patch), new Date(at).toISOString()).first<VersionRow>();
    if (row) {
      try { entry = { row, model: JSON.parse(row.model_json) as CalibrationModel }; } catch { entry = null; }
    }
  }

  if (!entry) return response({ error: "Historical calibration model was not found." }, 404);
  return response({
    model: entry.model,
    replay: { version: entry.row.version, patch: entry.model.patch ?? patch, generatedAt: entry.row.created_at },
  });
}

export async function handleCalibrationGovernanceGet(db: D1Database, request: Request) {
  const model = await buildGovernedModel(db, request);
  const scope = patchScope(await requestedPatch(db, request));
  const versions = await db.prepare(`SELECT version, status, quality_score, max_expected_drift, sample_count,
    rollout_percentage, parent_version, rollback_version, policy_version, notes, created_at, activated_at, retired_at
    FROM calibration_model_versions WHERE scope = ? ORDER BY created_at DESC LIMIT 20`)
    .bind(scope).all<Omit<VersionRow, "model_json">>();
  return response({ model, versions: versions.results });
}

export async function handleCalibrationPost(db: D1Database, request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const region = String(body.region ?? "").toUpperCase();
  const samples = body.samples;
  if (body.version !== 1 || !REGION_PATTERN.test(region) || !Array.isArray(samples) || samples.length < 1 || samples.length > 200 || !samples.every(validSample)) {
    return response({ error: "Invalid calibration submission." }, 400);
  }
  const submittedAt = new Date().toISOString();
  const submittedSamples = [...new Map((samples as CalibrationSample[]).map((sample) => [sample.id, {
    ...sample,
    patch: normalizePatch(sample.patch),
  }])).values()];
  const verifiedIds = new Set<string>();
  for (let offset = 0; offset < submittedSamples.length; offset += 80) {
    const chunk = submittedSamples.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT match_hash FROM rating_matches WHERE region = ? AND processed = 1 AND match_hash IN (${placeholders})`)
      .bind(region, ...chunk.map((sample) => sample.matchHash)).all<{ match_hash: string }>();
    for (const row of rows.results) verifiedIds.add(String(row.match_hash));
  }
  const verifiedSamples = submittedSamples.filter((sample) => verifiedIds.has(sample.matchHash));
  const histories = new Map<string, Map<string, HistoryStats>>();
  for (const patch of new Set(verifiedSamples.map((sample) => sample.patch))) histories.set(patch, await historicalRoleStats(db, patch));
  const reviewed = verifiedSamples.map((sample) => ({
    sample,
    anomaly: detectCalibrationAnomaly(sample, histories.get(sample.patch)?.get(sample.role)),
  }));
  const quarantined = reviewed.filter((entry) => entry.anomaly.action === "quarantine");
  if (quarantined.length) {
    await db.batch(quarantined.map(({ sample, anomaly }) => db.prepare(`INSERT OR IGNORE INTO calibration_sample_anomalies
      (region, sample_hash, match_hash, patch, role, anomaly_score, reason_codes, policy_version, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(region, sample.id, sample.matchHash, sample.patch, sample.role, anomaly.score,
        JSON.stringify(anomaly.reasons.map((reason: { code: string }) => reason.code)), anomaly.policyVersion, submittedAt)));
  }

  const eligibleSamples = reviewed.filter((entry) => entry.anomaly.action === "accept").map((entry) => entry.sample);
  const matchHashes = [...new Set(eligibleSamples.map((sample) => sample.matchHash))];
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
  for (const sample of eligibleSamples) {
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
  const accepted = results.reduce((total: number, result: { meta: { changes?: number } }) => total + Number(result.meta.changes ?? 0), 0);
  const modelRequestUrl = new URL(request.url);
  if (!modelRequestUrl.searchParams.has("patch") && submittedSamples[0]?.patch) modelRequestUrl.searchParams.set("patch", submittedSamples[0].patch);
  return response({
    accepted,
    quarantined: quarantined.length,
    rejected: submittedSamples.length - accepted - quarantined.length,
    anomalyPolicyVersion: CALIBRATION_POLICY_VERSION,
    model: await buildGovernedModel(db, new Request(modelRequestUrl, { headers: request.headers })),
  });
}

export async function handleCalibrationGovernancePost(db: D1Database, request: Request, adminToken?: string) {
  if (!adminToken) return response({ error: "Calibration admin token is not configured." }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${adminToken}`) return response({ error: "Forbidden." }, 403);
  const body = await request.json() as { action?: string; rolloutPercentage?: number };
  const patch = await requestedPatch(db, request);
  const scope = patchScope(patch);
  const governance = await ensureGovernanceRow(db, scope, patch);
  if (!governance) return response({ error: "Governance state is unavailable." }, 503);
  const now = new Date().toISOString();

  if (body.action === "rollback") {
    const target = governance.candidate_version ? governance.active_version : governance.previous_stable_version ?? baselineModel(patch).version;
    if (target === governance.active_version && !governance.candidate_version) return response({ error: "No earlier stable model is available." }, 409);
    const rolledBackVersion = governance.candidate_version ?? governance.active_version;
    if (governance.candidate_version) {
      await db.batch([
        db.prepare("UPDATE calibration_model_versions SET status = 'rolled_back', rollback_version = ?, rollout_percentage = 0, retired_at = ? WHERE version = ?")
          .bind(target, now, rolledBackVersion),
        db.prepare(`UPDATE calibration_governance SET candidate_version = NULL, rollback_version = ?,
          rollout_percentage = 0, updated_at = ? WHERE scope = ?`).bind(rolledBackVersion, now, scope),
      ]);
    } else {
      await db.batch([
        db.prepare("UPDATE calibration_model_versions SET status = 'rolled_back', rollback_version = ?, rollout_percentage = 0, retired_at = ? WHERE version = ?")
          .bind(target, now, rolledBackVersion),
        db.prepare("UPDATE calibration_model_versions SET status = 'stable', rollout_percentage = 100, activated_at = ? WHERE version = ?")
          .bind(now, target),
        db.prepare(`UPDATE calibration_governance SET active_version = ?, candidate_version = NULL, previous_stable_version = NULL,
          rollback_version = ?, rollout_percentage = 0, updated_at = ? WHERE scope = ?`).bind(target, rolledBackVersion, now, scope),
      ]);
    }
  } else if (body.action === "set-rollout") {
    const percentage = Math.round(Number(body.rolloutPercentage));
    if (!governance.candidate_version || !Number.isFinite(percentage) || percentage < 1 || percentage > 50) {
      return response({ error: "A canary model and rollout percentage from 1 to 50 are required." }, 400);
    }
    await db.prepare("UPDATE calibration_governance SET rollout_percentage = ?, updated_at = ? WHERE scope = ?")
      .bind(percentage, now, scope).run();
    await db.prepare("UPDATE calibration_model_versions SET rollout_percentage = ? WHERE version = ?")
      .bind(percentage, governance.candidate_version).run();
  } else if (body.action === "promote") {
    const candidate = await loadVersion(db, governance.candidate_version);
    if (!candidate) return response({ error: "No canary model is available." }, 409);
    const active = await loadVersion(db, governance.active_version);
    const evaluation = evaluateCalibrationCandidate(candidate.model, active?.model ?? baselineModel(patch));
    if (!evaluation.safe) return response({ error: "Candidate guardrails failed.", reasons: evaluation.reasons }, 409);
    await promoteCandidate(db, scope, governance, candidate.row);
  } else {
    return response({ error: "Unsupported governance action." }, 400);
  }

  return response({ model: await buildGovernedModel(db, request) });
}
