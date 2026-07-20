import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { buildPlayerDataset, extractGames, normalizeHistory } from "./normalize.mjs";

const execFileAsync = promisify(execFile);
const POWER_SHELL = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

export class ClientUnavailableError extends Error {
  constructor(message = "未检测到已登录的 LOL 客户端") {
    super(message);
    this.name = "ClientUnavailableError";
    this.code = "CLIENT_UNAVAILABLE";
  }
}

export function parseCommandLine(commandLine) {
  if (typeof commandLine !== "string" || commandLine.trim() === "") return null;
  const read = (name) => {
    const match = commandLine.match(new RegExp(`--${name}(?:=|\\s+)(?:\"([^\"]+)\"|'([^']+)'|([^\\s]+))`, "i"));
    return match?.[1] ?? match?.[2] ?? match?.[3];
  };
  const port = Number(read("app-port"));
  const password = read("remoting-auth-token");
  if (!Number.isInteger(port) || !password) return null;
  const platformId = read("rso_platform_id") ?? read("region");
  return {
    port,
    password,
    protocol: read("app-protocol") ?? "https",
    ...(platformId ? { platformId } : {}),
  };
}

function parseLockfile(content = "") {
  const [name, pid, portValue, password, protocol] = content.trim().split(":");
  const port = Number(portValue);
  if (!name || !pid || !Number.isInteger(port) || !password) return null;
  return { port, password, protocol: protocol || "https" };
}

