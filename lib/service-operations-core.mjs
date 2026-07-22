export function routePolicy(pathname, method) {
  if (pathname === "/api/health") return { key: "health:get", limit: 120 };
  if (pathname === "/api/calibration/governance") return { key: `governance:${method.toLowerCase()}`, limit: method === "POST" ? 10 : 60 };
  if (pathname === "/api/calibration/replay") return { key: "calibration:replay", limit: 60 };
  if (pathname === "/api/calibration") return { key: `calibration:${method.toLowerCase()}`, limit: method === "POST" ? 10 : 120 };
  if (pathname === "/api/rating") return { key: `rating:${method.toLowerCase()}`, limit: method === "POST" ? 30 : 120 };
  return { key: "unknown", limit: 120 };
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");

export async function rateLimitBucket(request, route, salt, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const client = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${client}|${route}|${minute}`));
  return `${minute}:${hex(digest).slice(0, 32)}`;
}

export function shouldRecordHealth(status, latencyMs) {
  return status === 429 || status >= 500 || latencyMs >= 2_000;
}
