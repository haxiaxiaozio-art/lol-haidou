import https from "node:https";

const TENCENT_SGP_BASE_URLS = Object.freeze({
  HN1: "https://hn1-k8s-sgp.lol.qq.com:21019",
  HN10: "https://hn10-k8s-sgp.lol.qq.com:21019",
  TJ100: "https://tj100-sgp.lol.qq.com:21019",
  TJ101: "https://tj101-sgp.lol.qq.com:21019",
  NJ100: "https://nj100-sgp.lol.qq.com:21019",
  GZ100: "https://gz100-sgp.lol.qq.com:21019",
  CQ100: "https://cq100-sgp.lol.qq.com:21019",
  BGP2: "https://bgp2-k8s-sgp.lol.qq.com:21019",
  PBE: "https://pbe-sgp.lol.qq.com:21019",
  PREPBE: "https://prepbe-sgp.lol.qq.com:21019",
});

export class SgpUnavailableError extends Error {
  constructor(message, code = "SGP_UNAVAILABLE") {
    super(message);
    this.name = "SgpUnavailableError";
    this.code = code;
  }
}

const normalizedPlatformId = (value) => String(value ?? "")
  .trim()
  .toUpperCase()
  .replace(/^TENCENT_/, "");

export function resolveTencentSgpServer(platformId, region = {}) {
  const candidates = [
    platformId,
    region?.rsoPlatformId,
    region?.webRegion,
    region?.platformId,
  ].map(normalizedPlatformId).filter(Boolean);
  const subId = candidates.find((candidate) => Object.hasOwn(TENCENT_SGP_BASE_URLS, candidate));
  if (!subId) return null;
  return {
    id: `TENCENT_${subId}`,
    subId,
    baseUrl: TENCENT_SGP_BASE_URLS[subId],
  };
}

export function extractEntitlementsAccessToken(payload) {
  const token = typeof payload === "string" ? payload : payload?.accessToken;
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new SgpUnavailableError("本机登录令牌尚未准备好", "SGP_TOKEN_UNAVAILABLE");
  }
  return token.trim();
}

function sgpRequest(server, token, requestPath) {
  const url = new URL(requestPath, server.baseUrl);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      timeout: 12_000,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "HaiDouHelper/17",
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) {
          request.destroy(new SgpUnavailableError("SGP 返回的数据过大", "SGP_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = response.statusCode ?? 500;
        if (status === 401 || status === 403) {
          reject(new SgpUnavailableError("本机 SGP 鉴权失效", "SGP_AUTH_FAILED"));
          return;
        }
        if (status >= 400) {
          reject(new SgpUnavailableError(`本机 SGP 暂时不可用（${status}）`, "SGP_REQUEST_FAILED"));
          return;
        }
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new SgpUnavailableError("无法解析本机 SGP 返回的数据", "SGP_INVALID_RESPONSE"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new SgpUnavailableError("连接本机 SGP 超时", "SGP_TIMEOUT")));
    request.on("error", (error) => {
      reject(error instanceof SgpUnavailableError
        ? error
        : new SgpUnavailableError("无法连接本机 SGP", "SGP_NETWORK_ERROR"));
    });
    request.end();
  });
}

const gameTimestamp = (game) => {
  const value = Number(game?.gameCreation ?? game?.gameStartTimestamp ?? game?.gameEndTimestamp);
  return Number.isFinite(value) ? value : Number(game?.gameId ?? 0);
};

export async function querySgpHistory({
  credentials,
  player,
  region,
  count,
  lcuRequest,
  request = sgpRequest,
}) {
  const server = resolveTencentSgpServer(credentials?.platformId, region);
  if (!server) throw new SgpUnavailableError("当前大区没有可用的国服 SGP 映射", "SGP_REGION_UNSUPPORTED");
  if (!player?.puuid) throw new SgpUnavailableError("当前玩家缺少 SGP 所需的 PUUID", "SGP_PLAYER_UNAVAILABLE");

  const tokenPayload = await lcuRequest(credentials, "/entitlements/v1/token");
  const token = extractEntitlementsAccessToken(tokenPayload);
  const games = [];
  const seen = new Set();
  const pageSize = 20;

  for (let startIndex = 0; startIndex < count; startIndex += pageSize) {
    const pageCount = Math.min(pageSize, count - startIndex);
    const params = new URLSearchParams({
      startIndex: String(startIndex),
      count: String(pageCount),
    });
    const payload = await request(
      server,
      token,
      `/match-history-query/v1/products/lol/player/${encodeURIComponent(player.puuid)}/SUMMARY?${params}`,
    );
    const summaries = Array.isArray(payload?.games) ? payload.games : [];
    let added = 0;
    for (const summary of summaries) {
      const game = summary?.json;
      const id = String(game?.gameId ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      games.push(game);
      added += 1;
    }
    if (summaries.length < pageCount || added === 0) break;
  }

  return games
    .sort((left, right) => gameTimestamp(right) - gameTimestamp(left))
    .slice(0, count);
}
