import type { GameAction } from "./actions";
import type { AudioChannel } from "./director-commands";
import type { BabyVisualState, GameEvent, GameState, Phase } from "./game-state";

export type VoiceFeatures = {
  pitch?: number;
  rhythm: number;
  volume: number;
  duration: number;
};

export type ClientMessage =
  | { type: "action"; action: GameAction; payload?: Record<string, unknown> }
  | ({ type: "voice_input" } & VoiceFeatures)
  | { type: "photo_event"; kind: "uploaded" | "webcam" | "skipped"; countHint?: 1 | 2 }
  | { type: "name_baby"; name: string }
  | { type: "scene_ack"; beatId: string }
  | { type: "partner_speech_finished" }
  | { type: "panic" }
  | { type: "skip_to"; beatId: string }
  // Baby-agent consultative events — applied through reducer; engine clamps.
  | { type: "agent_set_visual_state"; state: BabyVisualState }
  | { type: "agent_set_mood_delta"; delta: number }
  | { type: "agent_set_need_delta"; need: "hunger" | "sleepiness" | "discomfort" | "connection" | "health"; delta: number };

export type RenderState = {
  sessionId: string;
  phase: Phase;
  beatId: string;
  currentHour: number;
  timeLabel: string;
  baby: {
    name: string;
    visualState: BabyVisualState;
    mood: number;
    hunger: number;
    sleepiness: number;
    discomfort: number;
    connection: number;
    health: number;
  };
  partner: {
    name: string;
    mood: number;
    fatigue: number;
    resentment: number;
    isAsleep: boolean;
    visible: boolean;
    currentLine?: string;
  };
  officer: {
    name: string;
    visible: boolean;
    expression: string;
    currentLine?: string;
  };
  availableActions: GameAction[];
  ledger: GameState["ledger"];
  caption: string;
  progress?: number;
  eventLog: GameEvent[];
};

export type ServerMessage =
  | { type: "state"; state: GameState; render: RenderState }
  | { type: "play_audio"; assetId: string; channel: AudioChannel; loop?: boolean }
  | { type: "stop_audio"; channel: AudioChannel | "all" }
  | { type: "scene_change"; beatId: string; phase: Phase }
  | { type: "partner_speak_now"; mode: "scripted" | "realtime"; promptVariant?: string }
  | { type: "generation_progress"; progress: number; label: string };

export type { GameEvent };

