const hashSeed = (value) => [...value].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
const pick = (options, seed) => options[seed % options.length];

export function buildMatchCommentary(item) {
  const { match } = item;
  const seed = hashSeed(match.id);
  const sortedDimensions = [...item.dimensions].sort((left, right) => right.score - left.score);
  const strongest = sortedDimensions[0];
  const weakest = sortedDimensions.at(-1);
  const participation = match.kills + match.assists;

  let verdict;
  if (item.score >= 92) {
    verdict = pick([
      `这局不是“尽力”，是把 ${strongest?.label ?? "本职工作"} 写进了对面五个人的复盘作业。`,
      "对面点开战绩大概只想问一句：这人为什么和我们排在同一局？",
      "峡谷广播没给你发五杀音效，但评分系统已经先按下了点赞。",
    ], seed);
  } else if (item.score >= 80) {
    verdict = pick([
      `有东西，${strongest?.label ?? "核心表现"}够硬。离名场面只差少送一次免费的灰屏回城。`,
      "这局属于队友敢点“再来一把”，对手只想点“举报匹配系统”。",
      "操作已经有高分段味道，偶尔那一下上头还带着大乱斗祖传配方。",
    ], seed);
  } else if (item.score >= 65) {
    verdict = match.win
      ? "基地是推掉了，但你的复盘不能跟着胜利画面一起点跳过。"
      : "不是纯战犯，也还没到“队友四带一”的感人纪录片水平。";
  } else if (item.score >= 50) {
    verdict = pick([
      "经济吃得像主角，镜头一切团战，突然变成了路过的河道蟹。",
      "这局最大的控制效果，是让队友的血压稳定不下来。",
      "别急着怪阵容，先看看自己的灰屏时间是不是快赶上技能冷却了。",
    ], seed);
  } else {
    verdict = pick([
      "团战不是排队领盒饭，你不用每波都第一个刷脸打卡。",
      "五杀还没等到，死亡计数倒是先超神了。泉水老板都快给你办年卡。",
      "这把建议别删录像，反面教材也需要高清素材。",
    ], seed);
  }

  let improvement;
  if (item.recallApplied && match.recall && match.recall.deathsAfter >= 3) {
    improvement = `改进：选了回城海克斯后，死亡不再是免费传送。你在选择后死了 ${match.recall.deathsAfter} 次，下一局先把回城窗口留在团战间隙。`;
  } else if (item.survivalScore < 42 || match.deaths >= 10) {
    improvement = `改进：本局 ${match.deaths} 次死亡已经吃掉太多有效时间。别把闪现留给下一把，先保住第一轮技能后的站位。`;
  } else if (weakest && weakest.score < 48) {
    improvement = `改进：最该补的是“${weakest.label}”，当前只有 ${weakest.score} 分。下一局把目标定成先完成本职指标，再追残血和节目效果。`;
  } else if (match.role === "辅助" && match.assists < 18) {
    improvement = "改进：辅助不是站在队友后面当观众。把控制和保护交在队友输出窗口里，助攻自然不会靠缘分刷新。";
  } else if ((match.role === "射手" || match.role === "法师") && item.dimensions.some((dimension) => dimension.label.includes("伤害") && dimension.score < 60)) {
    improvement = "改进：装备栏看着像 C 位，伤害不能只停留在加载界面。先处理能安全打到的人，活着把第二轮技能交完。";
  } else if (match.role === "刺客" && match.kills < 10) {
    improvement = "改进：刺客不是开团按钮。等关键控制交完再切后排，目标是带走人，不是进去给对面叠征服者。";
  } else {
    improvement = `改进：继续保持“${strongest?.label ?? "核心表现"}”，同时把无收益追击收一收。大乱斗没有兵线运营，照样有站位运营。`;
  }

  return { verdict, improvement, participation };
}
