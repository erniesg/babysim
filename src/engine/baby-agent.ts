import type { BabyState, BabyNeeds, BabyVisualState, BabyTraits, CryTrigger } from "@contracts/game-state";
import type { ComfortFlags } from "@contracts/game-state";
import type { GameAction } from "@contracts/actions";
import { clamp } from "@contracts/game-state";

export type BabyDelta = Partial<Omit<BabyNeeds, "mood">>;

export type ActionEffectiveness = "helps" | "neutral" | "worsens";

export type ActionResponse = {
  needsDelta: BabyDelta;
  comfortDelta: Partial<ComfortFlags>;
  discoveredTraitHint?: string;
  effectiveness: ActionEffectiveness;
};

// Hunger rises at different rates by feeding trait.
const HUNGER_RATE: Record<BabyTraits["feeding"], number> = {
  frequent: 6,
  regular: 4,
  unpredictable: 5,
};

// Sleepiness rises while awake.
const SLEEPINESS_RATE: Record<BabyTraits["sleep"], number> = {
  heavy: 3,
  light: 5,
  fights: 4,
};

// Low-stimulation babies accumulate discomfort faster in noisy environments
// (captured here as a base discomfort tick multiplier).
const DISCOMFORT_RATE: Record<BabyTraits["stimulation"], number> = {
  low: 2,
  medium: 1,
  high: 0.5,
};

// Connection decays slower for sunny babies, faster for chaotic ones.
const CONNECTION_DECAY: Record<BabyTraits["temperament"], number> = {
  sunny: 1,
  sensitive: 2,
  stubborn: 1.5,
  chaotic: 3,
};

export function tick(
  baby: BabyState,
  _comfort: ComfortFlags,
  hoursElapsed: number,
): BabyDelta {
  if (baby.isAsleep) {
    return {
      sleepiness: -SLEEPINESS_RATE[baby.traits.sleep] * hoursElapsed * 2,
      hunger: HUNGER_RATE[baby.traits.feeding] * hoursElapsed * 0.5,
      connection: -CONNECTION_DECAY[baby.traits.temperament] * hoursElapsed * 0.5,
    };
  }

  return {
    hunger: HUNGER_RATE[baby.traits.feeding] * hoursElapsed,
    sleepiness: SLEEPINESS_RATE[baby.traits.sleep] * hoursElapsed,
    discomfort: DISCOMFORT_RATE[baby.traits.stimulation] * hoursElapsed * 0.5,
    connection: -CONNECTION_DECAY[baby.traits.temperament] * hoursElapsed,
  };
}

const CRY_THRESHOLD = 60;

export function cryTrigger(baby: BabyState): CryTrigger | null {
  const { needs } = baby;

  // Highest-pressure unmet need above threshold wins.
  const candidates: Array<{ trigger: CryTrigger; pressure: number }> = [
    { trigger: "hunger", pressure: needs.hunger },
    { trigger: "sleepiness", pressure: needs.sleepiness },
    { trigger: "discomfort", pressure: needs.discomfort },
    { trigger: "lonely", pressure: clamp(100 - needs.connection) },
    { trigger: "health", pressure: clamp(100 - needs.health) },
  ];

  // Overstimulated: high stimulation + low-stim baby (discomfort proxy)
  if (baby.traits.stimulation === "low" && needs.discomfort > 40) {
    candidates.push({ trigger: "overstimulated", pressure: needs.discomfort + 20 });
  }

  let dominant: { trigger: CryTrigger; pressure: number } | null = null;
  for (const c of candidates) {
    if (c.pressure >= CRY_THRESHOLD) {
      if (!dominant || c.pressure > dominant.pressure) {
        dominant = c;
      }
    }
  }

  return dominant ? dominant.trigger : null;
}

// Maps soothing actions to which soothing trait they serve.
const SOOTHING_ACTION_MAP: Partial<Record<GameAction, BabyTraits["soothing"]>> = {
  rock: "motion",
  sing: "sound",
  hold: "contact",
  shush: "silence",
};

