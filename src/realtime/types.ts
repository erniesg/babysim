// Provider-neutral interface for the realtime partner-voice session.
// Backed by Gemini Flash Live first; OpenAI Realtime is a drop-in alternative.

import type { PartnerTraits } from "@contracts/game-state";

export type RealtimeProvider = "gemini" | "openai";

export type PartnerSessionConfig = {
  /** Co-parent identity, used in the system prompt. */
  partnerName: string;
  archetype: PartnerTraits["archetype"];
  /** Live ledger snapshot — drives whose-turn-is-it tone. */
  ledger: {
    playerNightShifts: number;
    playerShirks: number;
    playerSoothes: number;
    partnerNightShifts: number;
    partnerShirks: number;
    partnerSoothes: number;
  };
  babyName: string;
  /** Beat the partner is reacting in (e.g., "argument_start"). */
  beatId: string;
};

export type PartnerToolCall =
  | { name: "take_night_shift"; args: Record<string, never> }
  | { name: "refuse_night_shift"; args: Record<string, never> }
  | { name: "comfort_partner"; args: Record<string, never> }
  | { name: "raise_resentment"; args: { delta?: number } }
  | { name: "calm_down"; args: Record<string, never> }
  | { name: "concede_argument"; args: Record<string, never> }
  | { name: string; args: Record<string, unknown> };

export type PartnerEvent =
  | { type: "audio"; chunk: ArrayBuffer; mimeType?: string }
  | { type: "text_delta"; text: string }
  | { type: "text_complete"; text: string }
  | { type: "tool_call"; call: PartnerToolCall }
  | { type: "open" }
  | { type: "closed"; code?: number; reason?: string }
  | { type: "error"; error: string };

export type RealtimePartnerSession = {
  /** Begin the conversation; resolves when the upstream session is open and ready. */
  start(): Promise<void>;
  /** Stream a chunk of mic audio (PCM 16-bit LE, 16kHz). */
  sendMicChunk(chunk: ArrayBuffer): void;
  /** Send a one-shot text turn (e.g., scripted opener). */
  sendText(text: string): void;
  /** Subscribe to events from the partner. Returns unsubscribe. */
  on(handler: (event: PartnerEvent) => void): () => void;
  /** Close the session and release all resources. */
  close(): void;
  readonly provider: RealtimeProvider;
};

export type CreatePartnerSession = (config: PartnerSessionConfig) => RealtimePartnerSession;
