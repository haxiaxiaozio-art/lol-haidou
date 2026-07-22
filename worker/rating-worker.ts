import { handleRatingGet, handleRatingPost } from "../lib/rating-api";
import { handleCalibrationGet, handleCalibrationGovernanceGet, handleCalibrationGovernancePost, handleCalibrationPost, handleCalibrationReplayGet } from "../lib/calibration-api";
import { enforceRateLimit, handleHealthGet, maybeSendAlert, recordHealthEvent, routePolicy, runRetention } from "../lib/service-operations";

interface Env {
  DB: D1Database;
  CALIBRATION_ADMIN_TOKEN?: string;
  RATE_LIMIT_SALT?: string;
  ALERT_WEBHOOK_URL?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    const policy = routePolicy(url.pathname, request.method);
    const startedAt = Date.now();
    let result: Response;
    let errorCode = "";
    try {
      const rate = await enforceRateLimit(env, request, policy);
      if (!rate.allowed) {
        result = Response.json({ error: "Too many requests.", retryAfter: rate.retryAfter }, {
          status: 429,
          headers: { ...corsHeaders, "Retry-After": String(rate.retryAfter), "X-RateLimit-Limit": String(rate.limit), "X-RateLimit-Remaining": "0" },
        });
      } else if (url.pathname === "/api/health" && request.method === "GET") {
        result = await handleHealthGet(env);
      } else if (url.pathname === "/api/calibration/replay" && request.method === "GET") {
        result = await handleCalibrationReplayGet(env.DB, request);
      } else if (url.pathname === "/api/calibration/governance") {
        if (request.method === "GET") result = await handleCalibrationGovernanceGet(env.DB, request);
        else if (request.method === "POST") result = await handleCalibrationGovernancePost(env.DB, request, env.CALIBRATION_ADMIN_TOKEN);
        else result = Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
      } else if (url.pathname === "/api/calibration") {
        if (request.method === "GET") result = await handleCalibrationGet(env.DB, request);
        else if (request.method === "POST") result = await handleCalibrationPost(env.DB, request);
        else result = Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
      } else if (url.pathname === "/api/rating") {
        if (request.method === "GET") result = await handleRatingGet(env.DB, request);
        else if (request.method === "POST") result = await handleRatingPost(env.DB, request);
        else result = Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
      } else {
        result = Response.json({ error: "Not found." }, { status: 404 });
      }
    } catch (error) {
      errorCode = error instanceof Error ? error.name : "UnknownError";
      result = Response.json({ error: "Service temporarily unavailable.", code: errorCode }, { status: 503, headers: corsHeaders });
    }
    ctx.waitUntil(recordHealthEvent(env, policy.key, result.status, Date.now() - startedAt, errorCode)
      .then(() => maybeSendAlert(env)).catch(() => undefined));
    return result;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRetention(env).then(() => maybeSendAlert(env)));
  },
};

export default worker;
