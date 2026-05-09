import type { GameState, GameEvent, BabyNeeds, FairnessLedger } from "@contracts/game-state";
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
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          hunger: -25,
          connection: 5,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "rock": {
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          discomfort: -8,
          connection: 6,
          sleepiness: 3,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "sing": {
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          connection: 10,
          discomfort: -5,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "shush": {
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          discomfort: -6,
          connection: 3,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
          ledger: applyLedgerDelta(state.ledger, { playerSoothes: 1 }),
          eventLog: appendedLog,
        };
      }

      case "hold": {
        const nextNeeds = applyNeedsDelta(state.baby.needs, {
          connection: 15,
          discomfort: -5,
        });
        return {
          ...state,
          baby: { ...state.baby, needs: nextNeeds },
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
