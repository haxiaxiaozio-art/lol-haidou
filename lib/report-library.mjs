export const LIBRARY_KEY = "haidou-report-library-v1";
export function reportKey(player) {
  return JSON.stringify([player.region.trim(), player.gameName.trim(), player.tag.trim()].map((s) => s.normalize("NFKC").toLocaleLowerCase()));
}
export function readLibrary(storage) {
  const raw = storage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("战报库格式损坏，请先导出当前报告");
  return parsed.filter((r) => r?.key && r.dataset?.player && Array.isArray(r.dataset.matches)).slice(0, 10);
}
export function saveReport(storage, dataset) {
  if (!dataset.matches.length || dataset.matches.length > 500) throw new Error("可保存 1 至 500 场的战报");
  const reports = readLibrary(storage);
  const key = reportKey(dataset.player);
  if (reports.length >= 10 && !reports.some((r) => r.key === key)) throw new Error("最多保存 10 位玩家，请先移出一份旧战报");
  const report = { key, savedAt: new Date().toISOString(), dataset };
  const next = [report, ...reports.filter((r) => r.key !== key)];
  const text = JSON.stringify(next);
  if (text.length > 2_000_000) throw new Error("战报库空间不足，请导出文件保存");
  storage.setItem(LIBRARY_KEY, text);
  return next;
}
export function removeReport(storage, key) {
  const next = readLibrary(storage).filter((r) => r.key !== key);
  storage.setItem(LIBRARY_KEY, JSON.stringify(next));
  return next;
}
export function searchReports(reports, query) {
  const q = query.trim().normalize("NFKC").toLocaleLowerCase();
  return reports.filter(({dataset}) => `${dataset.player.region} ${dataset.player.gameName}#${dataset.player.tag}`.normalize("NFKC").toLocaleLowerCase().includes(q));
}
