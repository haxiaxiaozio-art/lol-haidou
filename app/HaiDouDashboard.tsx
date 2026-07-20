"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { DEMO_DATASET } from "../lib/demo-data";
import { importDataset, CSV_HEADERS } from "../lib/importers";
import { detectCurrentPlayer, syncLocalHistory } from "../lib/local-client";
import { summarizePlayer } from "../lib/scoring";
import type { LocalClientPlayer, MatchRecord, PlayerDataset, ScoredMatch } from "../lib/types";
import styles from "./page.module.css";

type MatchFilter = "全部" | "胜利" | "失败";
type SourceMode = "demo" | "file" | "local";
type FlowStatus = "idle" | "resolving" | "connected" | "syncing" | "scoring" | "ready";

const REGIONS = ["艾欧尼亚", "黑色玫瑰", "峡谷之巅", "联盟一区", "联盟二区", "联盟三区", "联盟四区", "联盟五区"];
const FLOW_STATUS_COPY: Record<FlowStatus, string> = {
  idle: "选择一种数据来源开始",
  resolving: "正在确认玩家身份",
  connected: "LOL 客户端已经连接",
  syncing: "正在整理最近对局",
  scoring: "正在计算角色表现与高光场次",
  ready: "战报已经准备好",
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const resultLabel = (score: number) => {
  if (score >= 88) return "高光";
  if (score >= 74) return "出色";
  if (score >= 58) return "稳定";
  return "待复盘";
};

const csvEscape = (value: string | number | boolean) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const matchToCsvRow = (match: MatchRecord) => [
  match.id,
  match.playedAt,
  match.patch,
  match.champion,
  match.role,
  match.win,
  match.durationMinutes,
  match.kills,
  match.deaths,
  match.assists,
  match.metrics.damage,
  match.metrics.controlSeconds,
  match.metrics.healing,
  match.metrics.shielding,
  match.metrics.mitigated,
  match.metrics.damageTaken,
  match.metrics.selfHealing,
  match.metrics.gold,
  match.augments.join("|"),
  match.recall?.pickedAtMinute ?? "",
  match.recall?.deathsBefore ?? "",
  match.recall?.deathsAfter ?? "",
];

function downloadBlob(content: string, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MatchRow({ item }: { item: ScoredMatch }) {
  const match = item.match;
  return (
    <article className={styles.matchRow} data-result={match.win ? "win" : "loss"}>
      <div className={styles.matchIdentity}>
        <span className={styles.championMark} aria-hidden="true">{match.champion.slice(0, 1)}</span>
        <div>
          <strong>{match.champion}</strong>
          <span>{match.role} · {dateFormatter.format(new Date(match.playedAt))}</span>
        </div>
      </div>
      <div className={styles.kdaBlock}>
        <strong>{match.kills} / {match.deaths} / {match.assists}</strong>
        <span>{match.patch} · {match.durationMinutes.toFixed(1)} 分钟</span>
      </div>
      <div className={styles.augmentList} aria-label="本局海克斯">
        {match.augments.slice(0, 3).map((augment) => <span key={augment}>{augment}</span>)}
      </div>
      <div className={styles.matchScore}>
        <strong>{item.score}</strong>
        <span>{resultLabel(item.score)}</span>
      </div>
      <details className={styles.matchDetails}>
        <summary>评分明细</summary>
        <div className={styles.dimensionGrid}>
          {item.dimensions.map((dimension) => (
            <div key={dimension.label}>
              <span>{dimension.label}</span>
              <strong>{dimension.score}</strong>
              <small>{dimension.displayValue}</small>
            </div>
          ))}
        </div>
        <p>
          正向表现 {item.positiveScore}，生存表现 {item.survivalScore}
          {item.recallApplied ? "，已应用历史回城死亡加权" : "，按普通死亡规则计算"}。
        </p>
      </details>
    </article>
  );
}

export default function HaiDouDashboard() {
  const [dataset, setDataset] = useState<PlayerDataset>(DEMO_DATASET);
  const [filter, setFilter] = useState<MatchFilter>("全部");
  const [sourceMode, setSourceMode] = useState<SourceMode>("demo");
  const [region, setRegion] = useState(DEMO_DATASET.player.region);
  const [gameName, setGameName] = useState(DEMO_DATASET.player.gameName);
  const [tagLine, setTagLine] = useState(DEMO_DATASET.player.tag);
  const [matchCount, setMatchCount] = useState(20);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [flowDetail, setFlowDetail] = useState("当前能力：演示数据与本地文件");
  const [lookupError, setLookupError] = useState("");
  const [localPlayer, setLocalPlayer] = useState<LocalClientPlayer | null>(null);
  const [importMessage, setImportMessage] = useState("尚未导入文件，当前展示完整演示数据。");
  const [importError, setImportError] = useState("");
  const summary = useMemo(() => summarizePlayer(dataset), [dataset]);
  const isFlowBusy = ["resolving", "syncing", "scoring"].includes(flowStatus);
  const activeStep = flowStatus === "ready" ? 3 : flowStatus === "connected" || isFlowBusy ? 2 : 1;

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("haidou-theme", next);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportMessage(`正在读取 ${file.name}`);
    try {
      const imported = await importDataset(file);
      setDataset(imported);
      setFilter("全部");
      setFlowStatus("ready");
      setFlowDetail(`本地文件已提供 ${imported.matches.length} 场对局`);
      setImportMessage(`已导入 ${file.name}，共 ${imported.matches.length} 局。数据仅保存在当前页面。`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "无法读取该文件");
      setImportMessage("导入未完成，仍保留上一次可用数据。");
    } finally {
      event.target.value = "";
    }
  };

  const resetDemo = () => {
    setDataset(DEMO_DATASET);
    setRegion(DEMO_DATASET.player.region);
    setGameName(DEMO_DATASET.player.gameName);
    setTagLine(DEMO_DATASET.player.tag);
    setSourceMode("demo");
    setFlowStatus("ready");
    setFlowDetail(`已恢复全部 ${DEMO_DATASET.matches.length} 场演示对局`);
    setLookupError("");
    setImportError("");
    setImportMessage("已恢复完整演示数据。");
  };

  const changeSource = (nextSource: SourceMode) => {
    setSourceMode(nextSource);
    setFlowStatus("idle");
    setFlowDetail(
      nextSource === "demo"
        ? "演示数据最多提供 31 场流程样本"
        : nextSource === "file"
          ? "文件导入不限制到固定档位"
          : "先启动并登录 LOL，再检测当前玩家",
    );
    setLookupError("");
    setImportError("");
  };

  const connectLocalClient = async () => {
    setLookupError("");
    setFlowStatus("resolving");
    setFlowDetail("正在通过本机数据助手查找 League 客户端");
    try {
      const player = await detectCurrentPlayer();
      setLocalPlayer(player);
      setGameName(player.gameName);
      setTagLine(player.tag);
      setRegion(player.region);
      setFlowStatus("connected");
      setFlowDetail(`已识别 ${player.gameName}#${player.tag} · ${player.region}`);
    } catch (error) {
      setLocalPlayer(null);
      setFlowStatus("idle");
      setFlowDetail("客户端尚未连接，演示数据仍可正常使用");
      setLookupError(error instanceof Error ? error.message : "无法连接 LOL 客户端");
    }
  };

  const runLocalSync = async () => {
    setLookupError("");
    setFlowStatus("syncing");
    setFlowDetail(`正在读取最近 ${matchCount} 场战绩并识别海斗对局`);
    try {
      const result = await syncLocalHistory(matchCount as 20 | 40 | 100 | 200);
      setFlowStatus("scoring");
      setFlowDetail(`已找到 ${result.haidouCount} 场海斗对局，正在计算评分`);
      await wait(160);
      setDataset(result.dataset);
      setLocalPlayer(result.dataset.player);
      setGameName(result.dataset.player.gameName);
      setTagLine(result.dataset.player.tag);
      setRegion(result.dataset.player.region);
      setFilter("全部");
      setFlowStatus("ready");
      setFlowDetail(`读取 ${result.scannedCount} 场战绩，筛选并导入 ${result.haidouCount} 场海斗对局`);
      scrollToReport();
    } catch (error) {
      setFlowStatus(localPlayer ? "connected" : "idle");
      setFlowDetail("读取未完成，页面保留上一次可用战报");
      setLookupError(error instanceof Error ? error.message : "读取 LOL 战绩失败");
    }
  };

  const scrollToReport = () => {
    window.requestAnimationFrame(() => {
      document.getElementById("player-report")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const runDemoLookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = gameName.trim();
    const normalizedTag = tagLine.trim().replace(/^#/, "");
    if (normalizedName.length < 2) {
      setLookupError("游戏名至少需要 2 个字符。");
      return;
    }
    if (normalizedTag.length < 2 || normalizedTag.length > 6) {
      setLookupError("尾标需要 2 到 6 个字符，不用输入井号。");
      return;
    }

    setLookupError("");
    setFlowStatus("resolving");
    await wait(320);
    setFlowStatus("syncing");
    await wait(420);
    setFlowStatus("scoring");
    await wait(380);

    const availableMatchCount = Math.min(matchCount, DEMO_DATASET.matches.length);
    const nextDataset: PlayerDataset = {
      ...DEMO_DATASET,
      player: {
        gameName: normalizedName,
        tag: normalizedTag,
        region,
        updatedAt: new Date().toISOString(),
      },
      matches: DEMO_DATASET.matches.slice(0, availableMatchCount),
    };
    setDataset(nextDataset);
    setFilter("全部");
    setImportMessage(`已用演示对局生成 ${normalizedName}#${normalizedTag} 的流程预览。`);
    setFlowStatus("ready");
    setFlowDetail(
      availableMatchCount < matchCount
        ? `请求 ${matchCount} 场，演示数据实际提供 ${availableMatchCount} 场`
        : `已按选择准备 ${availableMatchCount} 场对局`,
    );
    scrollToReport();
  };

  const downloadTemplate = (kind: "csv" | "json") => {
    const sampleMatches = DEMO_DATASET.matches.slice(0, 2);
    if (kind === "json") {
      downloadBlob(
        JSON.stringify({ ...DEMO_DATASET, source: "imported", matches: sampleMatches }, null, 2),
        "application/json;charset=utf-8",
        "海斗导入模板.json",
      );
      return;
    }
    const rows = [CSV_HEADERS, ...sampleMatches.map(matchToCsvRow)];
    downloadBlob(`\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}`, "text/csv;charset=utf-8", "海斗导入模板.csv");
  };

  const visibleMatches = summary.scoredMatches.filter((item) =>
    filter === "全部" ? true : filter === "胜利" ? item.match.win : !item.match.win,
  );
  const eligibleHeroes = summary.heroes.filter((hero) => hero.games >= 5);
  const bestHero = [...eligibleHeroes].sort((a, b) => b.smoothedWinRate - a.smoothedWinRate)[0];
  const worstHero = [...eligibleHeroes].sort((a, b) => a.smoothedWinRate - b.smoothedWinRate)[0];
  const topRole = [...summary.roleScores].sort((a, b) => b.score - a.score)[0];

  return (
    <>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/" aria-label="海斗战报首页">
          <span className={styles.logoMark}>H</span>
          <span><strong>海斗战报</strong><small>本地数据实验室</small></span>
        </Link>
        <div className={styles.headerActions}>
          <span className={styles.localBadge}>MVP · LOCAL</span>
          <button className={styles.themeButton} type="button" onClick={toggleTheme} aria-label="切换白天或深夜模式">
            <span className={styles.themeDarkLabel} aria-hidden="true">☾ 深夜</span>
            <span className={styles.themeLightLabel} aria-hidden="true">☀ 白天</span>
          </button>
        </div>
      </header>

      <main id="main-content" className={styles.shell}>
        <section className={styles.flowDeck} aria-labelledby="flow-title">
          <div className={styles.flowHeader}>
            <div>
              <span className={styles.flowKicker}>主流程 · V0.3</span>
              <h1 id="flow-title">从玩家身份开始生成海斗战报</h1>
              <p>登录 LOL 后可直接读取当前玩家与最近战绩，也可以继续使用演示检索或导入自己的文件。</p>
            </div>
            <ol className={styles.flowSteps} aria-label="生成战报进度">
              {["选择来源", "准备数据", "查看战报"].map((step, index) => {
                const stepNumber = index + 1;
                const state = stepNumber < activeStep ? "done" : stepNumber === activeStep ? "current" : "upcoming";
                return <li key={step} data-state={state}><span>{stepNumber}</span><strong>{step}</strong></li>;
              })}
            </ol>
          </div>

          <div className={styles.sourceTabs} role="tablist" aria-label="选择数据来源">
            <button type="button" role="tab" aria-selected={sourceMode === "demo"} onClick={() => changeSource("demo")}>
              <span>演示检索</span><small>无需文件，立即体验</small>
            </button>
            <button type="button" role="tab" aria-selected={sourceMode === "file"} onClick={() => changeSource("file")}>
              <span>CSV / JSON</span><small>数据只在当前页面处理</small>
            </button>
            <button type="button" role="tab" aria-selected={sourceMode === "local"} onClick={() => changeSource("local")}>
              <span>本地 LOL 客户端</span><small>读取已登录玩家，不需要密码</small>
            </button>
          </div>

          <div className={styles.flowBody}>
            {sourceMode === "demo" ? (
              <form className={styles.lookupForm} onSubmit={runDemoLookup} noValidate>
                <label>
                  <span>大区</span>
                  <select value={region} onChange={(event) => setRegion(event.target.value)} disabled={isFlowBusy}>
                    {REGIONS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className={styles.nameField}>
                  <span>游戏名</span>
                  <input value={gameName} onChange={(event) => setGameName(event.target.value)} placeholder="例如：夜航船" disabled={isFlowBusy} />
                </label>
                <label>
                  <span>尾标</span>
                  <span className={styles.tagInput}><b>#</b><input value={tagLine} onChange={(event) => setTagLine(event.target.value)} placeholder="0927" disabled={isFlowBusy} /></span>
                </label>
                <label>
                  <span>最近场次</span>
                  <select value={matchCount} onChange={(event) => setMatchCount(Number(event.target.value))} disabled={isFlowBusy}>
                    <option value={20}>20 场</option>
                    <option value={40}>40 场</option>
                    <option value={100}>100 场</option>
                    <option value={200}>200 场</option>
                  </select>
                </label>
                <button className={styles.queryButton} type="submit" disabled={isFlowBusy}>
                  {isFlowBusy ? "正在生成" : "生成演示战报"}
                </button>
                {lookupError && <p className={styles.lookupError} role="alert">{lookupError}</p>}
              </form>
            ) : sourceMode === "file" ? (
              <div className={styles.fileFlow}>
                <div>
                  <h2>导入标准对局文件</h2>
                  <p>{importMessage}</p>
                  <div className={styles.importActions}>
                    <label className={styles.primaryButton}>
                      选择数据文件
                      <input type="file" accept=".csv,.json,application/json,text/csv" onChange={onFileChange} />
                    </label>
                    <button type="button" onClick={() => downloadTemplate("csv")}>下载 CSV 模板</button>
                    <button type="button" onClick={() => downloadTemplate("json")}>下载 JSON 模板</button>
                    <button type="button" onClick={resetDemo}>恢复演示数据</button>
                  </div>
                  {importError && <p className={styles.importError} role="alert">{importError}</p>}
                </div>
                <div className={styles.schemaNote}>
                  <span>格式要求</span>
                  <p>职业仅接受辅助、法师、刺客、坦克、射手、战士。海克斯使用竖线分隔，回城局补充选择时间与前后死亡数。</p>
                </div>
              </div>
            ) : (
              <div className={styles.localClientFlow}>
                <div className={styles.clientStatus} data-connected={Boolean(localPlayer)}>
                  <span className={styles.clientStatusMark} aria-hidden="true" />
                  <div>
                    <small>{localPlayer ? "已连接当前玩家" : "等待检测客户端"}</small>
                    <strong>{localPlayer ? `${localPlayer.gameName}#${localPlayer.tag}` : "请先启动并登录 LOL"}</strong>
                    <p>{localPlayer ? `${localPlayer.region} · 身份信息来自本机 League 客户端` : "网页不会要求或读取你的 LOL、WeGame 密码。"}</p>
                  </div>
                  <button type="button" onClick={connectLocalClient} disabled={isFlowBusy}>
                    {flowStatus === "resolving" ? "正在检测" : localPlayer ? "重新检测" : "检测登录客户端"}
                  </button>
                </div>
                <div className={styles.syncControls}>
                  <label>
                    <span>读取最近战绩</span>
                    <select value={matchCount} onChange={(event) => setMatchCount(Number(event.target.value))} disabled={isFlowBusy}>
                      <option value={20}>20 场</option>
                      <option value={40}>40 场</option>
                      <option value={100}>100 场</option>
                      <option value={200}>200 场</option>
                    </select>
                  </label>
                  <button className={styles.queryButton} type="button" onClick={runLocalSync} disabled={!localPlayer || isFlowBusy}>
                    {flowStatus === "syncing" || flowStatus === "scoring" ? "正在导入" : "筛选海斗并生成评分"}
                  </button>
                  <p>按所选上限读取最近战绩，仅保留带海克斯强化的极地大乱斗对局。</p>
                </div>
                {lookupError && <p className={styles.lookupError} role="alert">{lookupError}</p>}
              </div>
            )}
          </div>

          <div className={styles.flowFooter} aria-live="polite">
            <span className={styles.statusLine}><i data-busy={isFlowBusy} />{FLOW_STATUS_COPY[flowStatus]}</span>
            <span>{flowDetail}</span>
          </div>
        </section>

        <section id="player-report" className={styles.profileBand} aria-labelledby="player-name">
          <div className={styles.profileCopy}>
            <div className={styles.eyebrowRow}>
              <span>{dataset.player.region}</span>
              <span>{dataset.source === "demo" ? "演示检索" : dataset.source === "local-client" ? "LOL 客户端" : "本地导入"}</span>
            </div>
            <h1 id="player-name">{dataset.player.gameName}<span>#{dataset.player.tag}</span></h1>
            <p>最近 {dataset.matches.length} 局海斗复盘，按英雄职业、对局时长与死亡规则计算。</p>
          </div>

          <div className={styles.scoreCluster} aria-label={`操作总得分 ${summary.overallScore ?? "样本不足"}`}>
            <div className={styles.hexScore}>
              <span>操作总分</span>
              <strong>{summary.overallScore ?? "--"}</strong>
              <small>置信度 {summary.confidence}%</small>
            </div>
            <p>{summary.overallScore && summary.overallScore >= 70 ? "强项清晰，继续降低关键死亡。" : "先累积更多对局，再观察稳定表现。"}</p>
          </div>

          <dl className={styles.snapshotStats}>
            <div><dt>可分析场次</dt><dd>{dataset.matches.length}</dd></div>
            <div><dt>胜率</dt><dd>{summary.winRate}<span>%</span></dd></div>
            <div><dt>数据高光局</dt><dd>{summary.highlights.length}</dd></div>
            <div><dt>最强职业</dt><dd className={styles.textValue}>{topRole?.games ? topRole.role : "样本不足"}</dd></div>
          </dl>
        </section>

        <section className={styles.analysisGrid}>
          <div className={styles.rolePanel}>
            <div className={styles.sectionHeading}>
              <div><span>职业雷达</span><h2>六类英雄表现</h2></div>
              <small>同类模型得分</small>
            </div>
            <div className={styles.roleBars}>
              {summary.roleScores.map((role) => (
                <div className={styles.roleBar} key={role.role}>
                  <div><span>{role.role}</span><small>{role.games} 局</small></div>
                  <div className={styles.track}><span style={{ width: `${role.games ? role.score : 0}%` }} /></div>
                  <strong>{role.games ? role.score : "--"}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.heroPanel}>
            <div className={styles.sectionHeading}>
              <div><span>英雄池</span><h2>使用与胜负</h2></div>
              <small>至少 5 局才进入常胜评估</small>
            </div>
            <div className={styles.heroVerdicts}>
              <div><span>常胜英雄</span><strong>{bestHero?.name ?? "样本不足"}</strong><small>{bestHero ? `${bestHero.games} 局 · ${bestHero.winRate}% 胜率` : "需要更多场次"}</small></div>
              <div><span>常败英雄</span><strong>{worstHero?.name ?? "样本不足"}</strong><small>{worstHero ? `${worstHero.games} 局 · ${worstHero.winRate}% 胜率` : "需要更多场次"}</small></div>
            </div>
            <table className={styles.heroTable}>
              <thead><tr><th>英雄</th><th>场次</th><th>胜场</th><th>胜率</th></tr></thead>
              <tbody>
                {summary.heroes.slice(0, 6).map((hero) => (
                  <tr key={hero.name}><td>{hero.name}</td><td>{hero.games}</td><td>{hero.wins}</td><td>{hero.winRate}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.highlightSection} aria-labelledby="highlights-title">
          <div className={styles.sectionHeading}>
            <div><span>关键样本</span><h2 id="highlights-title">数据高光局</h2></div>
            <small>单局得分 88 以上</small>
          </div>
          {summary.highlights.length ? (
            <div className={styles.highlightRail}>
              {summary.highlights.map((item, index) => (
                <article key={item.match.id}>
                  <span>0{index + 1}</span>
                  <div><strong>{item.match.champion}</strong><small>{item.match.role} · {item.match.kills}/{item.match.deaths}/{item.match.assists}</small></div>
                  <p>{item.dimensions.sort((a, b) => b.score - a.score)[0]?.label} {Math.max(...item.dimensions.map((dimension) => dimension.score))} 分</p>
                  <b>{item.score}</b>
                </article>
              ))}
            </div>
          ) : <p className={styles.emptyState}>当前数据没有达到 88 分的高光局。继续导入对局后再观察。</p>}
        </section>

        <section className={styles.augmentSection} aria-labelledby="augments-title">
          <div className={styles.sectionHeading}>
            <div><span>选择偏好</span><h2 id="augments-title">常选海克斯</h2></div>
            <small>仅展示频次，不展示胜率</small>
          </div>
          <div className={styles.augmentRank}>
            {summary.augments.map((augment, index) => (
              <div key={augment.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{augment.name}</strong>
                <div className={styles.miniTrack}><span style={{ width: `${Math.min(100, augment.share * 4)}%` }} /></div>
                <small>{augment.picks} 次</small>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.matchesSection} aria-labelledby="matches-title">
          <div className={styles.matchesHeader}>
            <div className={styles.sectionHeading}>
              <div><span>比赛时间带</span><h2 id="matches-title">近期对局</h2></div>
              <small>伤害、控制、治疗与生存共同评分</small>
            </div>
            <div className={styles.segmented} aria-label="筛选近期对局">
              {(["全部", "胜利", "失败"] as MatchFilter[]).map((option) => (
                <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>{option}</button>
              ))}
            </div>
          </div>
          <div className={styles.matchList}>
            {visibleMatches.map((item) => <MatchRow key={item.match.id} item={item} />)}
          </div>
        </section>

        <aside className={styles.methodNote}>
          <span>评分说明</span>
          <p>当前 MVP 使用固定职业基线验证产品体验。正式数据源接入后，将切换为同版本、同模式、同英雄的样本百分位。历史“作弊：我能回城！”对局会提高回城后的死亡权重。</p>
        </aside>
      </main>

      <footer className={styles.footer}>
        <span>海斗战报 MVP · 数据仅在当前浏览器处理</span>
        <nav aria-label="页脚"><Link href="/privacy">隐私说明</Link><Link href="/terms">使用边界</Link></nav>
      </footer>
    </>
  );
}
