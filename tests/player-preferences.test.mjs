import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { analyzePreferences, buildPreferenceStories, preferencePage } from "../lib/player-preferences.mjs";

const match = (id, changes = {}) => ({ id: String(id), champion: "奥恩", championId: "516", win: true,
  playedAt: "2026-09-10T01:00:00Z", augments: ["巨像勇气"], augmentIds: ["1001"], ...changes });

test("preference denominator excludes missing/partial augments and deduplicates games and slots", () => {
  const a = match(1, { augments: ["巨像勇气", "巨像勇气"], augmentIds: ["1001", "1001"] });
  const stats = analyzePreferences([a, a, match(2, { win: false }), match(3, { dataQuality: { augmentsPresent: false } }), match(4, { augments: [], augmentIds: [] }), match(5, { augments: ["巨像勇气", ""], augmentIds: [] })]);
  assert.equal(stats.totalGames, 5);
  assert.equal(stats.duplicateOrInvalidGames, 1);
  assert.equal(stats.augmentGames, 2);
  assert.equal(stats.coverage, 40);
  assert.equal(stats.augments[0].games, 2);
  assert.equal(stats.augments[0].pickRate, 100);
  assert.equal(stats.augments[0].winRate, 50);
});

test("pick rates count carrying games, not total slots, and the list is not capped", () => {
  const stats = analyzePreferences([match(1, { augments: Array.from({ length: 15 }, (_, i) => `海克斯 ${i + 1}`), augmentIds: Array.from({ length: 15 }, (_, i) => String(i + 1)) })]);
  assert.equal(stats.augments.length, 15);
  assert.ok(stats.augments.every((r) => r.pickRate === 100));
});

test("win ranking rejects a one-game 100% result, includes ten games, and breaks ties by count", () => {
  const ten = Array.from({ length: 10 }, (_, i) => match(i, { win: i < 6 }));
  const twenty = Array.from({ length: 20 }, (_, i) => match(i + 20, { win: i < 12, augments: ["急救用具"], augmentIds: ["1002"] }));
  const stats = analyzePreferences([...ten, ...twenty, match(100, { augments: ["一局全胜"], augmentIds: ["1003"] })]);
  assert.equal(stats.winRanking.length, 2);
  assert.equal(stats.winRanking[0].name, "急救用具");
  assert.equal(stats.winRanking[1].games, 10);
});

test("ID joins renamed entries and unique legacy labels without double counting", () => {
  const stats = analyzePreferences([match(1), match(2, { augmentIds: undefined }), match(3, { augments: ["改名后的巨像"], champion: "山隐之焰" })]);
  assert.equal(stats.augments.length, 1);
  assert.equal(stats.augments[0].games, 3);
  assert.equal(stats.heroes.length, 1);
});

test("ambiguous names with different IDs do not silently merge", () => {
  const stats = analyzePreferences([match(1), match(2, { augmentIds: ["2002"] }), match(3, { augmentIds: undefined })]);
  assert.equal(stats.augments.length, 3);
  assert.ok(stats.augments.every((r) => r.games === 1));
});

test("ID-only augments retain counts and prefer a later resolved name", () => {
  const stats = analyzePreferences([match(1, { augments: [] }), match(2)]);
  assert.equal(stats.augments[0].name, "巨像勇气");
  assert.equal(stats.augments[0].games, 2);
});

test("old placeholder IDs join new resolved records", () => {
  const stats = analyzePreferences([match(1, { champion: "英雄 516", championId: undefined, augments: ["海克斯1001"], augmentIds: undefined }), match(2)]);
  assert.equal(stats.augments.length, 1);
  assert.equal(stats.augments[0].games, 2);
  assert.equal(stats.augments[0].name, "巨像勇气");
  assert.equal(stats.heroes.length, 1);
  assert.equal(stats.heroes[0].name, "奥恩");
});

test("pagination has bounded DOM input and can reach every row, searching includes IDs", () => {
  const stats = analyzePreferences(Array.from({ length: 100 }, (_, i) => match(i, { augments: [`候选 ${i}`], augmentIds: [String(1000 + i)] })));
  const first = preferencePage(stats, "picks", "", 0);
  assert.equal(first.rows.length, 30);
  assert.equal(first.pages, 4);
  const last = preferencePage(stats, "picks", "", 999);
  assert.equal(last.rows.length, 10);
  const keys = Array.from({length: 4}, (_, i) => preferencePage(stats, "picks", "", i).rows).flat().map((r) => r.key);
  assert.equal(new Set(keys).size, 100);
  assert.equal(preferencePage(stats, "picks", "１００１", 0).rows[0].name, "候选 1");
  assert.equal(preferencePage(stats, "picks", "没有", 0).matched, 0);
});

