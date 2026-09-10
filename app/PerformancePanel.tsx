"use client";
import { describePlaystyle, performanceTable } from "../lib/performance-v2.mjs";
import type { PlayerDataset } from "../lib/types";
import styles from "./upgrade.module.css";

export default function PerformancePanel({ dataset }: { dataset: PlayerDataset }) {
  const rows = performanceTable(dataset.matches);
  return <section className={styles.performance} aria-labelledby="performance-title">
    <div className={styles.performanceIntro}>
      <span className={styles.kicker}>BEYOND THE KDA</span>
      <h2 id="performance-title">你在队里，<br />怎么打这一局。</h2>
      <p>{describePlaystyle(dataset.matches)}</p>
      <small>只描述本次战报中的表现，不是性格标签或全服排名。每项按有效场次平均，不同项可能覆盖不同对局。</small>
    </div>
    <div className={styles.dimensionTable}>
      <div className={styles.tableHeader}><span>表现维度 / 统计口径</span><span>场均表现</span><span>覆盖</span></div>
      {rows.map((row) => <div className={styles.dimensionRow} key={row.key}>
        <div><strong>{row.label}</strong><small>{row.note}</small></div>
        <b data-missing={row.value === null}>{row.displayValue}</b>
        <span>{row.games} / {dataset.matches.length} 局</span>
      </div>)}
      <p>占比需要完整五人同队数据。旧助手与部分日志缺少这些字段时不估填；控制时长以来源字段为准。</p>
    </div>
  </section>;
}
