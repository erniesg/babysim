import type { GameAction } from "./actions";

export type Phase =
  | "home"
  | "intake"
  | "generation"
  | "reveal"
  | "gameplay"
  | "night"
  | "argument"
  | "cute"
  | "verdict"
  | "debrief";

export type Gender = "girl" | "boy";

export type BabyTraits = {
  soothing: "motion" | "sound" | "contact" | "silence";
  stimulation: "low" | "medium" | "high";
  feeding: "frequent" | "regular" | "unpredictable";
  sleep: "heavy" | "light" | "fights";
  temperament: "sunny" | "sensitive" | "stubborn" | "chaotic";
};

export type BabyNeeds = {
  hunger: number;
  sleepiness: number;
  discomfort: number;
  connection: number;
  health: number;
  mood: number;
};

export type BabyVisualState =
  | "settled"
  | "drowsy"
  | "hungry"
  | "fussy"
  | "crying"
  | "sleep";

export type CryTrigger =
  | "hunger"
  | "sleepiness"
  | "discomfort"
  | "lonely"
  | "health"
  | "overstimulated";

export type BabyState = {
  name: string;
  gender: Gender;
  traits: BabyTraits;
  needs: BabyNeeds;
  visualState: BabyVisualState;
  isAsleep: boolean;
  activeCry?: {
    trigger: CryTrigger;
    intensity: number;
    startedAtHour: number;
  };
  discoveredTraits: string[];
};

export type PartnerTraits = {
  archetype: "anxious" | "chill" | "resentful" | "overfunctioner";
  conflictStyle: "defensive" | "avoidant" | "pleading" | "scorekeeping";
  helpBias: "helps_fast" | "waits_to_be_asked" | "shirks_when_tired";
};

export type PartnerState = {
  name: string;
  traits: PartnerTraits;
  mood: number;
  fatigue: number;
  resentment: number;
  isAsleep: boolean;
  currentLine?: string;
};

export type OfficerState = {
  name: "Officer Ernest" | "Officer Bern" | "Officer Crumb";
  visible: boolean;
  expression: "strict" | "warm" | "skeptical" | "delighted";
  currentLine?: string;
};

export type ComfortFlags = {
  diaperWet: boolean;
  tooHot: boolean;
  tooCold: boolean;
  awkwardPosition: boolean;
};

export type FairnessLedger = {
  playerNightShifts: number;
  partnerNightShifts: number;
  playerShirks: number;
  partnerShirks: number;
  playerSoothes: number;
  partnerSoothes: number;
};

export type GameSettings = {
  realSecondsPerGameHour: number;
};

export type GameEvent = {
  id: string;
  at: number;
  actor: "player" | "partner" | "baby" | "gm" | "officer" | "system";
  type:
    | "ACTION"
    | "VOICE_FEATURES"
    | "BEAT_ENTERED"
    | "BEAT_RESOLVED"
    | "AUDIO_STARTED"
    | "AUDIO_STOPPED"
    | "STATE_CHANGED"
    | "PANIC"
    | "SKIP_TO"
    // Agent-consultative events: LLM tool calls that the reducer applies
    // as clamped deltas. Engine remains authoritative.
    | "AGENT_VISUAL_STATE"
    | "AGENT_NEED_DELTA";
  action?: GameAction;
  payload?: Record<string, unknown>;
};

export type GameState = {
  sessionId: string;
  seed: string;
  phase: Phase;
  beatId: string;
  currentHour: number;
  settings: GameSettings;
  baby: BabyState;
  partner: PartnerState;
  officer: OfficerState;
  comfort: ComfortFlags;
  ledger: FairnessLedger;
  eventLog: GameEvent[];
};

// Mood is derived from pressure meters where 0 = fine and 100 = urgent:
// 100 - hunger*.28 - sleepiness*.22 - discomfort*.24 - (100-connection)*.16 - (100-health)*.10
export function deriveMood(needs: Omit<BabyNeeds, "mood">): number {
  return clamp(
    100 -
      needs.hunger * 0.28 -
      needs.sleepiness * 0.22 -
      needs.discomfort * 0.24 -
      (100 - needs.connection) * 0.16 -
      (100 - needs.health) * 0.1,
  );
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

