import { patchKey } from "./performance-v2.mjs";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const CDRAGON = "https://raw.communitydragon.org";
const cache = new Map();
const plain = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`资源库响应 ${response.status}`);
  return response.json();
}
function once(key, fn) {
  if (!cache.has(key)) {
    const promise = fn().catch((error) => { cache.delete(key); throw error; });
    cache.set(key, promise);
  }
  return cache.get(key);
}
export function chooseAssetVersion(versions, patch, latest = false) {
  const safe = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const version = latest ? safe[0] : safe.find((v) => patchKey(v) === patchKey(patch)) ?? safe[0];
  if (!version) throw new Error("资源库没有可用版本");
  return { version, fallback: !latest && patchKey(version) !== patchKey(patch) };
}
export function communityIcon(path, version) {
  if (!/^\d+\.\d+$/.test(version)) return null;
  const prefix = "/lol-game-data/assets/";
  if (typeof path !== "string" || !path.toLowerCase().startsWith(prefix) || /\.\.|[?#%]/.test(path)) return null;
  return `${CDRAGON}/${version}/plugins/rcp-be-lol-game-data/global/default/${path.slice(prefix.length).toLowerCase()}`;
}
export async function loadGameAssets(patch, latest = false) {
  const versions = await once("versions", () => json(`${DDRAGON}/api/versions.json`));
  const selection = chooseAssetVersion(versions, patch, latest);
  return once(selection.version, async () => {
    const version = selection.version;
    const short = patchKey(version);
    const [itemsResult, championsResult, augmentsResult] = await Promise.allSettled([
      json(`${DDRAGON}/cdn/${version}/data/zh_CN/item.json`),
      json(`${DDRAGON}/cdn/${version}/data/zh_CN/champion.json`),
      json(`${CDRAGON}/${short}/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json`),
    ]);
    const items = itemsResult.status === "fulfilled" ? Object.entries(itemsResult.value.data).map(([id, item]) => ({
      id, name: item.name, description: plain(item.description), gold: item.gold?.total, aram: item.maps?.["12"] === true,
      icon: `${DDRAGON}/cdn/${version}/img/item/${id}.png`,
    })) : [];
    const champions = championsResult.status === "fulfilled" ? Object.values(championsResult.value.data).map((c) => ({
      id: String(c.key), name: c.name, key: c.id, icon: `${DDRAGON}/cdn/${version}/img/champion/${c.id}.png`,
    })) : [];
    const augments = augmentsResult.status === "fulfilled" && Array.isArray(augmentsResult.value) ? augmentsResult.value.map((a) => ({
      id: String(a.id), name: a.nameTRA ?? a.name, description: plain(a.descTRA ?? a.description), aram: String(a.augmentNameId ?? "").startsWith("ARAM_"), icon: communityIcon(a.augmentSmallIconPath ?? a.iconPath, short),
    })) : [];
    const errors = [!items.length && "装备库", !champions.length && "英雄库", !augments.length && "海克斯库"].filter(Boolean);
    if (errors.length) cache.delete(version);
    return { version, items, champions, augments, fetchedAt: new Date().toISOString(), errors };
  }).then((catalog) => ({ ...catalog, fallback: selection.fallback }));
}
export function findAsset(entries, id, name) {
  // Names are only a backward-compatible fallback; ambiguous localized names stay unresolved.
  if (id && /^\d+$/.test(String(id))) return entries.find((e) => e.id === String(id)) ?? null;
  const embedded = String(name ?? "").match(/^(?:装备|海克斯|英雄)\s+(\d+)$/)?.[1];
  if (embedded) return entries.find((e) => e.id === embedded) ?? null;
  const matches = entries.filter((e) => e.name === name || e.key === name);
  const aramMatches = matches.filter((e) => e.aram);
  if (aramMatches.length === 1) return aramMatches[0];
  return matches.length === 1 ? matches[0] : null;
}
