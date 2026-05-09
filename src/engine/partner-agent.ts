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
    baby_arrival: {
      default: "She's here. She's actually here. I'm trying not to overthink this.",
    },
    first_calm: {
      default: "Don't jinx it. Don't say anything. Just breathe.",
    },
    first_cry: {
      default: "Okay - okay, what does that cry mean? Hungry? Tired? I don't know yet.",
      tired: "I haven't slept and now I can't think straight.",
    },
    discovery_soothing: {
      default: "Try something. Anything. We'll learn what works.",
    },
    time_jump_evening: {
      default: "Did the day just disappear?",
    },
    night_cry: {
      default: "(asleep — breathing fast)",
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
    cute_payoff: {
      default: "Did you see that? She SMILED. That was real.",
    },
    verdict: {
      default: "Don't say anything weird. Don't say anything weird.",
    },
  },

  chill: {
    officer_intro: {
      default: "Yeah, okay. We've got this.",
      high_resentment: "Sure.",
    },
    baby_arrival: {
      default: "Hey, kiddo. We're gonna figure each other out.",
    },
    first_calm: {
      default: "Quiet's nice while it lasts.",
    },
    first_cry: {
      default: "Okay, here we go.",
      tired: "Yeah, yeah, I hear it.",
    },
    discovery_soothing: {
      default: "Just try something. Babies aren't precious crystal.",
    },
    time_jump_evening: {
      default: "Was that today? Time is fake.",
    },
    night_cry: {
      default: "(asleep — out cold)",
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
    cute_payoff: {
      default: "Yeah. Yeah, that one was for us.",
    },
    verdict: {
      default: "Whatever they say, we did fine.",
    },
  },

  resentful: {
    officer_intro: {
      default: "I keep a spreadsheet. Hours logged, feeds done, wakeups taken. I'm not ashamed.",
      high_resentment: "Someone has to track it. It won't be acknowledged otherwise.",
    },
    baby_arrival: {
      default: "I read every book. You read the back covers. Just so we're clear who's prepared.",
    },
    first_calm: {
      default: "Enjoy this. You'll be sleeping through the next eight cries.",
    },
    first_cry: {
      default: "Are you going to handle it, or am I?",
      shirked: "Of course it's already on me.",
    },
    discovery_soothing: {
      default: "Try the obvious one first. Don't experiment for fun.",
    },
    time_jump_evening: {
      default: "I logged six feeds. You logged two.",
    },
    night_cry: {
      default: "(asleep — but tracking shifts in their head)",
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
    cute_payoff: {
      default: "...okay. That was nice. Don't ruin it.",
    },
    verdict: {
      default: "If they don't see what I'm doing here I'm submitting an appeal.",
    },
  },

  overfunctioner: {
    officer_intro: {
      default: "I've already researched four soothing methods, hired a postpartum doula, and batch-cooked six weeks of meals.",
      tired: "I'm fine. Honestly, I'm fine. I just need everyone else to be okay.",
    },
    baby_arrival: {
      default: "I have the bottles labeled, the swaddles laid out, and the pediatrician on speed dial.",
    },
    first_calm: {
      default: "Should I prep the next feed? I should prep the next feed.",
    },
    first_cry: {
      default: "I've got it. You don't have to do anything. I'll handle it.",
    },
    discovery_soothing: {
      default: "Want me to take over? I can take over.",
    },
    time_jump_evening: {
      default: "I made dinner. And lunch. And tomorrow's breakfast.",
    },
    night_cry: {
      default: "(asleep — finally — but only because they crashed)",
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
    cute_payoff: {
      default: "I knew tummy time would help. I knew it.",
    },
    verdict: {
      default: "I prepared a binder. Three sections. Color-coded.",
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
