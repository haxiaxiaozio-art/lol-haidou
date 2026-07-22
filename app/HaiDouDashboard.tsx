"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { DEMO_DATASET } from "../lib/demo-data";
import { importDataset, CSV_HEADERS } from "../lib/importers";
import { buildMatchCommentary } from "../lib/match-commentary";
import { fetchCommunityCalibration } from "../lib/calibration-client";
import { analyzeDataQuality, type SourceDiagnostics } from "../lib/data-quality";
import {
  HELPER_DOWNLOAD_URL,
  HELPER_LAUNCH_URL,
  LocalClientError,
  probeLocalConnection,
  searchLocalHistory,
  syncLocalHistory,
  type LocalConnectionProbe,
} from "../lib/local-client";
import { summarizePlayer } from "../lib/scoring";
import type { CalibrationModel, LocalClientPlayer, MatchRecord, NetworkRatingEstimate, PlayerDataset, ScoredMatch, SyncDiagnostic } from "../lib/types";
import styles from "./page.module.css";

type MatchFilter = "全部" | "胜利" | "失败";
type SourceMode = "demo" | "file" | "search" | "local";
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

const INITIAL_CONNECTION: LocalConnectionProbe = {
  status: "checking",
  message: "正在检测本地数据助手",
  player: null,
};