async function processInfo() {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$process = Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -First 1 CommandLine,ExecutablePath,ProcessId",
    "if ($null -eq $process) { exit 3 }",
    "$process | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync(POWER_SHELL, ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

async function lockfileCredentials(executablePath) {
  const candidates = [
    executablePath ? path.join(path.dirname(executablePath), "lockfile") : null,
    "C:\\Riot Games\\League of Legends\\lockfile",
    "D:\\Riot Games\\League of Legends\\lockfile",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = parseLockfile(await readFile(candidate, "utf8"));
      if (parsed) return parsed;
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

async function leagueClientLogCredentials(executablePath) {
  const directories = new Set([
    executablePath ? path.dirname(executablePath) : null,
    ...["C", "D", "E", "F"].map((drive) => `${drive}:\\WeGameApps\\英雄联盟\\LeagueClient`),
    "C:\\Riot Games\\League of Legends",
    "D:\\Riot Games\\League of Legends",
  ].filter(Boolean));

  for (const directory of directories) {
    try {
      const logNames = (await readdir(directory))
        .filter((name) => /_LeagueClientUx\.log$/i.test(name))
        .sort((left, right) => right.localeCompare(left))
        .slice(0, 3);
      for (const logName of logNames) {
        const credentials = parseCommandLine(await readFile(path.join(directory, logName), "utf8"));
        if (credentials) return credentials;
      }
    } catch {
      // Try the next known League client directory.
    }
  }
  return null;
}

export async function detectLeagueClient() {
  const process = await processInfo();
  if (!process) throw new ClientUnavailableError("未检测到 League 客户端，请先启动 LOL 并完成登录");
  const credentials = parseCommandLine(process.CommandLine)
    ?? await lockfileCredentials(process.ExecutablePath)
    ?? await leagueClientLogCredentials(process.ExecutablePath);
  if (!credentials) throw new ClientUnavailableError("LOL 客户端已启动，但尚未准备好本地数据接口");
  return credentials;
}

function lcuRequest(credentials, requestPath) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "127.0.0.1",
      port: credentials.port,
      path: requestPath,
      method: "GET",
      auth: `riot:${credentials.password}`,
      rejectUnauthorized: false,
      timeout: 10_000,
      headers: { Accept: "application/json" },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          request.destroy(new Error("LOL 客户端返回的数据过大"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`LOL 客户端接口返回 ${response.statusCode}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch {
          reject(new Error("无法解析 LOL 客户端返回的数据"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("连接 LOL 客户端超时")));
    request.on("error", reject);
    request.end();
  });
}

async function optionalRequest(credentials, requestPath, fallback) {
  try {
    return await lcuRequest(credentials, requestPath);
  } catch {
    return fallback;
  }
}

function championMap(payload) {
  const map = new Map();
  for (const champion of Array.isArray(payload) ? payload : []) {
    map.set(String(champion.id), champion);
  }
  return map;
}

export function augmentMap(payload) {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.augments)
      ? payload.augments
      : Object.values(payload ?? {});
  const map = new Map();
  for (const augment of entries) {
    const id = augment?.id ?? augment?.augmentId;
    const name = augment?.nameTRA
      ?? augment?.simpleNameTRA
      ?? augment?.name
      ?? augment?.localizedName
      ?? augment?.title;
    if (id !== undefined && name) map.set(String(id), String(name));
  }
  return map;
}

export function parseHistoryGameIds(logText, platformId) {
  if (typeof logText !== "string" || logText === "") return [];
  const expectedPlatform = String(platformId ?? "").toUpperCase();
  const ids = new Set();
  for (const listMatch of logText.matchAll(/Match ids retrieved:\s*\[([^\]]*)\]/gi)) {
    for (const idMatch of listMatch[1].matchAll(/([A-Z0-9]+)_(\d+)/gi)) {
      if (!expectedPlatform || idMatch[1].toUpperCase() === expectedPlatform) ids.add(idMatch[2]);
    }
  }
  return [...ids];
}

export function gameBelongsToPlayer(game, player) {
  const keys = new Set([
    player?.puuid,
    player?.accountId,
    player?.summonerId,
  ].filter(Boolean).map(String));
  if (keys.size === 0) return false;
  const identities = game?.participantIdentities ?? game?.identities ?? [];
  return identities.some((identity) => {
    const candidate = identity?.player ?? identity;
    return [candidate?.puuid, candidate?.accountId, candidate?.currentAccountId, candidate?.summonerId]
      .some((value) => value !== undefined && keys.has(String(value)));
  });
}

function historyLogDirectories(executablePath) {
  return new Set([
    executablePath ? path.resolve(path.dirname(executablePath), "..", "Game", "Logs", "LeagueClient Logs") : null,
    ...["C", "D", "E", "F"].map((drive) => `${drive}:\\WeGameApps\\英雄联盟\\Game\\Logs\\LeagueClient Logs`),
    "C:\\Riot Games\\League of Legends\\Logs\\LeagueClient Logs",
    "D:\\Riot Games\\League of Legends\\Logs\\LeagueClient Logs",
    "C:\\Riot Games\\League of Legends\\Game\\Logs\\LeagueClient Logs",
    "D:\\Riot Games\\League of Legends\\Game\\Logs\\LeagueClient Logs",
  ].filter(Boolean));
}

async function historicalGameIds(executablePath, platformId) {
  const ids = new Set();
  for (const directory of historyLogDirectories(executablePath)) {
    try {
      const logNames = (await readdir(directory))
        .filter((name) => /_LeagueClient\.log$/i.test(name))
        .sort((left, right) => right.localeCompare(left));
      for (const logName of logNames) {
        const content = await readFile(path.join(directory, logName), "utf8");
        parseHistoryGameIds(content, platformId).forEach((id) => ids.add(id));
      }
    } catch {
      // Try the next known League client log directory.
    }
  }
  return [...ids].sort((left, right) => Number(right) - Number(left));
}

export async function getCurrentPlayer() {
  const credentials = await detectLeagueClient();
  const [player, apiRegion] = await Promise.all([
    lcuRequest(credentials, "/lol-summoner/v1/current-summoner"),
    optionalRequest(credentials, "/riotclient/region-locale", {}),
  ]);
  if (!player?.puuid && !player?.accountId && !player?.summonerId) {
    throw new ClientUnavailableError("LOL 客户端已启动，但当前玩家尚未登录");
  }
  const region = credentials.platformId
    ? { ...apiRegion, webRegion: credentials.platformId }
    : apiRegion;
  return {
    credentials,
    player,
    region,
    publicPlayer: buildPlayerDataset({ player, region, matches: [] }).player,
  };
}

async function recentHistoryGames(credentials, player, count) {
  const identifier = player.puuid ?? player.accountId ?? player.summonerId;
  if (!identifier) throw new ClientUnavailableError("无法识别当前玩家");
  const games = [];
  const seen = new Set();
  for (let begin = 0; begin < count; begin += 100) {
    const end = Math.min(count, begin + 100) - 1;
    const requestPath = `/lol-match-history/v1/products/lol/${encodeURIComponent(identifier)}/matches?begIndex=${begin}&endIndex=${end}`;
    const payload = await lcuRequest(credentials, requestPath);
    const pageGames = extractGames(payload);
    let added = 0;
    for (const game of pageGames) {
      const id = String(game?.gameId ?? game?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      games.push(game);
      added += 1;
    }
    if (added === 0 || pageGames.length < end - begin + 1) break;
  }
  return games;
}

const gameTimestamp = (game) => {
  const numeric = Number(game?.gameCreation ?? game?.gameStartTimestamp ?? game?.gameStartTime);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(game?.gameCreationDate ?? "");
  return Number.isFinite(parsed) ? parsed : Number(game?.gameId ?? 0);
};

async function historyGames(credentials, player, count) {
  const games = await recentHistoryGames(credentials, player, count);
  if (games.length >= count) return games.slice(0, count);

  const seen = new Set(games.map((game) => String(game?.gameId ?? game?.id ?? "")));
  const candidateIds = (await historicalGameIds(null, credentials.platformId))
    .filter((id) => !seen.has(id))
    .slice(0, 600);
  const concurrency = 6;
  for (let index = 0; index < candidateIds.length && games.length < count; index += concurrency) {
    const batch = candidateIds.slice(index, index + concurrency);
    const details = await Promise.all(batch.map((id) =>
      optionalRequest(credentials, `/lol-match-history/v1/games/${encodeURIComponent(id)}`, null)));
    for (const game of details) {
      if (!game?.gameId || !gameBelongsToPlayer(game, player)) continue;
      const id = String(game.gameId);
      if (seen.has(id)) continue;
      seen.add(id);
      games.push(game);
    }
  }

  return games
    .sort((left, right) => gameTimestamp(right) - gameTimestamp(left))
    .slice(0, count);
}

export async function syncHistory(requestedCount) {
  const allowedCounts = new Set([20, 40, 100, 200]);
  const count = Number(requestedCount);
  if (!allowedCounts.has(count)) throw new Error("场次只能选择 20、40、100 或 200");

  const { credentials, player, region } = await getCurrentPlayer();
  const [scanned, championPayload, augmentPayload] = await Promise.all([
    historyGames(credentials, player, count),
    optionalRequest(credentials, "/lol-game-data/assets/v1/champion-summary.json", []),
    optionalRequest(credentials, "/lol-game-data/assets/v1/cherry-augments.json", []),
  ]);
  const matches = normalizeHistory([scanned], {
    player,
    champions: championMap(championPayload),
    augmentNames: augmentMap(augmentPayload),
  });
  return {
    dataset: buildPlayerDataset({ player, region, matches }),
    scannedCount: scanned.length,
    haidouCount: matches.length,
  };
}
