import { rateLimitBucket, routePolicy, shouldRecordHealth } from "./service-operations-core.mjs";

type ServiceEnv = {
  DB: D1Database;
  RATE_LIMIT_SALT?: string;
  ALERT_WEBHOOK_URL?: string;
};

export type RoutePolicy = { key: string; limit: number };
export { rateLimitBucket, routePolicy, shouldRecordHealth };

export async function enforceRateLimit(env: ServiceEnv, request: Request, policy: RoutePolicy) {
  const now = Date.now();
  const bucket = await rateLimitBucket(request, policy.key, env.RATE_LIMIT_SALT ?? "haidou-ephemeral-rate-limit", now);
  const expiresAt = new Date(now + 120_000).toISOString();
  await env.DB.prepare(`INSERT INTO service_rate_limits (bucket, request_count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET request_count = request_count + 1, expires_at = excluded.expires_at`)
    .bind(bucket, expiresAt).run();
  const row = await env.DB.prepare("SELECT request_count FROM service_rate_limits WHERE bucket = ?")
    .bind(bucket).first<{ request_count: number }>();
  const count = Number(row?.request_count ?? 1);
  return { allowed: count <= policy.limit, limit: policy.limit, remaining: Math.max(0, policy.limit - count), retryAfter: 60 };
}

export async function recordHealthEvent(env: ServiceEnv, route: string, status: number, latencyMs: number, errorCode = "") {
  if (!shouldRecordHealth(status, latencyMs)) return;
  await env.DB.prepare(`INSERT INTO service_health_events (id, route, status_code, latency_ms, error_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), route, status, Math.round(latencyMs), errorCode, new Date().toISOString()).run();
}

export async function maybeSendAlert(env: ServiceEnv) {
  if (!env.ALERT_WEBHOOK_URL) return;
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM service_health_events
    WHERE created_at >= ? AND (status_code >= 500 OR status_code = 429)`).bind(cutoff).first<{ total: number }>();
  const total = Number(row?.total ?? 0);
  if (total < 5) return;
  const alertKey = `service-errors:${new Date().toISOString().slice(0, 13)}`;
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO service_alerts (alert_key, severity, message, created_at)
    VALUES (?, 'critical', ?, ?)`).bind(alertKey, `海斗估算服务 10 分钟内出现 ${total} 次限流或服务错误。`, new Date().toISOString()).run();
  if (!Number(inserted.meta.changes ?? 0)) return;
  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `海斗估算服务告警：10 分钟内出现 ${total} 次限流或服务错误，请检查 /api/health。` }),
  });
}

export async function handleHealthGet(env: ServiceEnv) {
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const metrics = await env.DB.prepare(`SELECT COUNT(*) AS events,
    SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS errors,
    SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END) AS throttled,
    MAX(latency_ms) AS max_latency FROM service_health_events WHERE created_at >= ?`).bind(cutoff).first<Record<string, number>>();
  const activeModels = await env.DB.prepare("SELECT COUNT(*) AS total FROM calibration_governance").first<{ total: number }>();
  const errors = Number(metrics?.errors ?? 0);
  return Response.json({
    status: errors >= 5 ? "degraded" : "ok",
    windowMinutes: 60,
    events: Number(metrics?.events ?? 0),
    errors,
    throttled: Number(metrics?.throttled ?? 0),
    maxLatencyMs: Number(metrics?.max_latency ?? 0),
    calibrationScopes: Number(activeModels?.total ?? 0),
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}

export async function runRetention(env: ServiceEnv) {
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM calibration_samples WHERE submitted_at < ?").bind(daysAgo(365)),
    env.DB.prepare("DELETE FROM calibration_sample_anomalies WHERE submitted_at < ?").bind(daysAgo(365)),
    env.DB.prepare("DELETE FROM rating_matches WHERE submitted_at < ?").bind(daysAgo(365)),
    env.DB.prepare("DELETE FROM service_rate_limits WHERE expires_at < ?").bind(new Date(now).toISOString()),
    env.DB.prepare("DELETE FROM service_health_events WHERE created_at < ?").bind(daysAgo(30)),
    env.DB.prepare("DELETE FROM service_alerts WHERE created_at < ?").bind(daysAgo(30)),
    env.DB.prepare(`DELETE FROM calibration_model_versions WHERE created_at < ?
      AND status IN ('rejected', 'superseded')
      AND version NOT IN (
        SELECT active_version FROM calibration_governance
        UNION SELECT candidate_version FROM calibration_governance WHERE candidate_version IS NOT NULL
        UNION SELECT previous_stable_version FROM calibration_governance WHERE previous_stable_version IS NOT NULL
        UNION SELECT rollback_version FROM calibration_governance WHERE rollback_version IS NOT NULL
      )`).bind(daysAgo(730)),
  ]);
}
