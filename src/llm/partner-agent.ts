// Client-side hook that calls /api/partner/line.
// Mirrors the shape of src/llm/baby-agent.ts.
// Returns a say_line tool call array on success, or null on any failure.
// The scripted lineFor() from src/engine/partner-agent.ts remains the fallback
// — this file never imports from that module.

import type { GameState, GameEvent } from "@contracts/game-state";
import { emitAgentTrace } from "../components/DebugOverlay";

export type PartnerToolCall =
  | { name: "say_line"; args: { text: string; mood?: string; raise_resentment?: boolean } };

export type PartnerAgentResponse = {
  tools: PartnerToolCall[];
};

const ENDPOINT = "/api/partner/line";

const log = (...args: unknown[]) => console.log("[PartnerAgent]", ...args);

export async function callPartnerAgent(
  beatId: string,
  state: GameState,
  recentEvents: GameEvent[],
  signal?: AbortSignal,
): Promise<PartnerAgentResponse | null> {
  const { partner, ledger, baby } = state;
  log("calling", { beatId, archetype: partner.traits.archetype });
  emitAgentTrace({ agent: "partner", status: "called", detail: `${beatId} · ${partner.traits.archetype}` });

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        beatId,
        partner: {
          name: partner.name,
          traits: partner.traits,
          mood: partner.mood,
          fatigue: partner.fatigue,
          resentment: partner.resentment,
        },
        ledger,
        baby: {
          name: baby.name,
          traits: {
            temperament: baby.traits.temperament,
            soothing: baby.traits.soothing,
          },
        },
        recentEvents: recentEvents.slice(-5),
      }),
      signal,
    });

    if (!res.ok) {
      log("not ok", res.status);
      const detail = await res.text().catch(() => `${res.status}`);
      emitAgentTrace({ agent: "partner", status: "error", detail: detail.slice(0, 200) });
      return null;
    }

    const data = (await res.json()) as PartnerAgentResponse;
    log("returned", data.tools?.map((t) => t.name));
    emitAgentTrace({
      agent: "partner",
      status: "ok",
      tools: (data.tools ?? []).map((t) => t.name),
      detail: data.tools?.[0]?.args?.text?.slice(0, 80),
    });
    return data;
  } catch (err) {
    log("threw", err instanceof Error ? err.message : String(err));
    emitAgentTrace({ agent: "partner", status: "error", detail: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Default ON in production — the dynamic partner is the product.
 *  Disable via VITE_PARTNER_LIVE_TEXT=0 to force the scripted-line fallback. */
export function isPartnerLiveTextEnabled(): boolean {
  const flag = import.meta.env.VITE_PARTNER_LIVE_TEXT;
  return flag !== "0" && flag !== "false";
}

// "Matched-then-action" rule: partner is matched at photo_intake. From
// verification_games onward they can COMMENT (live text). From baby_arrival
// onward the engine also accepts partner ACTIONS (via realtime tool calls).
// home/probation_splash/officer_intro/photo_intake → partner not yet on stage.
// argument_start/argument_resolution → realtime mic owns the voice channel.
const PARTNER_LIVE_BEATS = new Set([
  "verification_games",
  "generation_progress",
  "ominous_warning",
  "baby_roll",
  "baby_arrival",
  "first_calm",
  "first_cry",
  "discovery_soothing",
  "time_jump_evening",
  "night_cry",
  "shirk_or_wake",
  "night_soothe",
  "cute_payoff",
  "verdict",
]);

export function isPartnerLiveBeat(beatId: string): boolean {
  return PARTNER_LIVE_BEATS.has(beatId);
}
