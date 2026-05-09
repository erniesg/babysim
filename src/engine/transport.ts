import type { ClientMessage, ServerMessage, RenderState } from "@contracts/messages";
import type { GameEvent, GameState } from "@contracts/game-state";
import type { BeatId } from "@contracts/beats";
import { DirectorRuntime, projectRenderState } from "./runtime";
import { seedRoll } from "./seed";
import { BEAT_GRAPH } from "@contracts/beats";

export interface GameTransport {
  send(message: ClientMessage): void;
  subscribe(handler: (message: ServerMessage) => void): () => void;
}

function makeInitialState(sessionId: string, seed: string): GameState {
  const roll = seedRoll(seed);

  return {
    sessionId,
    seed,
    phase: "home",
    beatId: "home",
    currentHour: 8,
    settings: {
      // 2 real seconds per game hour → ~48 real seconds for a 24-hour game day.
      // Adjusted via skipTo in demos. 3 seconds is comfortable for a 2-3 min run.
      realSecondsPerGameHour: 3,
    },
    baby: {
      ...roll.baby,
      name: "",
    },
    partner: {
      ...roll.partner,
      mood: 50,
      fatigue: 0,
      resentment: 0,
    },
    officer: roll.officer,
    comfort: {
      diaperWet: false,
      tooHot: false,
      tooCold: false,
      awkwardPosition: false,
    },
    ledger: {
      playerNightShifts: 0,
      partnerNightShifts: 0,
      playerShirks: 0,
      partnerShirks: 0,
      playerSoothes: 0,
      partnerSoothes: 0,
    },
    eventLog: [],
  };
}

function makeGameEvent(
  actor: GameEvent["actor"],
  type: GameEvent["type"],
  payload?: Record<string, unknown>,
  action?: GameEvent["action"],
): GameEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    actor,
    type,
    action,
    payload,
  };
}

type RenderSubscriber = (render: RenderState) => void;

export class LocalGameTransport implements GameTransport {
  private runtime: DirectorRuntime;
  private renderSubscribers: Set<RenderSubscriber> = new Set();

  constructor(sessionId: string, seed: string) {
    const initial = makeInitialState(sessionId, seed);
    this.runtime = new DirectorRuntime(initial);

    // Forward all server messages to render subscribers.
    this.runtime.subscribe((msg) => {
      if (msg.type === "state") {
        for (const sub of this.renderSubscribers) {
          sub(msg.render);
        }
      }
    });
  }

  send(message: ClientMessage): void {
    switch (message.type) {
      case "panic":
        this.runtime.panic();
        break;

      case "skip_to":
        this.runtime.skipTo(message.beatId);
        break;

      case "action": {
        const evt = makeGameEvent("player", "ACTION", message.payload ?? {}, message.action);
        this.runtime.dispatch(evt);
        break;
      }

      case "name_baby": {
        const evt = makeGameEvent("player", "ACTION", { name: message.name }, "name_baby");
        this.runtime.dispatch(evt);
        break;
      }

      case "voice_input": {
        const evt = makeGameEvent("player", "VOICE_FEATURES", {
          pitch: message.pitch,
          rhythm: message.rhythm,
          volume: message.volume,
          duration: message.duration,
        });
        this.runtime.dispatch(evt);
        break;
      }

      case "photo_event": {
        const action = message.kind === "skipped" ? "skip_photo" : "upload_photo";
        const evt = makeGameEvent("player", "ACTION", { kind: message.kind }, action);
        this.runtime.dispatch(evt);
        break;
      }

      case "scene_ack": {
        // Scene ack: auto-advance when beat has no other exit condition.
        const state = this.runtime.getState();
        const beatId = state.beatId as BeatId;
        const beat = BEAT_GRAPH[beatId];
        if (!beat) break;

        const autoAdvanceBeats: Partial<Record<BeatId, BeatId>> = {
          probation_splash: "officer_intro",
          // officer_intro now goes straight to verification — the player's
          // case file is captured from the webcam during RPS instead of via
          // a separate photo intake screen. AdoptOrGenerate runs as an in-stage
          // overlay during officer_intro completion, so partner type is set
          // before this scene_ack fires.
          officer_intro: "verification_games",
          verification_games: "generation_progress",
          generation_progress: "ominous_warning",
          time_jump_evening: "night_cry",
          cute_payoff: "verdict",
        };

        const next = autoAdvanceBeats[beatId];
        if (next && message.beatId === beatId) {
          this.runtime.skipTo(next);
        }
        break;
      }

      case "partner_speech_finished":
        // Triggers partner speech completion. Future: drives Realtime handoff.
        break;

      case "agent_set_visual_state": {
        const evt = makeGameEvent("baby", "AGENT_VISUAL_STATE", { visualState: message.state });
        this.runtime.dispatchAgentEvent(evt);
        break;
      }

      case "agent_set_mood_delta": {
        const evt = makeGameEvent("baby", "AGENT_NEED_DELTA", { need: "mood", delta: message.delta });
        this.runtime.dispatchAgentEvent(evt);
        break;
      }

      case "agent_set_need_delta": {
        const evt = makeGameEvent("baby", "AGENT_NEED_DELTA", { need: message.need, delta: message.delta });
        this.runtime.dispatchAgentEvent(evt);
        break;
      }
    }
  }

  subscribe(handler: (message: ServerMessage) => void): () => void {
    return this.runtime.subscribe(handler);
  }

  subscribeRender(handler: RenderSubscriber): () => void {
    this.renderSubscribers.add(handler);
    return () => this.renderSubscribers.delete(handler);
  }

  renderState(): RenderState {
    return this.runtime.renderState();
  }

  start(): void {
    this.runtime.start();
  }

  getRuntime(): DirectorRuntime {
    return this.runtime;
  }
}

export { projectRenderState };
