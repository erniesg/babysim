import type { GameAction } from "./actions";

export type AudioChannel = "baby" | "partner" | "officer" | "ambient";

export type DirectorCommand =
  | { type: "ENTER_BEAT"; beatId: string }
  | { type: "SET_AVAILABLE_ACTIONS"; actions: GameAction[] }
  | { type: "PLAY_AUDIO"; channel: AudioChannel; assetId: string; loop?: boolean }
  | { type: "STOP_AUDIO"; channel: AudioChannel | "all" }
  | { type: "SET_CAPTION"; text: string }
  | { type: "ASK_AGENT"; agent: "baby" | "partner" | "officer"; payload: Record<string, unknown> }
  | { type: "ADVANCE_TIME"; hours: number }
  | { type: "TRIGGER_FALLBACK"; reason: string };

