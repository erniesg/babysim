import type { GameState, GameEvent, BabyNeeds, FairnessLedger, BabyTraits } from "@contracts/game-state";
import { BEAT_GRAPH } from "@contracts/beats";
import { clamp, deriveMood } from "@contracts/game-state";

function applyNeedsDelta(
  needs: BabyNeeds,
  delta: Partial<Omit<BabyNeeds, "mood">>,
): BabyNeeds {
  const next: Omit<BabyNeeds, "mood"> = {
    hunger: clamp(needs.hunger + (delta.hunger ?? 0)),
    sleepiness: clamp(needs.sleepiness + (delta.sleepiness ?? 0)),
    discomfort: clamp(needs.discomfort + (delta.discomfort ?? 0)),
    connection: clamp(needs.connection + (delta.connection ?? 0)),
    health: clamp(needs.health + (delta.health ?? 0)),
  };
  return { ...next, mood: deriveMood(next) };
}

// Trait modulation: the rolled `soothing` style determines which actions
// soothe vs irritate. Player has to discover this through trial.
//
// match  → multiplier on the action's discomfort/connection deltas.
// miss   → mild penalty so wrong action is visible (jumpier baby).
const SOOTHING_AFFINITY: Record<BabyTraits["soothing"], Record<string, number>> = {
  motion:   { rock: 1.8, hold: 1.4, shush: 0.8, sing: 0.7, feed: 1.0, check_diaper: 1.0 },
  sound:    { sing: 1.8, shush: 1.4, rock: 0.8, hold: 0.9, feed: 1.0, check_diaper: 1.0 },
  contact:  { hold: 1.8, rock: 1.3, sing: 0.9, shush: 0.7, feed: 1.1, check_diaper: 1.0 },
  silence:  { shush: 1.8, hold: 1.1, sing: 0.5, rock: 0.7, feed: 1.0, check_diaper: 1.0 },
};

function affinityFor(action: string, traits: BabyTraits): number {
  const tab = SOOTHING_AFFINITY[traits.soothing];
  return tab?.[action] ?? 1.0;
}

// Track which actions have produced a strong response so the debrief card
// can show what the player figured out about the baby.
function rememberTrait(
  discovered: string[],
  action: string,
  traits: BabyTraits,
): string[] {
  const aff = affinityFor(action, traits);
  if (aff <= 1.2) return discovered;
  const tag = `soothing:${traits.soothing}`;
  if (discovered.includes(tag)) return discovered;
  return [...discovered, tag];
}

function modulate(
  delta: Partial<Omit<BabyNeeds, "mood">>,
  action: string,
  traits: BabyTraits,
): Partial<Omit<BabyNeeds, "mood">> {
  const aff = affinityFor(action, traits);
  if (aff === 1.0) return delta;
  return {
    hunger: delta.hunger != null && delta.hunger < 0 ? delta.hunger * aff : delta.hunger,
    sleepiness: delta.sleepiness,
    discomfort: delta.discomfort != null && delta.discomfort < 0 ? delta.discomfort * aff : delta.discomfort,
    connection: delta.connection != null && delta.connection > 0 ? delta.connection * aff : delta.connection,
    health: delta.health,
  };
}

function applyLedgerDelta(
  ledger: FairnessLedger,
  delta: Partial<FairnessLedger>,
): FairnessLedger {
  return {
    playerNightShifts: ledger.playerNightShifts + (delta.playerNightShifts ?? 0),
    partnerNightShifts: ledger.partnerNightShifts + (delta.partnerNightShifts ?? 0),
    playerShirks: ledger.playerShirks + (delta.playerShirks ?? 0),
    partnerShirks: ledger.partnerShirks + (delta.partnerShirks ?? 0),
    playerSoothes: ledger.playerSoothes + (delta.playerSoothes ?? 0),
    partnerSoothes: ledger.partnerSoothes + (delta.partnerSoothes ?? 0),
  };
}