export function actionResponse(
  action: GameAction,
  baby: BabyState,
  _comfort: ComfortFlags,
): ActionResponse {
  const { traits } = baby;

  switch (action) {
    case "feed": {
      const effective = baby.needs.hunger > 20;
      return {
        needsDelta: effective ? { hunger: -30, connection: 8 } : { hunger: -10, connection: 3 },
        comfortDelta: {},
        effectiveness: effective ? "helps" : "neutral",
        discoveredTraitHint: traits.feeding === "frequent" ? "frequent-feeder" : undefined,
      };
    }

    case "rock": {
      const preferred = traits.soothing === "motion";
      const worsens = traits.soothing === "silence";
      return {
        needsDelta: preferred
          ? { discomfort: -15, sleepiness: 5, connection: 8 }
          : worsens
          ? { discomfort: 5, connection: -3 }
          : { discomfort: -5, connection: 3 },
        comfortDelta: {},
        effectiveness: preferred ? "helps" : worsens ? "worsens" : "neutral",
        discoveredTraitHint: preferred ? "motion-soothed" : worsens ? "not-motion-soothed" : undefined,
      };
    }

    case "sing": {
      const preferred = traits.soothing === "sound";
      const worsens = traits.soothing === "silence" || traits.stimulation === "low";
      return {
        needsDelta: preferred
          ? { discomfort: -12, connection: 15, sleepiness: 3 }
          : worsens
          ? { discomfort: 8, connection: -2 }
          : { discomfort: -3, connection: 8 },
        comfortDelta: {},
        effectiveness: preferred ? "helps" : worsens ? "worsens" : "neutral",
        discoveredTraitHint: preferred ? "sound-soothed" : worsens ? "not-sound-soothed" : undefined,
      };
    }

    case "shush": {
      const preferred = traits.soothing === "silence";
      const worsens = traits.soothing === "sound";
      return {
        needsDelta: preferred
          ? { discomfort: -14, sleepiness: 6 }
          : worsens
          ? { discomfort: 5, connection: -2 }
          : { discomfort: -4, connection: 2 },
        comfortDelta: {},
        effectiveness: preferred ? "helps" : worsens ? "worsens" : "neutral",
        discoveredTraitHint: preferred ? "silence-soothed" : undefined,
      };
    }

    case "hold": {
      const preferred = traits.soothing === "contact";
      return {
        needsDelta: preferred
          ? { connection: 20, discomfort: -10 }
          : { connection: 12, discomfort: -4 },
        comfortDelta: {},
        effectiveness: preferred ? "helps" : "neutral",
        discoveredTraitHint: preferred ? "contact-soothed" : undefined,
      };
    }

    case "check_diaper": {
      return {
        needsDelta: { discomfort: -10 },
        comfortDelta: { diaperWet: false },
        effectiveness: "helps",
      };
    }

    case "adjust_temperature": {
      return {
        needsDelta: { discomfort: -10 },
        comfortDelta: { tooHot: false, tooCold: false },
        effectiveness: "helps",
      };
    }

    case "reposition": {
      return {
        needsDelta: { discomfort: -8 },
        comfortDelta: { awkwardPosition: false },
        effectiveness: "helps",
      };
    }

    case "wait": {
      // Works briefly for silence babies but worsens connection and hunger over time.
      const helps = traits.soothing === "silence" && baby.needs.discomfort < 40;
      return {
        needsDelta: helps
          ? { discomfort: -5, connection: -2, hunger: 2 }
          : { connection: -5, hunger: 3 },
        comfortDelta: {},
        effectiveness: helps ? "neutral" : "worsens",
      };
    }

    default: {
      const soothingTarget = SOOTHING_ACTION_MAP[action];
      const effective = soothingTarget != null && traits.soothing === soothingTarget;
      return {
        needsDelta: effective ? { discomfort: -5, connection: 5 } : {},
        comfortDelta: {},
        effectiveness: "neutral",
      };
    }
  }
}

const VISUAL_THRESHOLDS = {
  crying: 70,
  fussy: 50,
  hungry: 45,
  drowsy: 40,
};

export function visualState(baby: BabyState): BabyVisualState {
  if (baby.isAsleep) return "sleep";

  const { needs } = baby;

  const topPressure = Math.max(
    needs.hunger,
    needs.sleepiness,
    needs.discomfort,
    100 - needs.connection,
  );

  if (topPressure >= VISUAL_THRESHOLDS.crying) return "crying";
  if (topPressure >= VISUAL_THRESHOLDS.fussy) return "fussy";

  if (needs.sleepiness >= VISUAL_THRESHOLDS.drowsy) return "drowsy";
  if (needs.hunger >= VISUAL_THRESHOLDS.hungry) return "hungry";

  return "settled";
}
