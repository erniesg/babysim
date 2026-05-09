import type { GameState } from "@contracts/game-state";
import type { MuppetExpression, MuppetGesture } from "../muppet/muppet-engine";
import type { OfficerToolCall } from "../worker/handlers/officer";
import { emitAgentTrace } from "../components/DebugOverlay";

// Re-export so callers can import from here.
export type { OfficerToolCall };

export type OfficerLine = {
  text: string;
  expression: MuppetExpression;
  gesture: MuppetGesture;
};

type OfficerBeat = "officer_intro" | "ominous_warning" | "verdict";

const ENDPOINT = "/api/officer";

// ── llmOfficerBeat ─────────────────────────────────────────────────────────────
// Returns the full `tools[]` array from the Officer agent so the client can
// execute each tool call in sequence (say, set_expression, warn_player, etc.).
// Returns null on network failure or when the API key is absent — callers must
// fall back to scripted lines.

export async function llmOfficerBeat(
  beatId: OfficerBeat,
  state: GameState,
  signal?: AbortSignal,
): Promise<OfficerToolCall[] | null> {
  emitAgentTrace({ agent: "officer", status: "called", detail: beatId });
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        beatId,
        officerName: state.officer.name,
        partnerName: state.partner.name,
        babyName: state.baby.name,
        ledger: state.ledger,
      }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => `${res.status}`);
      emitAgentTrace({ agent: "officer", status: "error", detail: detail.slice(0, 200) });
      return null;
    }
    const data = (await res.json()) as { tools?: OfficerToolCall[] };
    if (!Array.isArray(data.tools) || data.tools.length === 0) {
      emitAgentTrace({ agent: "officer", status: "fallback", detail: "no tools returned" });
      return null;
    }
    emitAgentTrace({ agent: "officer", status: "ok", tools: data.tools.map((t) => t.name) });
    return data.tools;
  } catch (err) {
    emitAgentTrace({ agent: "officer", status: "error", detail: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── llmOfficerLine (legacy compat) ─────────────────────────────────────────────
// Calls llmOfficerBeat and extracts the first `say` tool call as a plain
// OfficerLine. Existing callers that only want a single line continue to work.

export async function llmOfficerLine(
  beatId: OfficerBeat,
  state: GameState,
  signal?: AbortSignal,
): Promise<OfficerLine | null> {
  const tools = await llmOfficerBeat(beatId, state, signal);
  if (!tools) return null;

  const sayCall = tools.find((t): t is Extract<OfficerToolCall, { name: "say" }> => t.name === "say");
  if (!sayCall || typeof sayCall.args.text !== "string") return null;

  return {
    text: sayCall.args.text,
    expression: sayCall.args.expression ?? "strict",
    gesture: (sayCall.args.gesture as MuppetGesture) ?? "stamp",
  };
}

export function isOfficerAgentEnabled(): boolean {
  // Default ON in production deploys (the Pages Function holds the key);
  // disable via VITE_ENABLE_OFFICER_AGENT=0 to force scripted lines.
  const flag = import.meta.env.VITE_ENABLE_OFFICER_AGENT;
  return flag !== "0" && flag !== "false";
}
