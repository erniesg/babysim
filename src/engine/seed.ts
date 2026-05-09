import type { BabyState, BabyTraits, BabyNeeds, BabyVisualState, PartnerState, PartnerTraits, OfficerState } from "@contracts/game-state";

// Uses mulberry32 because xorshift32 produces low-quality low bits on small seeds;
// we hash the string seed to a uint32 first via djb2 so the same string always
// maps to the same uint32 before the PRNG is initialized.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s += 0x6d2b79f5;
    s = s >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    z = (z ^ (z >>> 14)) >>> 0;
    return z / 0x100000000;
  };
}

export type Rng = {
  next(): number;
  pick<T>(arr: readonly T[]): T;
  range(min: number, max: number): number;
};

export function makeRng(seed: string): Rng {
  const next = mulberry32(djb2(seed));
  return {
    next,
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
  };
}

const BABY_SOOTHING = ["motion", "sound", "contact", "silence"] as const;
const BABY_STIMULATION = ["low", "medium", "high"] as const;
const BABY_FEEDING = ["frequent", "regular", "unpredictable"] as const;
const BABY_SLEEP = ["heavy", "light", "fights"] as const;
const BABY_TEMPERAMENT = ["sunny", "sensitive", "stubborn", "chaotic"] as const;

const PARTNER_ARCHETYPES = ["anxious", "chill", "resentful", "overfunctioner"] as const;
const PARTNER_CONFLICT_STYLES = ["defensive", "avoidant", "pleading", "scorekeeping"] as const;
const PARTNER_HELP_BIAS = ["helps_fast", "waits_to_be_asked", "shirks_when_tired"] as const;

const OFFICER_NAMES = ["Officer Tan", "Officer Lim", "Officer Wong"] as const;
const OFFICER_EXPRESSIONS = ["strict", "warm", "skeptical", "delighted"] as const;

const PARTNER_NAMES = [
  "Alex", "Jordan", "Morgan", "Riley", "Cameron", "Taylor",
  "Avery", "Quinn", "Drew", "Sage",
];

export type SeedRollResult = {
  baby: Omit<BabyState, "name">;
  partner: Omit<PartnerState, "resentment" | "fatigue" | "mood">;
  officer: OfficerState;
};

export function seedRoll(seed: string): SeedRollResult {
  const rng = makeRng(seed);

  const traits: BabyTraits = {
    soothing: rng.pick(BABY_SOOTHING),
    stimulation: rng.pick(BABY_STIMULATION),
    feeding: rng.pick(BABY_FEEDING),
    sleep: rng.pick(BABY_SLEEP),
    temperament: rng.pick(BABY_TEMPERAMENT),
  };

  const initialHunger = rng.range(10, 30);
  const initialSleepiness = rng.range(5, 20);
  const initialDiscomfort = rng.range(0, 15);
  const initialConnection = rng.range(60, 80);
  const initialHealth = 100;

  const needs: Omit<BabyNeeds, "mood"> = {
    hunger: initialHunger,
    sleepiness: initialSleepiness,
    discomfort: initialDiscomfort,
    connection: initialConnection,
    health: initialHealth,
  };

  const mood =
    100 -
    needs.hunger * 0.28 -
    needs.sleepiness * 0.22 -
    needs.discomfort * 0.24 -
    (100 - needs.connection) * 0.16 -
    (100 - needs.health) * 0.1;

  const baby: Omit<BabyState, "name"> = {
    gender: rng.pick(["girl", "boy"] as const),
    traits,
    needs: { ...needs, mood: Math.max(0, Math.min(100, mood)) },
    visualState: "settled" as BabyVisualState,
    isAsleep: false,
    discoveredTraits: [],
  };

  const partnerTraits: PartnerTraits = {
    archetype: rng.pick(PARTNER_ARCHETYPES),
    conflictStyle: rng.pick(PARTNER_CONFLICT_STYLES),
    helpBias: rng.pick(PARTNER_HELP_BIAS),
  };

  const partner: Omit<PartnerState, "resentment" | "fatigue" | "mood"> = {
    name: rng.pick(PARTNER_NAMES),
    traits: partnerTraits,
    isAsleep: false,
  };

  const officer: OfficerState = {
    name: rng.pick(OFFICER_NAMES),
    visible: false,
    expression: rng.pick(OFFICER_EXPRESSIONS),
  };

  return { baby, partner, officer };
}
