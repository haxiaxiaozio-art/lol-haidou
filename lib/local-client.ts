import type { LocalClientPlayer, LocalClientSyncResult } from "./types";

const HELPER_URL = "http://127.0.0.1:3211";
let sessionToken = "";

function helperOfflineMessage() {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "未找到本地数据助手。请先运行“启动数据助手.cmd”，并允许浏览器访问本地网络";
  }
  return "未找到本地数据助手，请重新双击“启动网站.cmd”";
}

export class LocalClientError extends Error {
  code: string;

  constructor(message: string, code = "LOCAL_HELPER_ERROR") {
    super(message);
    this.name = "LocalClientError";
    this.code = code;
  }
}

export type LocalConnectionProbe = {
  status: "checking" | "helper-offline" | "client-offline" | "connected";
  message: string;
  code?: string;
  player: LocalClientPlayer | null;
};

async function parseResponse<T>(response: Response): Promise<T> {
  let body: { message?: string; error?: string } & Partial<T> = {};
  try {
    body = await response.json();
  } catch {
    throw new LocalClientError("本地数据助手返回了无法识别的内容");
  }
  if (!response.ok) {
    throw new LocalClientError(body.message ?? "本地数据助手连接失败", body.error);
  }
  return body as T;
}

async function createSession() {
  let response: Response;
  try {
    response = await fetch(`${HELPER_URL}/v1/session`, { method: "POST", cache: "no-store" });
  } catch {
    throw new LocalClientError(helperOfflineMessage(), "HELPER_OFFLINE");
  }
  const body = await parseResponse<{ token: string }>(response);
  sessionToken = body.token;
}

async function helperRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!sessionToken) await createSession();
  let response: Response;
  try {
    response = await fetch(`${HELPER_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Haidou-Session": sessionToken,
        ...init.headers,
      },
    });
  } catch {
    sessionToken = "";
    throw new LocalClientError(helperOfflineMessage(), "HELPER_OFFLINE");
  }
  if (response.status === 401 && retry) {
    sessionToken = "";
    await createSession();
    return helperRequest<T>(path, init, false);
  }
  return parseResponse<T>(response);
}

export async function detectCurrentPlayer(): Promise<LocalClientPlayer> {
  const body = await helperRequest<{ connected: true; player: LocalClientPlayer }>("/v1/client");
  return body.player;
}

export async function probeLocalConnection(): Promise<LocalConnectionProbe> {
  try {
    const health = await fetch(`${HELPER_URL}/v1/health`, { cache: "no-store" });
    if (!health.ok) throw new Error("helper health check failed");
  } catch {
    sessionToken = "";
    return {
      status: "helper-offline",
      message: helperOfflineMessage(),
      code: "HELPER_OFFLINE",
      player: null,
    };
  }

  try {
    const player = await detectCurrentPlayer();
    return {
      status: "connected",
      message: `已连接 ${player.gameName}#${player.tag} · ${player.region}`,
      player,
    };
  } catch (error) {
    const localError = error instanceof LocalClientError
      ? error
      : new LocalClientError("无法读取当前玩家登录信息");
    return {
      status: "client-offline",
      message: localError.message,
      code: localError.code,
      player: null,
    };
  }
}

export async function syncLocalHistory(count: 20 | 40 | 100 | 200): Promise<LocalClientSyncResult> {
  return helperRequest<LocalClientSyncResult>("/v1/sync", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}
