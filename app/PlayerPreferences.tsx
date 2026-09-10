"use client";
import { useMemo, useState } from "react";
import type { MatchRecord } from "../lib/types";
import { analyzePreferences, buildPreferenceStories, preferencePage, AUGMENT_WIN_MIN_GAMES } from "../lib/player-preferences.mjs";
import styles from "./preferences.module.css";

const date = (value: string | null) => value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "时间未记录";
export default function PlayerPreferences({ matches }: { matches: MatchRecord[] }) {
  const stats = useMemo(() => analyzePreferences(matches), [matches]);
  const [ranking, setRanking] = useState<"picks" | "wins">("picks");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const stories = buildPreferenceStories(stats);
  const listing = preferencePage(stats, ranking, query, page);
  const favorites = [
    { label: "最爱的英雄", rows: stats.favoriteHeroes, total: stats.totalGames, qualifier: "出场" },
    { label: "最爱的海克斯", rows: stats.favoriteAugments, total: stats.augmentGames, qualifier: "携带" },
  ];
  return <section className={styles.section} aria-labelledby="preferences-title">
    <header className={styles.heading}><div><span>你的海斗习惯</span><h2 id="preferences-title">谁是你的老搭档？</h2></div><p>{date(stats.periodStart)} 至 {date(stats.periodEnd)}<br />本次 {stats.totalGames} 局，不代表整个赛季</p></header>
    <div className={styles.favorites}>{favorites.map((favorite) => <div key={favorite.label}>
      <span>{favorite.label}{favorite.rows.length > 1 ? " · 并列" : ""}</span>
      <strong>{favorite.rows.length ? favorite.rows.slice(0, 3).map((r) => r.name).join(" / ") : "记录不足"}</strong>
      {favorite.rows.length > 3 && <small>另有 {favorite.rows.length - 3} 项并列</small>}
      {favorite.rows[0] ? <p>{favorite.rows.length > 1 ? "各" : ""}{favorite.qualifier} {favorite.rows[0].games} / {favorite.total} 局 · {favorite.rows[0].pickRate}%{favorite.rows.length === 1 ? ` · 胜率 ${favorite.rows[0].winRate}%` : ""}</p> : <p>没有可用记录，不猜测偏好。</p>}
    </div>)}</div>
    <div className={styles.stories}>{stories.map((story) => <article key={story.title}><h3>{story.title}</h3><p>{story.text}</p></article>)}</div>
    <div className={styles.rankingHeader}><h3>个人海克斯排行</h3><div className={styles.switcher} aria-label="海克斯排行方式">
      <button type="button" aria-pressed={ranking === "picks"} onClick={() => { setRanking("picks"); setPage(0); }}>选用率</button>
      <button type="button" aria-pressed={ranking === "wins"} onClick={() => { setRanking("wins"); setPage(0); }}>胜率 · 至少 {AUGMENT_WIN_MIN_GAMES} 局</button>
    </div></div>
    <p className={styles.note}>选用率按对局携带计算，不是候选出现后的选择概率。海克斯记录覆盖 {stats.augmentGames} / {stats.totalGames} 局，同一局重复记录只算一次。</p>
    <label className={styles.search}>筛选海克斯<input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="输入海克斯名称或编号" /></label>
    <div className={styles.tableWrap}>
      <table><caption>{ranking === "picks" ? "按携带场次排序，低样本仍可查看" : `仅展示携带至少 ${AUGMENT_WIN_MIN_GAMES} 场的海克斯，胜率相同时场次多的在前`}</caption>
        <thead><tr><th scope="col">海克斯</th><th scope="col">携带</th><th scope="col">选用率</th><th scope="col">胜 / 负</th><th scope="col">胜率</th></tr></thead>
        <tbody>{listing.rows.map((r) => <tr key={r.key}><th scope="row">{r.name}{r.key.startsWith("id:") && <small>编号 {r.key.slice(3)}</small>}{r.games < AUGMENT_WIN_MIN_GAMES && <small>样本少，暂不进胜率榜</small>}</th><td>{r.games} 局</td><td>{r.pickRate}%</td><td>{r.wins} / {r.games - r.wins}</td><td>{r.winRate}%</td></tr>)}</tbody>
      </table>
    </div>
    {!listing.matched && <p className={styles.empty} role="status">{query ? "没有匹配的海克斯，请换个关键词。" : ranking === "wins" ? `还没有携带满 ${AUGMENT_WIN_MIN_GAMES} 局的海克斯，可以先看选用率。` : "这些对局没有可用海克斯记录，暂时无法统计。"}</p>}
    {listing.pages > 1 && <nav className={styles.switcher} aria-label="海克斯排行分页"><button type="button" disabled={listing.current === 0} onClick={() => setPage(listing.current - 1)}>上一页</button><span>第 {listing.current + 1} / {listing.pages} 页</span><button type="button" disabled={listing.current === listing.pages - 1} onClick={() => setPage(listing.current + 1)}>下一页</button></nav>}
    <p className={styles.note}>匹配 {listing.matched} / {listing.total} 项，每页最多 30 项，可翻页查看全部。每局可以携带多项，选用率合计可以超过 100%。携带胜率也受英雄、版本和搭配影响，不代表单枚海克斯带来的胜率提升。</p>
    {stats.duplicateOrInvalidGames > 0 && <p className={styles.note}>已从偏好统计中排除 {stats.duplicateOrInvalidGames} 条重复或无效对局。</p>}
  </section>;
}
