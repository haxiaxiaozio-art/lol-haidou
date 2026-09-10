"use client";
import { useEffect, useState } from "react";
import { findAsset, loadGameAssets } from "../lib/game-assets.mjs";
import type { MatchRecord } from "../lib/types";
import styles from "./upgrade.module.css";
type Catalog = Awaited<ReturnType<typeof loadGameAssets>>;
function AssetIcon({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    // Static CDN assets, no Next image proxy needed on GitHub Pages.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={styles.assetPlaceholder} aria-label={`${name} 图标暂缺`}>{name.slice(0, 1)}</span>;
}
export default function MatchAssets({ match }: { match: MatchRecord }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [latest, setLatest] = useState(false);
  const [status, setStatus] = useState("正在读取版本资源");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadGameAssets(match.patch, latest).then((c) => { if (active) { setCatalog(c); setStatus(c.errors.length ? `${c.errors.join("、")}暂不可用，保留原始名称` : ""); } }).catch(() => { if (active) setStatus("资源库暂时无法连接，装备和海克斯名称仍可查看。"); });
    return () => { active = false; };
  }, [match.patch, latest, retry]);
  return <section className={styles.matchAssets} aria-label="版本装备与海克斯">
    <div className={styles.assetsHeading}><strong>本局配置</strong><label>资源版本<select value={latest ? "latest" : "match"} onChange={(e) => { setCatalog(null); setStatus("正在读取版本资源"); setLatest(e.target.value === "latest"); }}><option value="match">对局版本 {match.patch}</option><option value="latest">最新公开版本</option></select></label></div>
    <small>{catalog ? `资源 ${catalog.version}${catalog.fallback ? " · 未找到对局版本，已回退最新" : ""} · ${latest ? "仅查看当前装备资料，不改变历史出装与评分" : "按对局补丁匹配"}` : status}</small>
    {catalog && status && <small role="status">{status}</small>}
    {(status.includes("无法") || status.includes("不可用")) && <button type="button" onClick={() => { setStatus("正在读取版本资源"); setRetry((n) => n + 1); }}>重试资源库</button>}
    <div className={styles.assetGroup}><span>装备</span><div>{(match.items ?? []).map((name, i) => {
      const asset = catalog ? findAsset(catalog.items, match.itemIds?.[i], name) : null;
      return <details className={styles.assetDetail} key={`${name}-${i}`}><summary><AssetIcon key={asset?.icon ?? name} src={asset?.icon} name={name} /><span>{asset?.name ?? name}</span></summary><p>{asset ? `${asset.description}${asset.gold ? ` · 标价 ${asset.gold} 金币` : ""}` : `暂无该装备资料${match.itemIds?.[i] ? `，ID ${match.itemIds[i]}` : "，原始战报未提供可解析 ID"}`}</p></details>;
    })}</div></div>
    <div className={styles.assetGroup}><span>海克斯</span><div>{match.augments.map((name, i) => {
      const asset = catalog ? findAsset(catalog.augments, match.augmentIds?.[i], name) : null;
      return <div className={styles.augmentAsset} key={`${name}-${i}`}><AssetIcon key={asset?.icon ?? name} src={asset?.icon} name={name} /><span>{asset?.name ?? name}<small>{match.augmentIds?.[i] ? `ID ${match.augmentIds[i]}` : asset ? "按名称匹配" : "图标待匹配"}</small></span></div>;
    })}</div></div>
    <small>装备：Riot Data Dragon · 海克斯：CommunityDragon（社区资源）。公开资源可能晚于国服更新；不是实时游戏接口。</small>
  </section>;
}
