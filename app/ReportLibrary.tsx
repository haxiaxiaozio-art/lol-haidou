"use client";
import { useEffect, useState } from "react";
import { readLibrary, saveReport, removeReport, searchReports } from "../lib/report-library.mjs";
import { parseJson } from "../lib/importers";
import type { PlayerDataset } from "../lib/types";
import styles from "./upgrade.module.css";
type Saved = { key: string; savedAt: string; dataset: PlayerDataset };

export default function ReportLibrary({ dataset, onOpen }: { dataset: PlayerDataset; onOpen: (d: PlayerDataset) => void }) {
  const [reports, setReports] = useState<Saved[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("战报仅保存在此浏览器，不上传服务器。清理浏览器数据会移除记录，重要战报请同时导出。");
  // Read browser-only persistence after hydration; SSR must keep its empty snapshot.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setReports(readLibrary(localStorage)); } catch { setMessage("无法读取本地战报库，浏览器可能禁用了存储。"); } }, []);
  const save = () => { try { setReports(saveReport(localStorage, dataset)); setMessage("已保存当前战报。下次关闭游戏、不开助手，也可以回来查看。相同玩家再次保存会替换旧战报。"); } catch (e) { setMessage(e instanceof Error ? e.message : "保存失败，存储空间可能不足"); } };
  const open = (report: Saved) => {
    try { const parsed = parseJson(JSON.stringify(report.dataset)); onOpen({ ...parsed, source: report.dataset.source, player: report.dataset.player }); }
    catch { setMessage("这份战报无法读取，其他记录不受影响。"); }
  };
  return <div className={styles.library}>
    <div className={styles.libraryHeading}><div><h2>战报留在这里，下次直接看。</h2><p>历史战报无需助手；获取新玩家、新对局仍需客户端同步或授权数据源。</p></div>
      <button onClick={save} type="button">保存当前战报</button></div>
    <label className={styles.librarySearch}>检索已保存玩家<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="玩家名、尾标或大区" /></label>
    <p className={styles.storageMessage} role="status">{message}</p>
    <div className={styles.savedReports}>
      {searchReports(reports, query).map((r: Saved) => <article key={r.key}>
        <div><strong>{r.dataset.player.gameName}#{r.dataset.player.tag}</strong><small>{r.dataset.player.region} · {r.dataset.matches.length} 局 · {r.dataset.source === "demo" ? "演示数据" : "历史快照"} · 保存于 {new Date(r.savedAt).toLocaleDateString("zh-CN")}</small></div>
        <button type="button" onClick={() => open(r)}>打开战报</button>
        <button type="button" aria-label={`移出 ${r.dataset.player.gameName} 的战报`} onClick={() => { try { setReports(removeReport(localStorage, r.key)); setMessage("已移出本地记录。已导出的 JSON 文件不受影响。"); } catch { setMessage("移出失败，请检查浏览器存储权限。"); } }}>移出</button>
      </article>)}
      {!searchReports(reports, query).length && <p>这里还没有{query ? "匹配的" : "保存的"}战报。先导入或同步，再点“保存当前战报”。</p>}
    </div>
    <small>国服常驻新战绩接口：尚未接入授权提供商。这里是本机战报库，不是云端战绩查询。</small>
  </div>;
}
