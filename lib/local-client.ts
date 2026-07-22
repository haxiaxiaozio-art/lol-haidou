import type { LocalClientPlayer, LocalClientSyncResult, SyncDiagnostic } from "./types";

const HELPER_URL = "http://127.0.0.1:3212";
export const MIN_HELPER_VERSION = 17;
export const HELPER_DOWNLOAD_URL = "https://github.com/haxiaxiaozio-art/lol-haidou/releases/latest/download/HaiDouHelperSetup.exe";
export const HELPER_LAUNCH_URL = "haidou-helper://start";
let sessionToken = "";

function helperOfflineMessage() {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "未找到本地数据助手。安装并启动助手后，网页会自动重新检测";
  }
  return "未找到本地数据助手，请先安装并启动助手";
}

export class LocalClientError extends Error {
  code: string;
  diagnostic?: SyncDiagnostic;

  constructor(message: string, code = "LOCAL_HELPER_ERROR", diagnostic?: SyncDiagnostic) {
    super(message);
    this.name = "LocalClientError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function browserDiagnostic(
  category: SyncDiagnostic["category"],
  code: string,
  message: string,
  suggestion: string,
): SyncDiagnostic {
  const titles: Record<SyncDiagnostic["category"], string> = {
    "client-login": "客户端未登录",
    "region-unavailable": "当前大区不可用",
    "interface-timeout": "接口超时或暂时不可用",
    "permission-denied": "连接权限不足",
    "field-missing": "战绩字段缺失",
  };
  return { category, code, source: "helper", severity: "error", title: titles[category], message, suggestion, retryable: category !== "field-missing" };
}

export type LocalConnectionProbe = {
  status: "checking" | "helper-offline" | "helper-outdated" | "client-offline" | "connected";
  message: string;
  code?: string;
  helperVersion?: number;
  diagnostic?: SyncDiagnostic;
  player: LocalClientPlayer | null;
};

async function parseResponse<T>(response: Response): Promise<T> {
  let body: { message?: string; error?: string; diagnostic?: SyncDiagnostic } & Partial<T> = {};
  try {
    body = await response.json();
  } catch {
    throw new LocalClientError("本地数据助手返回了无法识别的内容");
  }
  if (!response.ok) {
    throw new LocalClientError(body.message ?? "本地数据助手连接失败", body.error, body.diagnostic);
  }
  return body as T;
}

async function createSession() {
  let response: Response;
  try {
    response = await fetch(`${HELPER_URL}/v1/session`, { method: "POST", cache: "no-store" });
  } catch {
    const message = helperOfflineMessage();
    throw new LocalClientError(message, "HELPER_OFFLINE", browserDiagnostic("permission-denied", "HELPER_OFFLINE", message, "安装并启动最新版数据助手，然后允许浏览器访问本机网络。"));
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
    const message = helperOfflineMessage();
    throw new LocalClientError(message, "HELPER_OFFLINE", browserDiagnostic("permission-denied", "HELPER_OFFLINE", message, "安装并启动最新版数据助手，然后允许浏览器访问本机网络。"));
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
  let helperVersion = 0;
  try {
    const health = await fetch(`${HELPER_URL}/v1/health`, { cache: "no-store" });
    if (!health.ok) throw new Error("helper health check failed");
    const body = await health.json() as { service?: string; version?: number };
    if (body.service !== "haidou-local-helper") throw new Error("unexpected helper service");
    helperVersion = Number(body.version ?? 0);
  } catch {
    sessionToken = "";
    const message = helperOfflineMessage();
    return {
      status: "helper-offline",
      message,
      code: "HELPER_OFFLINE",
      diagnostic: browserDiagnostic("permission-denied", "HELPER_OFFLINE", message, "安装并启动最新版数据助手，然后允许浏览器访问本机网络。"),
      player: null,
    };
  }

  if (helperVersion < MIN_HELPER_VERSION) {
    sessionToken = "";
    const message = `数据助手版本过旧（当前 V${helperVersion || "未知"}），请安装最新版`;
    return {
      status: "helper-outdated",
      message,
      code: "HELPER_OUTDATED",
      helperVersion,
      diagnostic: browserDiagnostic("field-missing", "HELPER_OUTDATED", message, "安装最新版数据助手，以匹配当前网页所需的诊断和战绩字段。"),
      player: null,
    };
  }

  try {
    const player = await detectCurrentPlayer();
    return {
      status: "connected",
      message: `已连接 ${player.gameName}#${player.tag} · ${player.region}`,
      helperVersion,
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
      helperVersion,
      diagnostic: localError.diagnostic ?? browserDiagnostic("client-login", localError.code, localError.message, "启动国服 LOL 客户端并完成登录，然后重新检测。"),
      player: null,
    };
  }
}

export async function syncLocalHistory(count: 20 | 40 | 100 | 200, contributeCalibration = false): Promise<LocalClientSyncResult> {
  return helperRequest<LocalClientSyncResult>("/v1/sync", {
    method: "POST",
    body: JSON.stringify({ count, contributeCalibration }),
  });
}

export async function searchLocalHistory(
  gameName: string,
  tagLine: string,
  count: 20 | 40 | 100 | 200,
): Promise<LocalClientSyncResult> {
  return helperRequest<LocalClientSyncResult>("/v1/search", {
    method: "POST",
    body: JSON.stringify({ gameName, tagLine, count }),
  });
}