export function reducer(state: GameState, event: GameEvent): GameState {
  const appendedLog = [...state.eventLog, event];

  if (event.type === "ACTION" && event.action != null) {
    const beat = BEAT_GRAPH[state.beatId as keyof typeof BEAT_GRAPH];

    // Panic and skip_to bypass beat-level gating — they are system-level.
    if (event.action !== "panic" && event.action !== "skip_to") {
      if (!beat || !beat.allowedActions.includes(event.action)) {
        // Rejected: action not allowed in this beat. Return state unchanged.
        return { ...state, eventLog: appendedLog };
      }
    }

    switch (event.action) {
      case "shirk": {
        return {
          ...state,
          ledger: applyLedgerDelta(state.ledger, { playerShirks: 1 }),
          partner: {
            ...state.partner,
            resentment: clamp(state.partner.resentment + 15),
            fatigue: clamp(state.partner.fatigue + 5),
          },
          eventLog: appendedLog,
        };
      }

      case "get_up": {
        return {
          ...state,
          ledger: applyLedgerDelta(state.ledger, { playerNightShifts: 1 }),
          eventLog: appendedLog,
        };
      }

      case "wake_partner": {
        return {
          ...state,
          partner: {
            ...state.partner,
            isAsleep: false,
            fatigue: clamp(state.partner.fatigue + 10),
            resentment: clamp(state.partner.resentment + 8),
          },
          eventLog: appendedLog,
        };
      }

      case "comfort_partner": {
        return {
          ...state,
          partner: {
            ...state.partner,
            resentment: clamp(state.partner.resentment - 12),
            mood: clamp(state.partner.mood + 8),
          },
          eventLog: appendedLog,
        };
      }

      case "feed": {
        const nextNeeds = applyNeedsDelta(
          state.baby.needs,
          modulate({ hunger: -25, connection: 5 }, "feed", state.baby.traits),
        );
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds, discoveredTraits: rememberTrait(state.baby.discoveredTraits, "feed", state.baby.traits) },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "rock": {
        const nextNeeds = applyNeedsDelta(
          state.baby.needs,
          modulate({ discomfort: -8, connection: 6, sleepiness: 3 }, "rock", state.baby.traits),
        );
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds, discoveredTraits: rememberTrait(state.baby.discoveredTraits, "rock", state.baby.traits) },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "sing": {
        const nextNeeds = applyNeedsDelta(
          state.baby.needs,
          modulate({ connection: 10, discomfort: -5 }, "sing", state.baby.traits),
        );
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds, discoveredTraits: rememberTrait(state.baby.discoveredTraits, "sing", state.baby.traits) },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "shush": {
        const nextNeeds = applyNeedsDelta(
          state.baby.needs,
          modulate({ discomfort: -6, connection: 3 }, "shush", state.baby.traits),
        );
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds, discoveredTraits: rememberTrait(state.baby.discoveredTraits, "shush", state.baby.traits) },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "hold": {
        const nextNeeds = applyNeedsDelta(
          state.baby.needs,
          modulate({ connection: 15, discomfort: -5 }, "hold", state.baby.traits),
        );
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds, discoveredTraits: rememberTrait(state.baby.discoveredTraits, "hold", state.baby.traits) },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "check_diaper": {
        return {
          ...state,
          comfort: { ...state.comfort, diaperWet: false },
          baby: {
            ...state.baby,
            needs: applyNeedsDelta(state.baby.needs, { discomfort: -10 }),
          },
          eventLog: appendedLog,
        };
      }

      case "adjust_temperature": {
        return {
          ...state,
          comfort: {
            ...state.comfort,
            tooHot: false,
            tooCold: false,
          },
          baby: {
            ...state.baby,
            needs: applyNeedsDelta(state.baby.needs, { discomfort: -10 }),
          },
          eventLog: appendedLog,
        };
      }

      case "reposition": {
        return {
          ...state,
          comfort: { ...state.comfort, awkwardPosition: false },
          baby: {
            ...state.baby,
            needs: applyNeedsDelta(state.baby.needs, { discomfort: -8 }),
          },
          eventLog: appendedLog,
        };
      }

      case "wait": {
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          hunger: 2,
          connection: -3,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
          eventLog: appendedLog,
        };
      }

      case "name_baby": {
        const name = (event.payload?.name as string) ?? state.baby.name;
        return {
          ...state,
          baby: { ...state.baby, name },
          eventLog: appendedLog,
        };
      }

      // These actions update ledger/state via BEAT_ENTERED or system events, not directly.
      case "start_game":
      case "create_room":
      case "join_room":
      case "answer_intake":
      case "upload_photo":
      case "skip_photo":
      case "panic":
      case "skip_to":
        return { ...state, eventLog: appendedLog };

      default:
        return { ...state, eventLog: appendedLog };
    }
  }

  if (event.type === "BEAT_ENTERED") {
    const beatId = event.payload?.beatId as string | undefined;
    if (beatId && beatId in BEAT_GRAPH) {
      const beat = BEAT_GRAPH[beatId as keyof typeof BEAT_GRAPH];
      return {
        ...state,
        beatId,
        phase: beat.phase,
        eventLog: appendedLog,
      };
    }
    return { ...state, eventLog: appendedLog };
  }

  // ── Agent-consultative events ──────────────────────────────────────────────
  // These originate from the Baby LLM agent (gpt-5.5 tool calls, routed
  // through Game.tsx → transport → runtime.dispatchAgentEvent → here).
  // They are ADVISORY: the reducer applies them but clamps all values so the
  // deterministic model remains authoritative.

  if (event.type === "AGENT_VISUAL_STATE") {
    const vs = event.payload?.visualState as import("@contracts/game-state").BabyVisualState | undefined;
    if (!vs) return { ...state, eventLog: appendedLog };
    return {
      ...state,
      baby: { ...state.baby, visualState: vs },
      eventLog: appendedLog,
    };
  }

  if (event.type === "AGENT_NEED_DELTA") {
    const need = event.payload?.need as keyof Omit<import("@contracts/game-state").BabyNeeds, "mood"> | "mood" | undefined;
    const delta = event.payload?.delta as number | undefined;
    if (!need || delta == null) return { ...state, eventLog: appendedLog };

    if (need === "mood") {
      // mood is derived — bump the raw needs proportionally so deriveMood stays consistent.
      // We apply a small connection bump as a proxy for mood improvement/decline.
      const connectionProxy = delta * 0.5;
      const next = applyNeedsDelta(state.baby.needs, { connection: connectionProxy });
      return {
        ...state,
        baby: { ...state.baby, needs: next },
        eventLog: appendedLog,
      };
    }

    const validNeeds = ["hunger", "sleepiness", "discomfort", "connection", "health"] as const;
    if (!validNeeds.includes(need as (typeof validNeeds)[number])) {
      return { ...state, eventLog: appendedLog };
    }
    const next = applyNeedsDelta(state.baby.needs, {
      [need]: delta,
    } as Partial<Omit<import("@contracts/game-state").BabyNeeds, "mood">>);
    return {
      ...state,
      baby: { ...state.baby, needs: next },
      eventLog: appendedLog,
    };
  }

  if (event.type === "STATE_CHANGED") {
    // Baby tick delta arrives via STATE_CHANGED from the runtime tick loop.
    const needsDelta = event.payload?.needsDelta as Partial<Omit<BabyNeeds, "mood">> | undefined;
    const hoursDelta = event.payload?.hoursDelta as number | undefined;
    const partnerAsleep = event.payload?.partnerAsleep as boolean | undefined;

    let next = { ...state };

    if (needsDelta) {
      next = {
        ...next,
        baby: {
          ...next.baby,
          needs: applyNeedsDelta(next.baby.needs, needsDelta),
        },
      };
    }

    if (hoursDelta != null) {
      next = { ...next, currentHour: next.currentHour + hoursDelta };
    }

    if (partnerAsleep != null) {
      next = {
        ...next,
        partner: { ...next.partner, isAsleep: partnerAsleep },
      };
    }

    return { ...next, eventLog: appendedLog };
  }

  return { ...state, eventLog: appendedLog };
}
