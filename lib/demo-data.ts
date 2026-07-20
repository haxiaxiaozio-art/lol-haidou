import type { MatchMetrics, MatchRecord, PlayerDataset, Role } from "./types";

type Seed = {
  champion: string;
  role: Role;
  secondaryRole?: Role;
  base: Omit<MatchMetrics, "gold"> & { gold: number };
  kills: number;
  deaths: number;
  assists: number;
  augments: string[];
  items: string[];
};

const seeds: Seed[] = [
  {
    champion: "萨勒芬妮",
    role: "辅助",
    secondaryRole: "法师",
    base: { damage: 27740, controlSeconds: 67, healing: 10820, shielding: 15840, mitigated: 9720, damageTaken: 21800, selfHealing: 1440, gold: 12860 },
    kills: 5,
    deaths: 4,
    assists: 31,
    augments: ["音浪叠叠", "急救用具", "黎明使者的决心"],
    items: ["月石再生器", "炽热香炉", "流水法杖", "明朗之靴", "救赎"],
  },
  {
    champion: "维克托",
    role: "法师",
    base: { damage: 38820, controlSeconds: 43, healing: 720, shielding: 3240, mitigated: 11400, damageTaken: 23900, selfHealing: 2100, gold: 15320 },
    kills: 12,
    deaths: 7,
    assists: 19,
    augments: ["珠光护手", "魔法飞弹", "会心防守"],
    items: ["卢登的伙伴", "影焰", "灭世者的死亡之帽", "法师之靴", "虚空之杖"],
  },
  {
    champion: "阿卡丽",
    role: "刺客",
    secondaryRole: "法师",
    base: { damage: 32540, controlSeconds: 9, healing: 0, shielding: 2780, mitigated: 8750, damageTaken: 25500, selfHealing: 4870, gold: 14940 },
    kills: 16,
    deaths: 8,
    assists: 11,
    augments: ["暗影疾奔", "终结者", "全凭身法"],
    items: ["海克斯科技火箭腰带", "影焰", "中娅沙漏", "法师之靴", "虚空之杖"],
  },
  {
    champion: "奥恩",
    role: "坦克",
    secondaryRole: "战士",
    base: { damage: 19870, controlSeconds: 78, healing: 0, shielding: 5960, mitigated: 39200, damageTaken: 54800, selfHealing: 5630, gold: 13210 },
    kills: 4,
    deaths: 7,
    assists: 27,
    augments: ["巨像勇气", "坦克引擎", "不动如山"],
    items: ["心之钢", "日炎圣盾", "荆棘之甲", "狂徒铠甲", "水银之靴"],
  },
  {
    champion: "金克丝",
    role: "射手",
    base: { damage: 44760, controlSeconds: 18, healing: 0, shielding: 1840, mitigated: 9630, damageTaken: 26400, selfHealing: 3150, gold: 16680 },
    kills: 18,
    deaths: 7,
    assists: 16,
    augments: ["连发炮台", "灵巧", "暴击大师"],
    items: ["海妖杀手", "无尽之刃", "卢安娜的飓风", "多米尼克领主的致意", "狂战士胫甲"],
  },
  {
    champion: "亚托克斯",
    role: "战士",
    secondaryRole: "坦克",
    base: { damage: 33780, controlSeconds: 32, healing: 0, shielding: 3280, mitigated: 24400, damageTaken: 39800, selfHealing: 11860, gold: 15110 },
    kills: 13,
    deaths: 8,
    assists: 17,
    augments: ["越战越勇", "吸血习性", "重拳出击"],
    items: ["星蚀", "焚天", "死亡之舞", "振奋盔甲", "铁板靴"],
  },
];

const factors = [1.08, 0.93, 1.17, 0.86, 1.02];
const winPattern = [true, false, true, true, false, true, false, true, true, false];

const scaleMetrics = (metrics: MatchMetrics, factor: number): MatchMetrics => ({
  damage: Math.round(metrics.damage * factor),
  controlSeconds: Math.round(metrics.controlSeconds * (0.92 + (factor - 0.9) * 0.55)),
  healing: Math.round(metrics.healing * (0.9 + factor * 0.12)),
  shielding: Math.round(metrics.shielding * (0.88 + factor * 0.15)),
  mitigated: Math.round(metrics.mitigated * (0.9 + factor * 0.12)),
  damageTaken: Math.round(metrics.damageTaken * (0.93 + factor * 0.08)),
  selfHealing: Math.round(metrics.selfHealing * (0.88 + factor * 0.14)),
  gold: Math.round(metrics.gold * (0.92 + factor * 0.08)),
});

const matches: MatchRecord[] = seeds.flatMap((seed, seedIndex) =>
  factors.map((factor, repeatIndex) => {
    const sequence = seedIndex * factors.length + repeatIndex;
    const playedAt = new Date(Date.UTC(2026, 6, 19, 14, 20) - sequence * 17 * 60 * 60 * 1000).toISOString();
    const win = winPattern[sequence % winPattern.length];
    const durationMinutes = Number((17.4 + ((sequence * 13) % 61) / 10).toFixed(1));
    const deaths = Math.max(2, seed.deaths + ((sequence % 4) - 2));
    const isPeak = seedIndex === 0 && repeatIndex === 2;
    return {
      id: `HD-26-${String(sequence + 1).padStart(4, "0")}`,
      playedAt,
      patch: sequence < 13 ? "26.14" : "26.13",
      champion: seed.champion,
      role: seed.role,
      secondaryRole: seed.secondaryRole,
      win,
      durationMinutes,
      kills: isPeak ? 9 : Math.max(1, Math.round(seed.kills * factor + (win ? 1 : -1))),
      deaths: isPeak ? 2 : deaths,
      assists: isPeak ? 42 : Math.max(3, Math.round(seed.assists * factor + (win ? 3 : -2))),
      metrics: isPeak
        ? { ...scaleMetrics(seed.base, 1.72), healing: 19420, shielding: 28760, controlSeconds: 92 }
        : scaleMetrics(seed.base, factor),
      augments: seed.augments.map((augment, index) =>
        index === 2 && repeatIndex % 2 === 1 ? "珍藏刷新" : augment,
      ),
      items: seed.items,
    };
  }),
);

matches.push({
  id: "HD-26-HIST-001",
  playedAt: "2026-05-29T13:42:00.000Z",
  patch: "26.10",
  champion: "奥恩",
  role: "坦克",
  secondaryRole: "战士",
  win: true,
  durationMinutes: 22.8,
  kills: 3,
  deaths: 6,
  assists: 32,
  metrics: { damage: 22410, controlSeconds: 94, healing: 0, shielding: 6840, mitigated: 48620, damageTaken: 61820, selfHealing: 7210, gold: 14640 },
  augments: ["坦克引擎", "作弊：我能回城！", "巨像勇气"],
  items: ["心之钢", "日炎圣盾", "荆棘之甲", "狂徒铠甲", "水银之靴"],
  recall: { pickedAtMinute: 8.6, deathsBefore: 4, deathsAfter: 2 },
});

export const DEMO_DATASET: PlayerDataset = {
  schemaVersion: 1,
  source: "demo",
  player: {
    gameName: "夜航船",
    tag: "0927",
    region: "艾欧尼亚",
    updatedAt: "2026-07-20T02:36:00.000Z",
  },
  matches,
};
