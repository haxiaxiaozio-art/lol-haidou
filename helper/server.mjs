import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ClientUnavailableError, getCurrentPlayer, syncHistory } from "./lcu.mjs";

const HOST = "127.0.0.1";
const PORT = 3212;
const sessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;
const helperDirectory = dirname(fileURLToPath(import.meta.url));

function configuredOrigins() {
  const origins = new Set(
    String(process.env.HAIDOU_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  try {
    const fileOrigins = JSON.parse(readFileSync(join(helperDirectory, "allowed-origins.json"), "utf8"));
    for (const origin of Array.isArray(fileOrigins) ? fileOrigins : []) origins.add(String(origin));
  } catch {
    // A missing allowlist keeps the helper local-only.
  }
  return origins;
}

const remoteOrigins = configuredOrigins();

function allowedOrigin(origin = "") {
  try {
    const url = new URL(origin);
    const isLocal = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return isLocal || (url.protocol === "https:" && remoteOrigins.has(url.origin));
  } catch {
    return false;
  }
}

function headers(origin) {
  const result = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (allowedOrigin(origin)) {
    result["Access-Control-Allow-Origin"] = origin;
    result.Vary = "Origin";
    result["Access-Control-Allow-Headers"] = "Content-Type, X-Haidou-Session";
    result["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    result["Access-Control-Allow-Private-Network"] = "true";
  }
  return result;
}

function send(response, status, body, origin) {
  response.writeHead(status, headers(origin));
  response.end(JSON.stringify(body));
}

function validSession(request, origin) {
  const token = request.headers["x-haidou-session"];
  const session = typeof token === "string" ? sessions.get(token) : null;
  if (!session || session.origin !== origin || session.expiresAt < Date.now()) return false;
  session.expiresAt = Date.now() + SESSION_TTL;
  return true;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeError(error) {
  if (error instanceof ClientUnavailableError) {
    return { status: 503, code: error.code, message: error.message };
  }
  return { status: 502, code: "LCU_REQUEST_FAILED", message: error instanceof Error ? error.message : "读取 LOL 客户端失败" };
}

export function createHaidouHelper() {
  return createServer(async (request, response) => {
    const origin = request.headers.origin ?? "";
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin)) return send(response, 403, { error: "ORIGIN_NOT_ALLOWED" }, origin);
      response.writeHead(204, headers(origin));
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return send(response, 200, { ok: true, service: "haidou-local-helper", version: 8 }, origin);
    }
    if (!allowedOrigin(origin)) return send(response, 403, { error: "ORIGIN_NOT_ALLOWED", message: "该网站未获准连接本地数据助手" }, origin);

    if (request.method === "POST" && url.pathname === "/v1/session") {
      const token = randomBytes(24).toString("base64url");
      sessions.set(token, { origin, expiresAt: Date.now() + SESSION_TTL });
      return send(response, 200, { token, expiresInSeconds: SESSION_TTL / 1000 }, origin);
    }
    if (!validSession(request, origin)) {
      return send(response, 401, { error: "SESSION_REQUIRED", message: "请重新连接本地数据助手" }, origin);
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/client") {
        const current = await getCurrentPlayer();
        return send(response, 200, { connected: true, player: current.publicPlayer }, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/sync") {
        const body = await readBody(request);
        return send(response, 200, await syncHistory(body.count), origin);
      }
      return send(response, 404, { error: "NOT_FOUND" }, origin);
    } catch (error) {
      const safe = safeError(error);
      return send(response, safe.status, { error: safe.code, message: safe.message }, origin);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createHaidouHelper();
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") process.exit(0);
    console.error("HaiDou helper could not start.");
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`HaiDou local helper is ready at http://${HOST}:${PORT}`);
  });
}