const CONNECTION_LABEL: Record<LocalConnectionProbe["status"], string> = {
  checking: "正在检测助手",
  "helper-offline": "数据助手未启动",
  "helper-outdated": "数据助手需要更新",
  "client-offline": "等待 LOL 登录",
  connected: "玩家已连接",
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const ratingStatusLabel: Record<NetworkRatingEstimate["status"], string> = {
  calibrating: "校准中",
  provisional: "初步稳定",
  stable: "稳定",
};

const calibrationStatusLabel = {
  collecting: "收集中",
  calibrating: "校准中",
  stable: "稳定",
} as const;

const calibrationChannelLabel = {
  baseline: "固定基线",
  canary: "灰度验证",
  stable: "正式生效",
  rollback: "已触发回滚",
} as const;

const DIAGNOSTIC_CATEGORIES: Array<{ key: SyncDiagnostic["category"]; label: string; clear: string }> = [
  { key: "client-login", label: "客户端登录", clear: "已识别客户端登录状态" },
  { key: "region-unavailable", label: "大区可用性", clear: "当前大区映射可用" },
  { key: "interface-timeout", label: "接口响应", clear: "接口未出现超时" },
  { key: "permission-denied", label: "连接权限", clear: "本机连接权限正常" },
  { key: "field-missing", label: "字段完整性", clear: "评分所需字段可用" },
];

const DIAGNOSTIC_SOURCE_LABEL: Record<SyncDiagnostic["source"], string> = {
  helper: "数据助手",
  client: "LOL 客户端",
  sgp: "SGP",
  lcu: "LCU",
  logs: "本机日志",
  model: "统一模型",
};

function SyncDiagnosticCenter({
  diagnostics,
  checking,
  onRetry,
}: {
  diagnostics: SyncDiagnostic[];
  checking: boolean;
  onRetry: () => void;
}) {
  const activeCount = diagnostics.length;
  return (
    <section className={styles.diagnosticCenter} aria-labelledby="diagnostic-title">
      <div className={styles.diagnosticHeader}>
        <div>
          <span>SYNC DIAGNOSTICS</span>
          <h2 id="diagnostic-title">同步失败诊断中心</h2>
          <p>{checking ? "正在重新检查本机链路" : activeCount ? `发现 ${activeCount} 条诊断，按类别给出处理建议` : "五项同步检查均未发现异常"}</p>
        </div>
        <button type="button" onClick={onRetry} disabled={checking}>{checking ? "正在检测" : "重新检测"}</button>
      </div>
      <div className={styles.diagnosticRows} role="status" aria-live="polite">
        {DIAGNOSTIC_CATEGORIES.map((category, index) => {
          const diagnostic = [...diagnostics].reverse().find((item) => item.category === category.key);
          const state = checking ? "checking" : diagnostic?.severity ?? "clear";
          return (
            <article key={category.key} data-state={state}>
              <span className={styles.diagnosticIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.diagnosticIdentity}>
                <strong>{category.label}</strong>
                <small>{diagnostic ? `${DIAGNOSTIC_SOURCE_LABEL[diagnostic.source]} · ${diagnostic.code}` : checking ? "等待检测结果" : category.clear}</small>
              </div>
              <div className={styles.diagnosticDetail}>
                <strong>{diagnostic?.title ?? (checking ? "检测中" : "正常")}</strong>
                <p>{diagnostic?.message ?? (checking ? "正在确认此项状态。" : category.clear)}</p>
                {diagnostic && <small>{diagnostic.suggestion}</small>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const resultLabel = (score: number, highlightThreshold = 88) => {
  if (score >= highlightThreshold) return "高光";
  if (score >= 74) return "出色";
  if (score >= 58) return "稳定";
  return "待复盘";
};

const roleLabel = (match: MatchRecord) =>
  match.secondaryRole ? `${match.role} / ${match.secondaryRole}` : match.role;

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
  match.secondaryRole ?? "",
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
  (match.items ?? []).join("|"),
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

function withScoringSnapshot(dataset: PlayerDataset, model: CalibrationModel | null): PlayerDataset {
  if (!model) return dataset;
  return {
    ...dataset,
    scoringSnapshot: { modelVersion: model.version, scoredAt: new Date().toISOString(), model },
  };
}

function MatchRow({ item, highlightThreshold }: { item: ScoredMatch; highlightThreshold: number }) {
  const match = item.match;
  const commentary = buildMatchCommentary(item);
  return (
    <article className={styles.matchRow} data-result={match.win ? "win" : "loss"}>
      <div className={styles.matchIdentity}>
        <span className={styles.championMark} aria-hidden="true">{match.champion.slice(0, 1)}</span>
        <div>
          <strong>{match.champion}</strong>
          <span>{roleLabel(match)} · {dateFormatter.format(new Date(match.playedAt))}</span>
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
        <span>{resultLabel(item.score, highlightThreshold)}</span>
      </div>
      <details className={styles.matchDetails}>
        <summary>评分明细</summary>
        <div className={styles.roleBlend} aria-label="主职业基础分与副职业加权奖励">
          <span>职业评分</span>
          {item.roleComponents.map((component) => (
            <div key={component.role}>
              <strong>{component.kind === "primary" ? "主" : "副"}·{component.role}</strong>
              <b>{component.kind === "secondary" ? `+${component.contribution}` : component.score}</b>
              <small>{component.kind === "secondary" ? `${component.score} × ${Math.round(component.weight * 100)}%` : "完整计分"}</small>
            </div>
          ))}
          {item.roleComponents.length === 2 && <em>加权后 {item.positiveScore} · 上限 100</em>}
        </div>
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
        {Boolean(match.items?.length) && (
          <div className={styles.matchBuild}><span>本局出装</span>{match.items?.map((equipment) => <b key={equipment}>{equipment}</b>)}</div>
        )}
        <div className={styles.matchCommentary}>
          <span>海斗锐评 · 参战 {commentary.participation}</span>
          <strong>{commentary.verdict}</strong>
          <p>{commentary.improvement}</p>
        </div>
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
  const [searchGameName, setSearchGameName] = useState("");
  const [searchTagLine, setSearchTagLine] = useState("");
  const [matchCount, setMatchCount] = useState(20);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [flowDetail, setFlowDetail] = useState("当前能力：演示、文件、我的战绩与同区玩家检索");
  const [lookupError, setLookupError] = useState("");
  const [localPlayer, setLocalPlayer] = useState<LocalClientPlayer | null>(null);
  const [localConnection, setLocalConnection] = useState<LocalConnectionProbe>(INITIAL_CONNECTION);
  const [syncDiagnostics, setSyncDiagnostics] = useState<SyncDiagnostic[]>([]);
  const [importMessage, setImportMessage] = useState("尚未导入文件，当前展示完整演示数据。");
  const [importError, setImportError] = useState("");
  const [networkRating, setNetworkRating] = useState<NetworkRatingEstimate | null>(null);
  const [calibrationModel, setCalibrationModel] = useState<CalibrationModel | null>(null);
  const [calibrationError, setCalibrationError] = useState("");
  const [calibrationConsent, setCalibrationConsent] = useState(false);
  const [sourceDiagnostics, setSourceDiagnostics] = useState<SourceDiagnostics>({
    requestedCount: DEMO_DATASET.matches.length,
    scannedCount: DEMO_DATASET.matches.length,
    haidouCount: DEMO_DATASET.matches.length,
  });
  const summary = useMemo(() => summarizePlayer(dataset, calibrationModel), [dataset, calibrationModel]);
  const dataQuality = useMemo(
    () => analyzeDataQuality(dataset, sourceDiagnostics, calibrationModel),
    [dataset, sourceDiagnostics, calibrationModel],
  );
  const visibleDiagnostics = useMemo(() => {
    const byCategory = new Map<SyncDiagnostic["category"], SyncDiagnostic>();
    for (const diagnostic of syncDiagnostics) byCategory.set(diagnostic.category, diagnostic);
    if (localConnection.status !== "connected" && localConnection.diagnostic) {
      byCategory.set(localConnection.diagnostic.category, localConnection.diagnostic);
    }
    return [...byCategory.values()];
  }, [localConnection, syncDiagnostics]);
  const isFlowBusy = ["resolving", "syncing", "scoring"].includes(flowStatus);
  const activeStep = flowStatus === "ready" ? 3 : flowStatus === "connected" || isFlowBusy ? 2 : 1;

  useEffect(() => {
    let active = true;
    const refreshConnection = async () => {
      const connection = await probeLocalConnection();
      if (!active) return;
      setLocalConnection(connection);
      setLocalPlayer(connection.player);
    };
    void refreshConnection();
    const timer = window.setInterval(() => void refreshConnection(), 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchCommunityCalibration()
      .then((model) => {
        if (!active) return;
        setCalibrationModel(model);
        setCalibrationError("");
      })
      .catch((error) => {
        if (active) setCalibrationError(error instanceof Error ? error.message : "社区校准模型暂时不可用");
      });
    return () => { active = false; };
  }, []);

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
      if (imported.scoringSnapshot) {
        setCalibrationModel(imported.scoringSnapshot.model);
        setCalibrationError("");
      }
      setNetworkRating(null);
      setSourceDiagnostics({ requestedCount: null, scannedCount: imported.matches.length, haidouCount: imported.matches.length });
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
    setNetworkRating(null);
    setSourceDiagnostics({ requestedCount: DEMO_DATASET.matches.length, scannedCount: DEMO_DATASET.matches.length, haidouCount: DEMO_DATASET.matches.length });
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
    if (nextSource === "local" && localPlayer) {
      setGameName(localPlayer.gameName);
      setTagLine(localPlayer.tag);
      setRegion(localPlayer.region);
    }
    setFlowStatus("idle");
    setFlowDetail(
      nextSource === "demo"
        ? "演示数据最多提供 31 场流程样本"
        : nextSource === "file"
          ? "文件导入不限制到固定档位"
          : nextSource === "search"
            ? localPlayer
              ? `可以检索 ${localPlayer.region} 的玩家战绩`
              : "检索其他玩家前需要登录 LOL 客户端"
            : localConnection.message,
    );
    setLookupError("");
    setImportError("");
  };

  const connectLocalClient = async () => {
    setLookupError("");
    setFlowStatus("resolving");
    setFlowDetail("正在通过本机数据助手查找 League 客户端");
    const connection = await probeLocalConnection();
    setLocalConnection(connection);
    setLocalPlayer(connection.player);
    if (connection.player) {
      const player = connection.player;
      setLocalPlayer(player);
      setGameName(player.gameName);
      setTagLine(player.tag);
      setRegion(player.region);
      setFlowStatus("connected");
      setFlowDetail(`已识别 ${player.gameName}#${player.tag} · ${player.region}`);
      return;
    }
    setFlowStatus("idle");
    setFlowDetail(
      connection.status === "helper-offline"
        ? "本地数据助手尚未启动"
        : connection.status === "helper-outdated"
          ? "请安装最新版数据助手后继续"
          : "数据助手在线，等待 LOL 客户端登录",
    );
    setLookupError(connection.message);
  };

  const startInstalledHelper = () => {
    setLookupError("");
    setFlowStatus("resolving");
    setFlowDetail("正在请求 Windows 启动数据助手，网页会自动重新检测");
    window.setTimeout(() => void connectLocalClient(), 1_800);
    window.setTimeout(() => void connectLocalClient(), 4_500);
  };

  const helperAction = (compact = false) => {
    const needsUpdate = localConnection.status === "helper-outdated";
    const unavailable = localConnection.status === "helper-offline" || needsUpdate;
    if (!unavailable) {
      return (
        <button type="button" onClick={connectLocalClient} disabled={isFlowBusy}>
          {flowStatus === "resolving" ? "正在检测" : localPlayer ? "重新检测" : "检测登录客户端"}
        </button>
      );
    }
    return (
      <div className={styles.helperActions} data-compact={compact ? "true" : "false"}>
        <a className={styles.helperPrimary} href={HELPER_DOWNLOAD_URL}>
          {needsUpdate ? "更新助手（自动关闭旧版）" : "安装助手"}
        </a>
        {!needsUpdate && (
          <a className={styles.helperSecondary} href={HELPER_LAUNCH_URL} onClick={startInstalledHelper}>
            已安装，启动助手
          </a>
        )}
        <small>{needsUpdate ? "运行安装程序后选择目录；安装器会关闭旧助手、完成覆盖并自动重启" : "仅支持 Windows，首次安装可能显示“未知发布者”"}</small>
      </div>
    );
  };

  const runLocalSync = async () => {
    setLookupError("");
    setSyncDiagnostics([]);
    setFlowStatus("syncing");
    setFlowDetail(`正在读取最近 ${matchCount} 场战绩并识别海斗对局`);
    try {
      const result = await syncLocalHistory(matchCount as 20 | 40 | 100 | 200, calibrationConsent);
      setFlowStatus("scoring");
      setFlowDetail(`已找到 ${result.haidouCount} 场海斗对局，正在计算评分`);
      await wait(160);
      setDataset(withScoringSnapshot(result.dataset, result.calibrationModel));
      setNetworkRating(result.networkRating);
      setCalibrationModel(result.calibrationModel);
      setCalibrationError(result.calibrationError);
      setSourceDiagnostics({
        requestedCount: matchCount,
        scannedCount: result.scannedCount,
        haidouCount: result.haidouCount,
        historySources: result.historySources,
        sourceCounts: result.sourceCounts,
        fallbackReasons: result.fallbackReasons,
      });
      setSyncDiagnostics(result.diagnostics);
      setLocalPlayer(result.dataset.player);
      setGameName(result.dataset.player.gameName);
      setTagLine(result.dataset.player.tag);
      setRegion(result.dataset.player.region);
      setFilter("全部");
      setFlowStatus("ready");
      setFlowDetail(`读取 ${result.scannedCount} 场，导入 ${result.haidouCount} 场海斗${result.calibrationAccepted ? `，新增 ${result.calibrationAccepted} 份匿名校准样本` : ""}${result.calibrationQuarantined ? `，隔离 ${result.calibrationQuarantined} 份异常样本` : ""}`);
      scrollToReport();
    } catch (error) {
      setFlowStatus(localPlayer ? "connected" : "idle");
      setFlowDetail("读取未完成，页面保留上一次可用战报");
      setLookupError(error instanceof Error ? error.message : "读取 LOL 战绩失败");
      setSyncDiagnostics(error instanceof LocalClientError && error.diagnostic ? [error.diagnostic] : [{
        category: "interface-timeout",
        code: "SYNC_REQUEST_FAILED",
        source: "helper",
        severity: "error",
        title: "接口超时或暂时不可用",
        message: error instanceof Error ? error.message : "读取 LOL 战绩失败",
        suggestion: "保持客户端在线后重试；连续失败时重启客户端和数据助手。",
        retryable: true,
      }]);
    }
  };

  const runPlayerSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = searchGameName.trim();
    const normalizedTag = searchTagLine.trim().replace(/^#/, "");
    if (!localPlayer) {
      setLookupError("请先启动数据助手，并登录 LOL 客户端。");
      return;
    }
    if (normalizedName.length < 2 || normalizedName.length > 32) {
      setLookupError("游戏名需要 2 到 32 个字符。");
      return;
    }
    if (normalizedTag.length < 2 || normalizedTag.length > 6) {
      setLookupError("尾标需要 2 到 6 个字符，不用输入井号。");
      return;
    }

    setLookupError("");
    setSyncDiagnostics([]);
    setFlowStatus("resolving");
    setFlowDetail(`正在 ${localPlayer.region} 查找 ${normalizedName}#${normalizedTag}`);
    try {
      await wait(120);
      setFlowStatus("syncing");
      setFlowDetail(`已提交玩家检索，正在读取最近 ${matchCount} 场战绩`);
      const result = await searchLocalHistory(
        normalizedName,
        normalizedTag,
        matchCount as 20 | 40 | 100 | 200,
      );
      setFlowStatus("scoring");
      setFlowDetail(`已找到 ${result.haidouCount} 场海斗对局，正在计算评分`);
      await wait(160);
      setDataset(withScoringSnapshot(result.dataset, result.calibrationModel));
      setNetworkRating(result.networkRating);
      setCalibrationModel(result.calibrationModel);
      setCalibrationError(result.calibrationError);
      setSourceDiagnostics({
        requestedCount: matchCount,
        scannedCount: result.scannedCount,
        haidouCount: result.haidouCount,
        historySources: result.historySources,
        sourceCounts: result.sourceCounts,
        fallbackReasons: result.fallbackReasons,
      });
      setSyncDiagnostics(result.diagnostics);
      setFilter("全部");
      setFlowStatus("ready");
      setFlowDetail(`读取 ${result.scannedCount} 场，导入 ${result.haidouCount} 场海斗${result.calibrationAccepted ? `，新增 ${result.calibrationAccepted} 份匿名校准样本` : ""}${result.calibrationQuarantined ? `，隔离 ${result.calibrationQuarantined} 份异常样本` : ""}`);
      scrollToReport();
    } catch (error) {
      setFlowStatus("idle");
      setFlowDetail("检索未完成，页面保留上一份可用战报");
      setLookupError(error instanceof Error ? error.message : "无法检索该玩家");
      setSyncDiagnostics(error instanceof LocalClientError && error.diagnostic ? [error.diagnostic] : [{
        category: "interface-timeout",
        code: "SEARCH_REQUEST_FAILED",
        source: "helper",
        severity: "error",
        title: "接口超时或暂时不可用",
        message: error instanceof Error ? error.message : "无法检索该玩家",
        suggestion: "确认客户端在线且玩家属于当前大区，然后重新检索。",
        retryable: true,
      }]);
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
    setNetworkRating(null);
    setSourceDiagnostics({ requestedCount: matchCount, scannedCount: availableMatchCount, haidouCount: availableMatchCount });
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

  const exportReplayReport = () => {
    const replayDataset = withScoringSnapshot(dataset, calibrationModel);
    const safeName = dataset.player.gameName.replace(/[\\/:*?"<>|]/g, "_");
    downloadBlob(
      JSON.stringify(replayDataset, null, 2),
      "application/json;charset=utf-8",
      `${safeName}-海斗历史评分报告.json`,
    );
  };

  const visibleMatches = summary.scoredMatches.filter((item) =>
    filter === "全部" ? true : filter === "胜利" ? item.match.win : !item.match.win,
  );
  const heroMinimumGames = Math.max(5, Math.min(12, Math.ceil(dataset.matches.length * 0.06)));
  const eligibleHeroes = summary.heroes.filter((hero) => hero.games >= heroMinimumGames);
  const bestHero = [...eligibleHeroes].sort((a, b) => b.smoothedWinRate - a.smoothedWinRate || b.games - a.games)[0];
  const worstHero = [...eligibleHeroes].sort((a, b) => a.smoothedWinRate - b.smoothedWinRate || b.games - a.games)[0];
  const topRole = [...summary.roleScores].filter((role) => role.games > 0).sort((a, b) => b.reliableScore - a.reliableScore || b.games - a.games)[0];
  const displayedHeroes = summary.heroes.slice(0, 10);
  const displayedHeroGames = displayedHeroes.reduce((total, hero) => total + hero.games, 0);
  const displayedAugments = summary.augments.slice(0, 12);
  const totalAugmentPicks = summary.augments.reduce((total, augment) => total + augment.picks, 0);
  const displayedAugmentPicks = displayedAugments.reduce((total, augment) => total + augment.picks, 0);
  const topAugmentPicks = displayedAugments[0]?.picks ?? 1;
  const displayedItems = summary.favoriteItems.slice(0, 10);

  return (
    <>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      <header className={styles.topbar}>
        <a className={styles.wordmark} href="./" aria-label="海斗战报首页">
          <span className={styles.logoMark}>H</span>
          <span><strong>海斗战报</strong><small>本地数据实验室</small></span>
        </a>
        <div className={styles.headerActions}>
          <span className={styles.localBadge} data-status={localConnection.status} title={localConnection.message}>
            <i aria-hidden="true" />{localPlayer ? `${localPlayer.gameName}#${localPlayer.tag}` : CONNECTION_LABEL[localConnection.status]}
          </span>
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
            <span className={styles.flowKicker}>主流程 · V0.6</span>
              <h1 id="flow-title">从玩家身份开始生成海斗战报</h1>
              <p>登录 LOL 后可读取自己的战绩，也可按 Riot ID 检索同区玩家；演示数据与文件导入继续保留。</p>
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
            <button type="button" role="tab" aria-selected={sourceMode === "search"} onClick={() => changeSource("search")}>
              <span>检索玩家</span><small>查询当前客户端所在大区</small>
            </button>
            <button type="button" role="tab" aria-selected={sourceMode === "local"} onClick={() => changeSource("local")}>
              <span>我的战绩</span><small>读取当前登录玩家，不需要密码</small>
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
                  <span>战绩扫描上限</span>
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
                  <p>主、副职业仅接受辅助、法师、刺客、坦克、射手、战士，副职业可留空。海克斯使用竖线分隔，回城局补充选择时间与前后死亡数。</p>
                </div>
              </div>
            ) : sourceMode === "search" ? (
              <div className={styles.searchPlayerFlow}>
                <div className={styles.searchClientLine} data-status={localConnection.status}>
                  <span className={styles.clientStatusMark} aria-hidden="true" />
                  <div>
                    <small>检索凭据</small>
                    <strong>{localPlayer ? `${localPlayer.region} 已就绪` : "需要登录 LOL 客户端"}</strong>
                    <p>{localPlayer ? `通过 ${localPlayer.gameName}#${localPlayer.tag} 的本机会话查询同区玩家` : localConnection.message}</p>
                  </div>
                  {helperAction(true)}
                </div>
                <form className={`${styles.lookupForm} ${styles.playerSearchForm}`} onSubmit={runPlayerSearch} noValidate>
                  <label className={styles.nameField}>
                    <span>游戏名</span>
                    <input value={searchGameName} onChange={(event) => setSearchGameName(event.target.value)} placeholder="输入准确游戏名" disabled={isFlowBusy} autoComplete="off" />
                  </label>
                  <label>
                    <span>尾标</span>
                    <span className={styles.tagInput}><b>#</b><input value={searchTagLine} onChange={(event) => setSearchTagLine(event.target.value)} placeholder="例如 0927" disabled={isFlowBusy} autoComplete="off" /></span>
                  </label>
                  <label>
                    <span>战绩扫描上限</span>
                    <select value={matchCount} onChange={(event) => setMatchCount(Number(event.target.value))} disabled={isFlowBusy}>
                      <option value={20}>20 场</option>
                      <option value={40}>40 场</option>
                      <option value={100}>100 场</option>
                      <option value={200}>200 场</option>
                    </select>
                  </label>
                  <button className={styles.queryButton} type="submit" disabled={!localPlayer || isFlowBusy}>
                    {flowStatus === "resolving" ? "正在查找" : flowStatus === "syncing" || flowStatus === "scoring" ? "正在导入" : "检索并生成战报"}
                  </button>
                  <p className={styles.searchScopeNote}>当前版本只检索已登录客户端所在大区，输入完整的游戏名和尾标可避免同名误判。</p>
                  {lookupError && <p className={styles.lookupError} role="alert">{lookupError}</p>}
                </form>
              </div>
            ) : (
              <div className={styles.localClientFlow}>
                <div className={styles.clientStatus} data-status={localConnection.status}>
                  <span className={styles.clientStatusMark} aria-hidden="true" />
                  <div>
                    <small>{CONNECTION_LABEL[localConnection.status]}</small>
                    <strong>{localPlayer ? `${localPlayer.gameName}#${localPlayer.tag}` : localConnection.status === "helper-offline" ? "安装助手后即可读取真实战绩" : localConnection.status === "helper-outdated" ? "请更新数据助手" : "请启动并登录 LOL"}</strong>
                    <p>{localPlayer ? `${localPlayer.region} · 身份信息来自本机 League 客户端` : localConnection.message}</p>
                  </div>
                  {helperAction()}
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
                  <label className={styles.calibrationConsent}>
                    <input
                      type="checkbox"
                      checked={calibrationConsent}
                      onChange={(event) => setCalibrationConsent(event.target.checked)}
                      disabled={isFlowBusy}
                    />
                    <span>匿名贡献本人的海斗样本</span>
                    <small>可选。只上传去标识化的单局指标，不含 Riot ID、PUUID、英雄、海克斯或装备；检索其他玩家时不会上传。</small>
                  </label>
                  <p>所选数字是全部模式的战绩扫描上限，统计只保留其中带海克斯强化的极地大乱斗对局。</p>
                </div>
                {lookupError && <p className={styles.lookupError} role="alert">{lookupError}</p>}
              </div>
            )}
          </div>

          {(sourceMode === "search" || sourceMode === "local") && (
            <SyncDiagnosticCenter
              diagnostics={visibleDiagnostics}
              checking={localConnection.status === "checking" || isFlowBusy}
              onRetry={() => void connectLocalClient()}
            />
          )}

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
            <div className={styles.networkScore}>
              <span>海斗估算分</span>
              <strong>{networkRating?.rating ?? "--"}</strong>
              <small>{networkRating ? `${networkRating.low}–${networkRating.high}` : "需客户端同步"}</small>
              <em>{networkRating ? `${ratingStatusLabel[networkRating.status]} · 可信度 ${networkRating.confidence}% · ${networkRating.games} 场` : "胜负与对手强度模型"}</em>
            </div>
            <small className={styles.networkNotice}>{networkRating ? "第三方估算，不是 Riot 官方 MMR" : "同步真实海斗战绩后生成网络估算"}</small>
          </div>

          <dl className={styles.snapshotStats}>
            <div><dt>可分析场次</dt><dd>{dataset.matches.length}</dd></div>
            <div><dt>胜率</dt><dd>{summary.winRate}<span>%</span></dd></div>
            <div><dt>数据高光局</dt><dd>{summary.highlights.length}</dd></div>
            <div><dt>最强职业</dt><dd className={styles.textValue} title={topRole ? `场次稳健指数 ${topRole.reliableScore}` : undefined}>{topRole?.role ?? "样本不足"}{topRole && <span>{topRole.games} 局</span>}</dd></div>
          </dl>
        </section>

        <section className={styles.qualitySection} aria-labelledby="quality-title">
          <div className={styles.qualityHeading}>
            <div><span>可信度链路</span><h2 id="quality-title">数据质量与真实样本校准</h2></div>
            <p>质量只说明数据是否足够完整，不参与抬高或压低玩家操作分。</p>
          </div>
          <div className={styles.qualityOverview}>
            <div className={styles.qualityScore} data-status={dataQuality.status}>
              <span>本次数据质量</span>
              <strong>{dataQuality.score}</strong>
              <small>{dataQuality.status} · {dataQuality.sourceLabel}</small>
              <em>{dataQuality.sampleLabel}</em>
            </div>
            <div className={styles.qualityIndicators}>
              {dataQuality.indicators.map((indicator) => (
                <div key={indicator.key} data-tone={indicator.tone}>
                  <span>{indicator.label}</span>
                  <strong>{indicator.value}%</strong>
                  <div><i style={{ width: `${indicator.value}%` }} /></div>
                  <small>{indicator.detail}</small>
                </div>
              ))}
            </div>
            <aside className={styles.missingReasons}>
              <span>缺失与限制</span>
              <ul>{dataQuality.missingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </aside>
          </div>

          <div className={styles.calibrationPanel}>
            <div className={styles.calibrationMeta}>
              <span>社区校准模型</span>
              <strong>{calibrationModel ? calibrationStatusLabel[calibrationModel.status] : "固定基线"}</strong>
              <small>{calibrationModel ? `${calibrationModel.totalSamples} 份真实匿名样本 · ${calibrationModel.version}` : calibrationError || "同步客户端后读取公共聚合模型"}</small>
            </div>
            {dataQuality.calibrationRoles.length ? (
              <div className={styles.calibrationRoles}>
                {dataQuality.calibrationRoles.map((role) => (
                  <div key={role.role}>
                    <span>{role.role}</span>
                    <div><i style={{ width: `${role.progress}%` }} /></div>
                    <strong>{role.samples}<small> / {role.target}</small></strong>
                  </div>
                ))}
              </div>
            ) : <p className={styles.calibrationEmpty}>公共模型暂未连接。评分仍使用可追踪的 rules-2026.07 基线，不会因网络失败而改变算法。</p>}
            <dl className={styles.calibrationParameters}>
              <div><dt>高光阈值</dt><dd>{calibrationModel?.highlightThreshold ?? 88}</dd></div>
              <div><dt>副职业奖励</dt><dd>{Math.round((calibrationModel?.secondaryBonusWeight ?? 0.4) * 100)}%</dd></div>
              <div><dt>死亡惩罚系数</dt><dd>{(calibrationModel?.deathPenaltyScale ?? 1).toFixed(2)}</dd></div>
            </dl>
            <div className={styles.replayActions}>
              <div>
                <span>历史重放</span>
                <strong>{dataset.scoringSnapshot ? `已锁定 ${dataset.scoringSnapshot.modelVersion}` : `当前 ${calibrationModel?.version ?? "rules-2026.07"}`}</strong>
                <small>{dataset.scoringSnapshot ? `导入报告按 ${new Date(dataset.scoringSnapshot.scoredAt).toLocaleString("zh-CN")} 的模型重算` : "导出后会把本次评分模型一并保存，未来打开不会随新模型漂移"}</small>
              </div>
              <button className={styles.replayButton} type="button" onClick={exportReplayReport}>导出可重放报告</button>
            </div>
            <div className={styles.calibrationGovernance} aria-label="模型版本治理状态">
              <div>
                <span>当前通道</span>
                <strong data-tone={calibrationModel?.governance?.channel ?? "baseline"}>{calibrationModel?.governance ? calibrationChannelLabel[calibrationModel.governance.channel] : "固定基线"}</strong>
                <small>{calibrationModel?.governance?.candidateVersion ? `候选 ${calibrationModel.governance.candidateVersion}` : "当前没有待发布候选"}</small>
              </div>
              <div>
                <span>灰度范围</span>
                <strong>{calibrationModel?.governance?.rolloutPercentage ?? 0}%</strong>
                <small>{calibrationModel?.governance?.cohortBucket === null || calibrationModel?.governance?.cohortBucket === undefined ? "公共页面固定使用正式版本" : `本机匿名分桶 ${calibrationModel.governance.cohortBucket}`}</small>
              </div>
              <div>
                <span>异常隔离</span>
                <strong>{calibrationModel?.governance?.anomalyWindow.quarantined ?? "未启用"}</strong>
                <small>{calibrationModel?.governance ? `近 ${calibrationModel.governance.anomalyWindow.windowDays} 天隔离率 ${calibrationModel.governance.anomalyWindow.quarantineRate}%` : "服务端升级后开始统计"}</small>
              </div>
              <div>
                <span>回滚保护</span>
                <strong>{calibrationModel?.governance?.rollbackVersion ? "已回滚" : calibrationModel?.governance ? "已就绪" : "固定基线"}</strong>
                <small>{calibrationModel?.governance?.rollbackVersion ? `拦截 ${calibrationModel.governance.rollbackVersion}` : calibrationModel?.governance ? `质量分 ${calibrationModel.governance.qualityScore} · 最大漂移 ${Math.round(calibrationModel.governance.maxExpectedDrift * 100)}%` : "模型异常时不替换本地规则"}</small>
              </div>
            </div>
            <p className={styles.calibrationPrivacy}>职业少于 {calibrationModel?.minimumRoleSamples ?? 100} 局时仅显示收集进度，不改该职业基线。新版本先进入匿名灰度分桶，异常样本或参数漂移越界时回滚到最近稳定版本。</p>
          </div>
        </section>

        <section className={styles.analysisGrid}>
          <div className={styles.rolePanel}>
            <div className={styles.sectionHeading}>
              <div><span>职业雷达</span><h2>六类英雄表现</h2></div>
              <small>均分展示，最强职业按场次收缩</small>
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
              <small>本次至少 {heroMinimumGames} 局才进入常胜评估</small>
            </div>
            <div className={styles.heroVerdicts}>
              <div><span>常胜英雄</span><strong>{bestHero?.name ?? "样本不足"}</strong><small>{bestHero ? `${bestHero.games} 局 · ${bestHero.winRate}% 胜率` : "需要更多场次"}</small></div>
              <div><span>常败英雄</span><strong>{worstHero?.name ?? "样本不足"}</strong><small>{worstHero ? `${worstHero.games} 局 · ${worstHero.winRate}% 胜率` : "需要更多场次"}</small></div>
            </div>
            <table className={styles.heroTable}>
              <thead><tr><th>英雄</th><th>场次</th><th>胜场</th><th>胜率</th></tr></thead>
              <tbody>
                {displayedHeroes.map((hero) => (
                  <tr key={hero.name}><td>{hero.name}</td><td>{hero.games}</td><td>{hero.wins}</td><td>{hero.winRate}%</td></tr>
                ))}
              </tbody>
            </table>
            <p className={styles.rankCoverage}>已统计 {summary.heroes.length} 名英雄、{dataset.matches.length} 场海斗。表内前 10 名覆盖 {displayedHeroGames} 场，其余合计 {Math.max(0, dataset.matches.length - displayedHeroGames)} 场。</p>
          </div>
        </section>

        <section className={styles.highlightSection} aria-labelledby="highlights-title">
          <div className={styles.sectionHeading}>
            <div><span>关键样本</span><h2 id="highlights-title">数据高光局</h2></div>
            <small>单局得分 {calibrationModel?.highlightThreshold ?? 88} 以上</small>
          </div>
          {summary.highlights.length ? (
            <div className={styles.highlightRail}>
              {summary.highlights.map((item, index) => (
                <article key={item.match.id}>
                  <span>0{index + 1}</span>
                  <div><strong>{item.match.champion}</strong><small>{roleLabel(item.match)} · {item.match.kills}/{item.match.deaths}/{item.match.assists}</small></div>
                  <p>{[...item.dimensions].sort((a, b) => b.score - a.score)[0]?.label} {Math.max(...item.dimensions.map((dimension) => dimension.score))} 分</p>
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
            {displayedAugments.map((augment, index) => (
              <div key={augment.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{augment.name}</strong>
                <div className={styles.miniTrack}><span style={{ width: `${Math.round((augment.picks / topAugmentPicks) * 100)}%` }} /></div>
                <small>{augment.picks} 次</small>
              </div>
            ))}
            <p className={styles.rankCoverage}>共统计 {summary.augments.length} 种海克斯、{totalAugmentPicks} 次选择。前 12 项覆盖 {displayedAugmentPicks} 次。</p>
          </div>
        </section>

        <section className={styles.itemSection} aria-labelledby="items-title">
          <div className={styles.sectionHeading}>
            <div><span>装备偏好</span><h2 id="items-title">最爱出装</h2></div>
            <small>按出现对局数排序，重复购买另计件数</small>
          </div>
          {displayedItems.length ? (
            <div className={styles.itemRank}>
              {displayedItems.map((equipment, index) => (
                <div key={equipment.name}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{equipment.name}</strong>
                  <div className={styles.miniTrack}><span style={{ width: `${equipment.gameShare}%` }} /></div>
                  <small>{equipment.games} 局 · {equipment.gameShare}%</small>
                </div>
              ))}
              <p className={styles.rankCoverage}>基于 {dataset.matches.length} 场海斗的最终装备栏统计。消耗品和未完成的小件也会按客户端记录保留。</p>
            </div>
          ) : <p className={styles.emptyState}>当前导入数据没有装备字段。使用 V13 数据助手重新同步后即可生成出装偏好。</p>}
        </section>

        <section className={styles.matchesSection} aria-labelledby="matches-title">
          <div className={styles.matchesHeader}>
            <div className={styles.sectionHeading}>
              <div><span>比赛时间带</span><h2 id="matches-title">近期对局</h2></div>
              <small>主职业完整计分 + 副职业 {Math.round((calibrationModel?.secondaryBonusWeight ?? 0.4) * 100)}% 奖励，死亡规则仅计算一次</small>
            </div>
            <div className={styles.segmented} aria-label="筛选近期对局">
              {(["全部", "胜利", "失败"] as MatchFilter[]).map((option) => (
                <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>{option}</button>
              ))}
            </div>
          </div>
          <div className={styles.matchList}>
            {visibleMatches.map((item) => <MatchRow key={item.match.id} item={item} highlightThreshold={calibrationModel?.highlightThreshold ?? 88} />)}
          </div>
        </section>

        <aside className={styles.methodNote}>
          <span>评分说明</span>
          <p>当前评分优先读取版本化社区校准模型；职业不足 100 份真实匿名样本时继续使用固定基线。双职业保留主职业完整正向分，再按模型权重加入副职业奖励；死亡与“作弊：我能回城！”规则只应用一次。数据质量分仅解释字段覆盖，不参与操作评分。</p>
        </aside>
      </main>

      <footer className={styles.footer}>
        <span>海斗战报 MVP · 默认本机分析 · 真实样本仅在本人主动勾选后匿名贡献</span>
        <nav aria-label="页脚"><a href="./privacy/">隐私说明</a><a href="./terms/">使用边界</a></nav>
      </footer>
    </>
  );
}
