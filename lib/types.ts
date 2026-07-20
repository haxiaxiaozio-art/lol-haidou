export const ROLES = ["辅助", "法师", "刺客", "坦克", "射手", "战士"] as const;

export type Role = (typeof ROLES)[number];

export type MatchMetrics = {
  damage: number;
  controlSeconds: number;
  healing: number;
  shielding: number;
  mitigated: number;
  damageTaken: number;
  selfHealing: number;
  gold: number;
};

export type RecallRule = {
  pickedAtMinute: number;
  deathsBefore: number;
  deathsAfter: number;
};

export type MatchRecord = {
  id: string;
  playedAt: string;
  patch: string;
  champion: string;
  role: Role;
  win: boolean;
  durationMinutes: number;
  kills: number;
  deaths: number;
  assists: number;
  metrics: MatchMetrics;
  augments: string[];
  recall?: RecallRule;
};

export type PlayerDataset = {
  schemaVersion: 1;
  source: "demo" | "imported" | "local-client";
  player: {
    gameName: string;
    tag: string;
    region: string;
    updatedAt: string;
  };
  matches: MatchRecord[];
};

export type LocalClientPlayer = PlayerDataset["player"];

export type LocalClientSyncResult = {
  dataset: PlayerDataset;
  scannedCount: number;
  haidouCount: number;
};

export type DimensionScore = {
  label: string;
  score: number;
  displayValue: string;
};

export type ScoredMatch = {
  match: MatchRecord;
  score: number;
  positiveScore: number;
  survivalScore: number;
  recallApplied: boolean;
  dimensions: DimensionScore[];
};

export type PlayerSummary = {
  scoredMatches: ScoredMatch[];
  overallScore: number | null;
  confidence: number;
  wins: number;
  winRate: number;
  roleScores: Array<{ role: Role; score: number; games: number }>;
  heroes: Array<{ name: string; games: number; wins: number; winRate: number; smoothedWinRate: number }>;
  augments: Array<{ name: string; picks: number; share: number }>;
  highlights: ScoredMatch[];
};
