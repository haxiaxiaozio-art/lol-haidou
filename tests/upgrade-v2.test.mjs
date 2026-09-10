import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { evaluatePerformance, performanceTable, patchKey, teamShare, describePlaystyle } from "../lib/performance-v2.mjs";
import { buildMatchCommentary } from "../lib/match-commentary.mjs";
import { reliableRoleScore } from "../lib/player-summary.mjs";
import { chooseAssetVersion, communityIcon, findAsset } from "../lib/game-assets.mjs";
import { saveReport, readLibrary, searchReports, reportKey } from "../lib/report-library.mjs";
import { normalizeMatch } from "../helper/normalize.mjs";
const sample = (changes = {}) => ({ id: "1", champion: "莫甘娜", championId: "25", patch: "16.18", playedAt: "2026-09-10T12:00:00Z", role: "辅助", durationMinutes: 20, kills: 5, deaths: 6, assists: 20, win: true,
  metrics: { damage: 32000, controlSeconds: 56, healing: 0, shielding: 5200, damageTaken: 48000, mitigated: 40000, selfHealing: 2000, gold: 14000 }, augments: ["海克斯 1205"], items: ["装备 3089"], ...changes });

test("Morgana combines protection, no impossible heal-only dimension; 70 baseline is explicit", () => {
  const s = evaluatePerformance(sample());
  assert.equal(s.evaluation.baseline, 70);
  assert.equal(s.evaluation.championSpecific, true);
  assert.equal(s.dimensions.find((d) => d.label === "治疗保护").score, 70);
  assert.ok(!s.dimensions.some((d) => d.label === "队友治疗"));
});
test("missing metric is excluded, genuine zero remains a measurement", () => {
  const zero = sample({ metrics: { ...sample().metrics, damage: 0 }, role: "射手", champion: "未知", championId: undefined });
  const missing = { ...zero, dataQuality: { metricsPresent: ["gold"] } };
  const d = evaluatePerformance(missing).dimensions.find((d) => d.label === "持续输出");
  assert.equal(d.missing, true);
  assert.equal(evaluatePerformance(zero).dimensions.find((d) => d.label === "持续输出").missing, false);
  assert.ok(evaluatePerformance(missing).score > evaluatePerformance(zero).score);
});
test("same secondary role does not dilute; distinct secondary only adds bounded bonus", () => {
  const m = sample();
  const main = evaluatePerformance(m);
  assert.equal(main.score, evaluatePerformance({ ...m, secondaryRole: "辅助" }).score);
  const dual = evaluatePerformance({ ...m, secondaryRole: "法师" });
  assert.ok(dual.score >= main.score);
  assert.ok(dual.roleComponents[1].contribution <= 6);
});
test("self excluded, duplicate and wrong patch peers rejected", () => {
  const m = sample();
  const peers = Array.from({ length: 8 }, (_, i) => sample({ id: String(i + 2) }));
  const scored = evaluatePerformance(m, [m, ...peers, ...peers, sample({ id: "99", patch: "16.17" })]);
  assert.equal(scored.evaluation.peers, 8);
  assert.equal(evaluatePerformance(m, peers.slice(0, 4)).evaluation.basis, "英雄规则估算");
  assert.equal(patchKey("26.18"), "16.18");
});
test("more KDA alone cannot overwhelm output and protection", () => {
  const a = evaluatePerformance(sample());
  const b = evaluatePerformance(sample({ kills: 90, assists: 100 }));
  assert.ok(b.score - a.score < 10);
});
test("feeding does not earn tanking credit, recall deaths carry greater penalty", () => {
  const m = sample({ champion: "奥恩", championId: "516", role: "坦克" });
  assert.ok(evaluatePerformance({ ...m, deaths: 16 }).score < evaluatePerformance(m).score);
  const recall = evaluatePerformance({ ...m, recall: { pickedAtMinute: 5, deathsBefore: 1, deathsAfter: 5 } });
  assert.ok(recall.score < evaluatePerformance(m).score);
  assert.equal(recall.recallApplied, true);
  assert.equal(evaluatePerformance({ ...m, recall: { pickedAtMinute: 50, deathsBefore: 1, deathsAfter: 5 } }).recallApplied, false);
});
test("shares require complete five-player denominators and valid fields", () => {
  const m = sample({ teamTotals: { participants: 5, damage: 160000, gold: 70000, controlSeconds: 140 } });
  assert.equal(teamShare(m, "damage"), .2);
  assert.equal(teamShare({ ...m, teamTotals: { ...m.teamTotals, participants: 4 } }, "damage"), null);
  assert.equal(teamShare({ ...m, teamTotals: { participants: 5, damage: 0 } }, "damage"), null);
  assert.equal(performanceTable([sample()]).find((r) => r.key === "damageShare").games, 0);
});
test("normalizer retains IDs and team totals, does not mix CC fields", () => {
  const participants = Array.from({length: 5}, (_, i) => ({ puuid: `p${i}`, teamId: 100, championId: 25, stats: { playerAugment1: 1205, item0: 3089, totalDamageDealtToChampions: 1000, goldEarned: 1000, timeCCingOthers: 10, totalTimeCCDealt: 100 } }));
  const game = { gameId: 1, gameDuration: 1200, gameMode: "ARAM", participants };
  const result = normalizeMatch(game, { player: { puuid: "p0" } });
  assert.deepEqual(result.itemIds, ["3089"]);
  assert.deepEqual(result.augmentIds, ["1205"]);
  assert.equal(result.teamTotals.damage, 5000);
  assert.equal(result.teamTotals.controlSeconds, 50);
  delete participants[1].stats.timeCCingOthers;
  assert.equal(normalizeMatch(game, { player: { puuid: "p0" } }).teamTotals.controlSeconds, undefined);
});
test("asset versions pin historical patch, do not confuse 26.x marketing version", () => {
  assert.deepEqual(chooseAssetVersion(["16.18.1", "16.14.1"], "26.14"), {version: "16.14.1", fallback: false});
  assert.equal(chooseAssetVersion(["16.18.1"], "26.14").fallback, true);
  assert.equal(chooseAssetVersion(["16.18.1", "16.14.1"], "16.14", true).version, "16.18.1");
});
test("asset resolution prefers exact IDs; ambiguous names and unsafe paths fail closed", () => {
  const entries = [{ id: "1", name: "装备" }, { id: "2", name: "装备" }];
  assert.equal(findAsset(entries, null, "装备"), null);
  assert.equal(findAsset(entries, "2", "装备").id, "2");
  assert.equal(findAsset(entries, "3", "装备"), null);
  assert.equal(findAsset([{...entries[0],aram:true}, entries[1]], null, "装备").id, "1");
  assert.equal(communityIcon("https://attacker.test/icon.png", "16.18"), null);
  assert.match(communityIcon("/lol-game-data/assets/ASSETS/Icon.png", "16.18"), /16\.18\/.*\/assets\/icon.png$/);
});
test("report library persists and isolates region+full Riot ID, never silently evicts", () => {
  const memory = new Map(); const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) };
  const data = { schemaVersion: 1, source: "imported", player: { gameName: "夜航船", tag: "1234", region: "艾欧尼亚" }, matches: [sample()] };
  saveReport(storage, data);
  saveReport(storage, {...data, player: {...data.player, region: "黑色玫瑰"}});
  assert.equal(readLibrary(storage).length, 2);
  assert.equal(searchReports(readLibrary(storage), "黑色玫瑰").length, 1);
  assert.notEqual(reportKey(data.player), reportKey({...data.player, tag: "4321"}));
  saveReport(storage, data);
  assert.equal(readLibrary(storage).length, 2);
  for (let i = 0; i < 8; i++) saveReport(storage, {...data, player: {...data.player, tag: String(i)}});
  assert.throws(() => saveReport(storage, {...data, player: {...data.player, tag: "overflow"}}), /最多保存/);
});
test("JSON replay preserves optional IDs, team totals, recall and missing flags", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/importers.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
  const { parseJson } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const m = sample({ itemIds: ["3089"], teamTotals: { participants: 5, damage: 100000 }, dataQuality: { metricsPresent: ["damage", "gold"] }, recall: { pickedAtMinute: 5, deathsBefore: 1, deathsAfter: 5 } });
  const result = parseJson(JSON.stringify({ scoringEngine: "performance-v2", matches: [m] }));
  assert.equal(result.scoringEngine, "performance-v2");
  assert.deepEqual(result.matches[0].itemIds, ["3089"]);
  assert.deepEqual(result.matches[0].dataQuality.metricsPresent, ["damage", "gold"]);
  assert.deepEqual(result.matches[0].recall, m.recall);
  assert.equal(result.matches[0].teamTotals.damage, 100000);
  assert.throws(() => parseJson(JSON.stringify({ matches: [{...m, playedAt: "broken"}] })), /日期无效/);
  assert.equal(parseJson(JSON.stringify({ matches: [m], scoringEngine: "legacy" })).scoringEngine, "legacy");
  assert.throws(() => parseJson(JSON.stringify({ matches: [m], scoringEngine: "performance-v2", scoringEngineVersion: "future" })), /不同的 V2/);
  assert.throws(() => parseJson(JSON.stringify({ matches: Array(501).fill(m) })), /最多导入 500/);
});
test("commentary never praises missing dimensions as strengths", () => {
  const item = evaluatePerformance(sample({ champion: "未知", championId: undefined, dataQuality: { metricsPresent: ["damage", "controlSeconds", "damageTaken", "gold"] } }));
  assert.ok(item.evaluation.coverage >= 60);
  const comment = buildMatchCommentary(item);
  assert.doesNotMatch(comment.verdict + comment.improvement, /治疗保护/);
});
test("efficiency descriptions require paired shares, not disjoint averages", () => {
  const output = Array.from({length: 5}, (_, i) => sample({ id: `d${i}`, teamTotals: { participants: 5, damage: 100000 } }));
  const gold = Array.from({length: 5}, (_, i) => sample({ id: `g${i}`, teamTotals: { participants: 5, gold: 140000 } }));
  assert.doesNotMatch(describePlaystyle([...output, ...gold]), /高效输出点/);
  assert.equal(reliableRoleScore(70, 5, 70), 70);
});