test("favorite ties remain ties and sparse records do not imply a stable main", () => {
  const stats = analyzePreferences([match(1), match(2, { champion: "金克丝", championId: "222" })]);
  assert.equal(stats.favoriteHeroes.length, 2);
  const text = buildPreferenceStories(stats).map((r) => r.text).join("");
  assert.match(text, /并列最多/);
  assert.doesNotMatch(text, /胜率提升|见到就必选/);
  assert.match(buildPreferenceStories(analyzePreferences([match(1)]))[0].title, /先别急/);
});

test("empty/invalid records produce no fabricated favorites or percentages", () => {
  const stats = analyzePreferences([match(""), match(2, { win: undefined })]);
  assert.equal(stats.totalGames, 0);
  assert.equal(stats.coverage, null);
  assert.deepEqual(stats.favoriteHeroes, []);
  assert.deepEqual(buildPreferenceStories(stats), []);
});

test("stories state observed counts, not augment causation", () => {
  const stats = analyzePreferences(Array.from({ length: 12 }, (_, i) => match(i, { win: i < 8 })));
  const text = buildPreferenceStories(stats).map((r) => r.text).join("");
  assert.match(text, /12 局/);
  assert.match(text, /赢了 8 局/);
  assert.match(text, /66.7%/);
  assert.match(text, /功劳不能全记/);
  assert.equal(stats.heroes[0].pickRate, 100);
});

async function loadRestore() {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../lib/report-restore.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("backup restore rejects demo, arbitrary files and future models, keeps timestamp and legacy engine", async () => {
  const { restoreReport } = await loadRestore();
  const dataset = { schemaVersion: 1, source: "local-client", player: { gameName: "测试战报", region: "艾欧尼亚", tag: "TEST", updatedAt: "2026-09-10T01:00:00Z" }, matches: [{ ...match(1), patch: "16.18", role: "坦克", durationMinutes: 20, kills: 3, deaths: 4, assists: 20, metrics: {} }], scoringEngine: "legacy" };
  const restored = restoreReport(JSON.stringify(dataset));
  assert.equal(restored.player.updatedAt, dataset.player.updatedAt);
  assert.equal(restored.scoringEngine, "legacy");
  assert.equal(restored.source, "imported");
  assert.throws(() => restoreReport(JSON.stringify({ ...dataset, source: "demo" })), /演示样本/);
  assert.throws(() => restoreReport(JSON.stringify({ ...dataset, player: {} })), /缺少玩家/);
  assert.throws(() => restoreReport(JSON.stringify(dataset.matches)), /战报/);
  assert.throws(() => restoreReport(JSON.stringify({ ...dataset, scoringEngine: "performance-v2", scoringEngineVersion: "future" })), /不同的 V2/);
  assert.throws(() => restoreReport(JSON.stringify({ ...dataset, matches: Array(501).fill(dataset.matches[0]) })), /500/);
  assert.throws(() => restoreReport(" ".repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  assert.throws(() => restoreReport(JSON.stringify({ ...dataset, matches: [{ ...dataset.matches[0], augments: Array(17).fill("过多槽位") }] })), /最多 16 项/);
  const sparse = { ...dataset, matches: [{ ...dataset.matches[0], augments: ["巨像勇气", ""], augmentIds: [], dataQuality: { metricsPresent: [], augmentsPresent: false } }] };
  const roundtrip = restoreReport(JSON.stringify(sparse));
  assert.equal(roundtrip.matches[0].dataQuality.augmentsPresent, false);
  assert.deepEqual(roundtrip.matches[0].augments, ["巨像勇气", ""]);
  assert.equal(analyzePreferences(roundtrip.matches).augmentGames, 0);
  const emptyItems = restoreReport(JSON.stringify({ ...dataset, matches: [{ ...dataset.matches[0], items: [], dataQuality: { metricsPresent: [], itemsPresent: true } }] }));
  assert.equal(emptyItems.matches[0].dataQuality.itemsPresent, true);
});

test("preference panel server-render contains all rows and escapes names", async () => {
  const result = await build({ stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import Panel from "./app/PlayerPreferences.tsx"; export const render = matches => renderToStaticMarkup(React.createElement(Panel, {matches}));', resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx" }, bundle: true, write: false, platform: "node", format: "cjs", loader: { ".module.css": "empty" }, jsx: "automatic" });
  const compiledModule = { exports: {} };
  const { createRequire } = await import("node:module");
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiledModule, compiledModule.exports);
  const html = compiledModule.exports.render([match(1, { champion: "<script>alert(1)</script>", augments: ["<img onerror=alert(1)>", ...Array.from({length: 14}, (_, i) => `测试海克斯 ${i}`)], augmentIds: [] })]);
  assert.match(html, /最爱的英雄/);
  assert.match(html, /个人海克斯排行/);
  assert.match(html, /样本少，暂不进胜率榜/);
  assert.match(html, /测试海克斯 13/);
  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.match(html, /&lt;img/);
});
