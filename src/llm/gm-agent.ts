import type { DirectorCommand, AudioChannel } from "@contracts/director-commands";
import type { GameEvent, GameState } from "@contracts/game-state";
import { emitAgentTrace } from "../components/DebugOverlay";

export type GmToolCall =
  | { name: "enter_beat"; args: { beatId: string } }
  | { name: "set_caption"; args: { text: string } }
  | { name: "play_audio"; args: { channel: AudioChannel; assetId: string; loop: boolean } }
  | { name: "stop_audio"; args: { channel: AudioChannel | "all" } }
  | { name: "ask_agent"; args: { agent: "officer" | "baby" | "partner"; payload: Record<string, unknown> } }
  | { name: "advance_time"; args: { hours: number } }
  | { name: "trigger_fallback"; args: { reason: string } };

export type GmAgentResponse = {
  tools: GmToolCall[];
  rejected: { name: string; args: unknown; reason: string }[];
};

const ENDPOINT = "/api/gm";

const log = (...args: unknown[]) => console.log("[GmAgent]", ...args);

export async function callGmAgent(
  beatId: string,
  state: GameState,
  recentEvents: GameEvent[],
  signal?: AbortSignal,
): Promise<GmAgentResponse | null> {
  log("calling", { beatId });
  emitAgentTrace({ agent: "gm", status: "called", detail: beatId });

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state,
        recentEvents: recentEvents.slice(-10),
        reason: `beat_entered:${beatId}`,
      }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => `${res.status}`);
      log("not ok", res.status, detail.slice(0, 160));
      emitAgentTrace({ agent: "gm", status: "error", detail: detail.slice(0, 200) });
      return null;
    }

    const data = (await res.json()) as GmAgentResponse;
    const tools = Array.isArray(data.tools) ? data.tools : [];
    const rejected = Array.isArray(data.rejected) ? data.rejected : [];
    emitAgentTrace({
      agent: "gm",
      status: "ok",
      tools: tools.map((t) => t.name),
      detail: rejected.length > 0 ? `${rejected.length} rejected` : undefined,
    });
    return { tools, rejected };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("threw", detail);
    emitAgentTrace({ agent: "gm", status: "error", detail });
    return null;
  }
}

export function gmToolToDirectorCommand(tool: GmToolCall): DirectorCommand | null {
  switch (tool.name) {
    case "enter_beat":
      return { type: "ENTER_BEAT", beatId: tool.args.beatId };
    case "set_caption":
      return { type: "SET_CAPTION", text: tool.args.text };
    case "play_audio":
      return {
        type: "PLAY_AUDIO",
        channel: tool.args.channel,
        assetId: tool.args.assetId,
        loop: tool.args.loop,
      };
    case "stop_audio":
      return { type: "STOP_AUDIO", channel: tool.args.channel };
    case "ask_agent":
      return { type: "ASK_AGENT", agent: tool.args.agent, payload: tool.args.payload };
    case "advance_time":
      return { type: "ADVANCE_TIME", hours: tool.args.hours };
    case "trigger_fallback":
      return { type: "TRIGGER_FALLBACK", reason: tool.args.reason };
    default:
      return null;
  }
}

export function isGmAgentEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_GM_AGENT;
  return flag !== "0" && flag !== "false";
}
