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
  secondaryRole?: Role;
  win: boolean;
  durationMinutes: number;
  kills: number;
  deaths: number;
  assists: number;
  metrics: MatchMetrics;
  augments: string[];
  items?: string[];
  recall?: RecallRule;
  dataQuality?: {
    metricsPresent: Array<keyof MatchMetrics>;
    roleSource: "champion-primary" | "position-fallback" | "provided" | "unknown";
    augmentsPresent: boolean;
    itemsPresent: boolean;
    recallTimeline: "exact" | "unavailable";
  };
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
  scoringSnapshot?: {
    modelVersion: string;
    scoredAt: string;
    model: CalibrationModel;
  };
};

export type LocalClientPlayer = PlayerDataset["player"];

export type SyncDiagnostic = {
  category: "client-login" | "region-unavailable" | "interface-timeout" | "permission-denied" | "field-missing";
  code: string;
  source: "helper" | "client" | "sgp" | "lcu" | "logs" | "model";
  severity: "warning" | "error";
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
};

export type NetworkRatingEstimate = {
  rating: number;
  low: number;
  high: number;
  confidence: number;
  games: number;
  wins: number;
  status: "calibrating" | "provisional" | "stable";
};

export type CalibrationModel = {
  version: string;
  patch?: string;
  generatedAt: string;
  status: "collecting" | "calibrating" | "stable";
  totalSamples: number;
  minimumRoleSamples: number;
  highlightThreshold: number;
  secondaryBonusWeight: number;
  deathPenaltyScale: number;
  roles: Array<{
    role: Role;
    samples: number;
    confidence: number;
    expected: number[];
  }>;
  governance?: {
    policyVersion: string;
    patch: string;
    activeVersion: string;
    candidateVersion: string | null;
    rollbackVersion: string | null;
    channel: "baseline" | "canary" | "stable" | "rollback";
    rolloutPercentage: number;
    cohortBucket: number | null;
    qualityScore: number;
    maxExpectedDrift: number;
    anomalyWindow: {
      accepted: number;
      quarantined: number;
      quarantineRate: number;
      windowDays: number;
    };
  };
};

export type LocalClientSyncResult = {
  dataset: PlayerDataset;
  scannedCount: number;
  haidouCount: number;
  historySources: Array<"sgp" | "lcu" | "logs">;
  sourceCounts: { sgp: number; lcu: number; logs: number };
  fallbackReasons: string[];
  diagnostics: SyncDiagnostic[];
  networkRating: NetworkRatingEstimate | null;
  networkRatingError: string;
  calibrationModel: CalibrationModel | null;
  calibrationAccepted: number;
  calibrationQuarantined: number;
  calibrationError: string;
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
  roleComponents: Array<{
    role: Role;
    kind: "primary" | "secondary";
    weight: number;
    score: number;
    contribution: number;
  }>;
};

export type PlayerSummary = {
  scoredMatches: ScoredMatch[];
  overallScore: number | null;
  confidence: number;
  wins: number;
  winRate: number;
  roleScores: Array<{ role: Role; score: number; reliableScore: number; games: number }>;
  heroes: Array<{ name: string; games: number; wins: number; winRate: number; smoothedWinRate: number }>;
  augments: Array<{ name: string; picks: number; share: number }>;
  favoriteItems: Array<{ name: string; picks: number; games: number; gameShare: number }>;
  highlights: ScoredMatch[];
};
