import type { GameState, GameEvent, Phase } from "@contracts/game-state";
import type { BeatId } from "@contracts/beats";
import type { DirectorCommand } from "@contracts/director-commands";
import type { ServerMessage, RenderState } from "@contracts/messages";
import { BEAT_GRAPH } from "@contracts/beats";
import { clamp } from "@contracts/game-state";
import { reducer } from "./reducer";
import { tick, cryTrigger, visualState } from "./baby-agent";
import { lineFor, partnerReaction } from "./partner-agent";

type Subscriber = (msg: ServerMessage) => void;
type Unsubscribe = () => void;

function makeEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeGameEvent(
  actor: GameEvent["actor"],
  type: GameEvent["type"],
  payload?: Record<string, unknown>,
  action?: GameEvent["action"],
): GameEvent {
  return { id: makeEventId(), at: Date.now(), actor, type, action, payload };
}

function hourToTimeLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const ampm = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${ampm}`;
}

function projectRenderState(state: GameState): RenderState {
  const beat = BEAT_GRAPH[state.beatId as BeatId];
  const captionCmd = beat?.entryEffects.find((e) => e.type === "SET_CAPTION");
  const caption = captionCmd && captionCmd.type === "SET_CAPTION" ? captionCmd.text : "";

  return {
    sessionId: state.sessionId,
    phase: state.phase,
    beatId: state.beatId,
    currentHour: state.currentHour,
    timeLabel: hourToTimeLabel(state.currentHour),
    baby: {
      name: state.baby.name,
      visualState: state.baby.visualState,
      mood: state.baby.needs.mood,
      hunger: state.baby.needs.hunger,
      sleepiness: state.baby.needs.sleepiness,
      discomfort: state.baby.needs.discomfort,
      connection: state.baby.needs.connection,
      health: state.baby.needs.health,
    },
    partner: {
      name: state.partner.name,
      mood: state.partner.mood,
      fatigue: state.partner.fatigue,
      resentment: state.partner.resentment,
      isAsleep: state.partner.isAsleep,
      visible: true,
      currentLine: state.partner.currentLine,
    },
    officer: {
      name: state.officer.name,
      visible: state.officer.visible,
      expression: state.officer.expression,
      currentLine: state.officer.currentLine,
    },
    availableActions: beat?.allowedActions ?? [],
    ledger: state.ledger,
    caption,
    eventLog: state.eventLog,
  };
}

export class DirectorRuntime {
  private state: GameState;
  private subscribers: Set<Subscriber> = new Set();
  private beatTimer: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(initialState: GameState) {
    this.state = initialState;
  }

  getState(): GameState {
    return this.state;
  }

  subscribe(handler: Subscriber): Unsubscribe {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  private emit(msg: ServerMessage): void {
    for (const sub of this.subscribers) {
      sub(msg);
    }
  }

  private emitStateUpdate(): void {
    const render = projectRenderState(this.state);
    this.emit({ type: "state", state: this.state, render });
  }

  private applyEvent(event: GameEvent): void {
    this.state = reducer(this.state, event);
  }

  dispatch(event: GameEvent): void {
    if (this.stopped && event.type !== "PANIC") return;

    this.applyEvent(event);

    if (event.type === "ACTION" && event.action != null) {
      // Update partner state in response to player action.
      const partnerDelta = partnerReaction(event, this.state.partner, this.state.ledger);
      if (Object.keys(partnerDelta).length > 0) {
        this.state = {
          ...this.state,
          partner: {
            ...this.state.partner,
            mood: clamp(this.state.partner.mood + (partnerDelta.moodDelta ?? 0)),
            fatigue: clamp(this.state.partner.fatigue + (partnerDelta.fatigueDelta ?? 0)),
            resentment: clamp(this.state.partner.resentment + (partnerDelta.resentmentDelta ?? 0)),
          },
        };
      }

      // Update baby visual state after action.
      const newVisual = visualState(this.state.baby);
      this.state = {
        ...this.state,
        baby: { ...this.state.baby, visualState: newVisual },
      };

      // Check if action drives a beat transition.
      this.checkActionBeatTransition(event.action);
    }

    // Refresh partner line on any beat transition or state change.
    this.emitStateUpdate();
  }

  private checkActionBeatTransition(action: string): void {
    const beatId = this.state.beatId as BeatId;

    // Beat-specific action -> next beat mappings.
    const transitions: Partial<Record<BeatId, Partial<Record<string, BeatId>>>> = {
      home: { start_game: "probation_splash", create_room: "probation_splash", join_room: "probation_splash" },
      probation_splash: { answer_intake: "officer_intro" },
      officer_intro: { answer_intake: "photo_intake" },
      photo_intake: { upload_photo: "verification_games", skip_photo: "verification_games" },
      ominous_warning: { answer_intake: "baby_roll" },
      baby_roll: { name_baby: "baby_arrival" },
      baby_arrival: { answer_intake: "first_calm" },
      first_calm: {},
      night_cry: {
        shirk: "shirk_or_wake",
        wake_partner: "shirk_or_wake",
        get_up: "night_soothe",
      },
      shirk_or_wake: {
        shirk: "argument_start",
        get_up: "night_soothe",
        wake_partner: "argument_start",
      },
      argument_start: { get_up: "argument_resolution", comfort_partner: "argument_resolution" },
      argument_resolution: { get_up: "night_soothe", comfort_partner: "night_soothe" },
      cute_payoff: { answer_intake: "verdict" },
      verdict: { answer_intake: "debrief_card" },
      debrief_card: { start_game: "home" },
    };

    const beatTransitions = transitions[beatId];
    if (!beatTransitions) return;

    const nextBeat = beatTransitions[action as string];
    if (nextBeat) {
      this.enterBeat(nextBeat);
    }
  }

  executeCommand(cmd: DirectorCommand): void {
    if (this.stopped) return;

    switch (cmd.type) {
      case "ENTER_BEAT": {
        const target = cmd.beatId as BeatId;
        const current = BEAT_GRAPH[this.state.beatId as BeatId];
        if (!current || !current.possibleNextBeats.includes(target)) {
          // Rejected: not a valid next beat from current position.
          return;
        }
        this.enterBeat(target);
        break;
      }

      case "PLAY_AUDIO":
        this.emit({ type: "play_audio", assetId: cmd.assetId, channel: cmd.channel, loop: cmd.loop });
        break;

      case "STOP_AUDIO":
        this.emit({ type: "stop_audio", channel: cmd.channel });
        break;

      case "ADVANCE_TIME": {
        const evt = makeGameEvent("system", "STATE_CHANGED", {
          hoursDelta: cmd.hours,
          needsDelta: {
            hunger: cmd.hours * 4,
            sleepiness: cmd.hours * 3,
            connection: -(cmd.hours * 1),
          },
        });
        this.applyEvent(evt);
        const partnerDelta = partnerReaction(evt, this.state.partner, this.state.ledger);
        if (Object.keys(partnerDelta).length > 0) {
          this.state = {
            ...this.state,
            partner: {
              ...this.state.partner,
              mood: clamp(this.state.partner.mood + (partnerDelta.moodDelta ?? 0)),
              fatigue: clamp(this.state.partner.fatigue + (partnerDelta.fatigueDelta ?? 0)),
              resentment: clamp(this.state.partner.resentment + (partnerDelta.resentmentDelta ?? 0)),
            },
          };
        }
        this.state = {
          ...this.state,
          baby: { ...this.state.baby, visualState: visualState(this.state.baby) },
        };
        this.emitStateUpdate();
        break;
      }

      case "SET_CAPTION":
        // Caption lives in render state derived from beat; nothing to mutate here for scripted captions.
        // Custom override would need a state field. No-op for now.
        break;

      case "TRIGGER_FALLBACK": {
        const current = BEAT_GRAPH[this.state.beatId as BeatId];
        if (current?.fallbackBeat) {
          this.enterBeat(current.fallbackBeat);
        }
        break;
      }

      case "SET_AVAILABLE_ACTIONS":
      case "ASK_AGENT":
        // Future extension point. No-op in local mode.
        break;
    }
  }

  private enterBeat(beatId: BeatId): void {
    this.clearBeatTimer();

    const beat = BEAT_GRAPH[beatId];
    if (!beat) return;

    const evt = makeGameEvent("system", "BEAT_ENTERED", { beatId });
    this.applyEvent(evt);

    // Update partner line for the new beat.
    const line = lineFor(beatId, this.state.partner, this.state.ledger);
    this.state = {
      ...this.state,
      partner: { ...this.state.partner, currentLine: line },
    };

    // Update officer visibility.
    const officerBeats: BeatId[] = ["officer_intro", "ominous_warning", "verdict"];
    if (officerBeats.includes(beatId)) {
      this.state = {
        ...this.state,
        officer: { ...this.state.officer, visible: true },
      };
    } else if (beatId === "debrief_card") {
      this.state = {
        ...this.state,
        officer: { ...this.state.officer, visible: false },
      };
    }

    // Emit scene change.
    this.emit({ type: "scene_change", beatId, phase: beat.phase as Phase });

    // Execute entry effects.
    for (const cmd of beat.entryEffects) {
      this.executeCommand(cmd);
    }

    // Arm the beat timeout if specified.
    if (beat.timeoutMs != null && beat.fallbackBeat != null) {
      const fallback = beat.fallbackBeat;
      this.beatTimer = setTimeout(() => {
        this.enterBeat(fallback);
      }, beat.timeoutMs);
    }

    this.emitStateUpdate();

    // Start tick loop for gameplay beats.
    const gameplayPhases: Phase[] = ["gameplay", "night", "argument"];
    if (gameplayPhases.includes(beat.phase)) {
      this.startTickLoop();
    } else {
      this.stopTickLoop();
    }
  }

  private startTickLoop(): void {
    if (this.tickInterval != null) return;

    const secondsPerGameHour = this.state.settings.realSecondsPerGameHour;
    const intervalMs = secondsPerGameHour * 1000;

    this.tickInterval = setInterval(() => {
      const delta = tick(this.state.baby, this.state.comfort, 1);
      const evt = makeGameEvent("system", "STATE_CHANGED", {
        needsDelta: delta,
        hoursDelta: 1,
      });
      this.applyEvent(evt);

      // Update visual state.
      const newVisual = visualState(this.state.baby);
      this.state = {
        ...this.state,
        baby: { ...this.state.baby, visualState: newVisual },
      };

      // Check for cry trigger and emit audio if newly crying.
      const trigger = cryTrigger(this.state.baby);
      if (trigger && !this.state.baby.activeCry) {
        this.state = {
          ...this.state,
          baby: {
            ...this.state.baby,
            activeCry: {
              trigger,
              intensity: 70,
              startedAtHour: this.state.currentHour,
            },
          },
        };
        const assetMap: Record<string, string> = {
          hunger: "babyAudio.hunger",
          sleepiness: "babyAudio.tired",
          discomfort: "babyAudio.discomfort",
          lonely: "babyAudio.discomfort",
          health: "babyAudio.discomfort",
          overstimulated: "babyAudio.discomfort",
        };
        this.emit({
          type: "play_audio",
          assetId: assetMap[trigger] ?? "babyAudio.discomfort",
          channel: "baby",
          loop: true,
        });
      } else if (!trigger && this.state.baby.activeCry) {
        this.state = {
          ...this.state,
          baby: { ...this.state.baby, activeCry: undefined },
        };
        this.emit({ type: "stop_audio", channel: "baby" });
      }

      this.emitStateUpdate();
    }, intervalMs);
  }

  private stopTickLoop(): void {
    if (this.tickInterval != null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private clearBeatTimer(): void {
    if (this.beatTimer != null) {
      clearTimeout(this.beatTimer);
      this.beatTimer = null;
    }
  }

  panic(): void {
    this.stopped = true;
    this.clearBeatTimer();
    this.stopTickLoop();
    this.emit({ type: "stop_audio", channel: "all" });

    const evt = makeGameEvent("system", "PANIC");
    this.applyEvent(evt);
    this.emitStateUpdate();
  }

  skipTo(beatId: string): void {
    if (!(beatId in BEAT_GRAPH)) return;
    this.clearBeatTimer();
    this.enterBeat(beatId as BeatId);
  }

  start(): void {
    this.stopped = false;
    this.enterBeat(this.state.beatId as BeatId);
  }

  renderState(): RenderState {
    return projectRenderState(this.state);
  }
}

// Re-export for convenience.
export { projectRenderState };

