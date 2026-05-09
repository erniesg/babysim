import type { PartnerState, FairnessLedger } from "@contracts/game-state";
import type { BeatId } from "@contracts/beats";
import type { GameEvent } from "@contracts/game-state";

export type PartnerDelta = {
  moodDelta?: number;
  fatigueDelta?: number;
  resentmentDelta?: number;
};

// Scripted lines indexed by archetype × beat × ledger-condition.
// Format: archetype -> beat -> condition key -> line.
// Conditions are evaluated in order; first matching key wins.
// Condition keys: "high_resentment" (resentment>50), "tired" (fatigue>60),
//                 "shirked" (ledger.playerShirks>0), "default".

type ConditionKey = "high_resentment" | "tired" | "shirked" | "default";
type BeatLines = Partial<Record<ConditionKey, string>>;
type ArchetypeLines = Partial<Record<BeatId, BeatLines>>;

const SCRIPTED_LINES: Record<PartnerState["traits"]["archetype"], ArchetypeLines> = {
  anxious: {
    officer_intro: {
      default: "Oh god, they're really watching us. I read all the books but... what if it's not enough?",
      high_resentment: "Are you even worried? I've been losing sleep over this for weeks.",
    },
    argument_start: {
      shirked: "You just... didn't get up? The baby was crying for twenty minutes.",
      tired: "I can't keep doing this alone. I'm exhausted. I'm actually shaking.",
      default: "I just need to know we're doing this together. Please.",
    },
    argument_resolution: {
      high_resentment: "Fine. I'll take it. But we need to talk about this tomorrow. We really do.",
      default: "Okay. Okay, I've got it. Just - rest. We'll figure this out.",
    },
    night_soothe: {
      default: "I've got them. Try to sleep.",
    },
    shirk_or_wake: {
      default: "Were you going to get up? I wasn't sure if you heard.",
    },
  },

  chill: {
    officer_intro: {
      default: "Yeah, okay. We've got this.",
      high_resentment: "Sure.",
    },
    argument_start: {
      shirked: "So you didn't go. Okay. That's... okay. It's not okay, actually.",
      tired: "I'm just really tired.",
      default: "We probably should have talked about this earlier.",
    },
    argument_resolution: {
      high_resentment: "I'll take the shift. It's fine.",
      default: "I'll handle it. Go back to sleep.",
    },
    night_soothe: {
      default: "Sleep. I'm up.",
    },
    shirk_or_wake: {
      tired: "Mm.",
      default: "You need help?",
    },
  },

  resentful: {
    officer_intro: {
      default: "I keep a spreadsheet. Hours logged, feeds done, wakeups taken. I'm not ashamed.",
      high_resentment: "Someone has to track it. It won't be acknowledged otherwise.",
    },
    argument_start: {
      shirked: "That's three times this week you've let me handle it. Three. I wrote it down.",
      tired: "You know what keeps me up? Not the baby. Wondering when you'll pull your weight.",
      default: "I need this to be equal. That's not unreasonable.",
    },
    argument_resolution: {
      high_resentment: "Don't thank me. Just do your share tomorrow.",
      shirked: "I'll take it. But this goes in the tally.",
      default: "Fine. I've got it. You owe me one and you know it.",
    },
    night_soothe: {
      default: "I'm up. Again.",
    },
    shirk_or_wake: {
      shirked: "Really? You're not going?",
      default: "I clocked the last two shifts.",
    },
  },

  overfunctioner: {
    officer_intro: {
      default: "I've already researched four soothing methods, hired a postpartum doula, and batch-cooked six weeks of meals.",
      tired: "I'm fine. Honestly, I'm fine. I just need everyone else to be okay.",
    },
    argument_start: {
      shirked: "I was going to do it. I always end up doing it. That's the problem.",
      tired: "I'm running on nothing. I keep giving and giving and I just - I need you to show up.",
      default: "I don't want to be the one who does everything. I want a partner.",
    },
    argument_resolution: {
      high_resentment: "I'll take this one too. But please. Next time, just go.",
      default: "I've got this. I always do. But I need you to try.",
    },
    night_soothe: {
      default: "I've got them. You rest. You need to be functional tomorrow.",
    },
    shirk_or_wake: {
      tired: "Do you want me to take it? I can take it.",
      default: "I can handle it if you need me to.",
    },
  },
};

function matchCondition(
  beatLines: BeatLines,
  partner: PartnerState,
  ledger: FairnessLedger,
): string | undefined {
  if (partner.resentment > 50 && beatLines.high_resentment) {
    return beatLines.high_resentment;
  }
  if (partner.fatigue > 60 && beatLines.tired) {
    return beatLines.tired;
  }
  if (ledger.playerShirks > 0 && beatLines.shirked) {
    return beatLines.shirked;
  }
  return beatLines.default;
}

export function lineFor(
  beat: BeatId,
  partner: PartnerState,
  ledger: FairnessLedger,
): string {
  const archetypeLines = SCRIPTED_LINES[partner.traits.archetype];
  const beatLines = archetypeLines[beat];

  if (!beatLines) {
    // Deterministic fallback so there is always a line.
    return partner.traits.archetype === "anxious"
      ? "I'm here. We'll manage."
      : partner.traits.archetype === "chill"
      ? "We've got this."
      : partner.traits.archetype === "resentful"
      ? "Someone has to show up."
      : "I'll handle it.";
  }

  return matchCondition(beatLines, partner, ledger) ?? beatLines.default ?? "...";
}

// Which events increase partner fatigue/resentment.
const FATIGUE_EVENTS: Partial<Record<GameEvent["type"], number>> = {
  ACTION: 0, // handled per-action below
  BEAT_ENTERED: 1,
  STATE_CHANGED: 2,
};

export function partnerReaction(
  event: GameEvent,
  partner: PartnerState,
  ledger: FairnessLedger,
): PartnerDelta {
  if (event.type === "ACTION" && event.action != null) {
    switch (event.action) {
      case "shirk":
        return {
          resentmentDelta: 12,
          fatigueDelta: 3,
          moodDelta: -8,
        };

      case "wake_partner":
        return {
          fatigueDelta: 8,
          moodDelta: partner.resentment > 40 ? -10 : -4,
          resentmentDelta: partner.fatigue > 60 ? 10 : 5,
        };

      case "comfort_partner":
        return {
          moodDelta: 10,
          resentmentDelta: -8,
        };

      case "get_up": {
        // Player taking the shift is good for the relationship.
        const bonus = ledger.playerShirks > ledger.partnerShirks ? 5 : 3;
        return {
          moodDelta: bonus,
          resentmentDelta: -3,
        };
      }

      case "feed":
      case "rock":
      case "sing":
      case "hold": {
        // Visible caregiving reduces partner resentment slightly.
        return {
          moodDelta: 2,
          resentmentDelta: -1,
        };
      }

      default:
        return {};
    }
  }

  if (event.type === "STATE_CHANGED") {
    const hoursDelta = (event.payload?.hoursDelta as number | undefined) ?? 0;
    if (hoursDelta > 0) {
      // Time passing accumulates fatigue for everyone.
      return {
        fatigueDelta: hoursDelta * 2,
        moodDelta: -hoursDelta,
      };
    }
  }

  void FATIGUE_EVENTS;
  return {};
}
