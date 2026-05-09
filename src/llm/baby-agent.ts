import type { BabyState, GameEvent } from "@contracts/game-state";
import type { GameAction } from "@contracts/actions";

export type BabyToolCall =
  | { name: "play_audio"; args: { assetId: string; loop?: boolean } }
  | { name: "set_caption"; args: { text: string } }
  | { name: "trigger_fallback"; args: { reason: string } };

export type BabyAgentResponse = {
  tools: BabyToolCall[];
};

const ENDPOINT = "/api/baby";

const log = (...args: unknown[]) => console.log("[BabyAgent]", ...args);

export async function callBabyAgent(
  baby: BabyState,
  beatId: string,
  recentEvents: GameEvent[],
  playerLastAction?: GameAction,
  signal?: AbortSignal,
): Promise<BabyAgentResponse | null> {
  log("calling", { beatId, action: playerLastAction, traits: baby.traits });
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        beatId,
        baby,
        recentEvents: recentEvents.slice(-5),
        playerLastAction,
      }),
      signal,
    });
    if (!res.ok) {
      log("not ok", res.status);
      return null;
    }
    const data = (await res.json()) as BabyAgentResponse;
    log("returned", data.tools?.map((t) => t.name));
    return data;
  } catch (err) {
    log("threw", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function isBabyAgentEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_BABY_AGENT;
  if (flag === "0" || flag === "false") return false;
  return true;
}

const GAMEPLAY_BEATS = new Set(["first_calm", "first_cry", "discovery_soothing", "night_cry", "night_soothe"]);
export function isGameplayBeat(beatId: string): boolean {
  return GAMEPLAY_BEATS.has(beatId);
}
