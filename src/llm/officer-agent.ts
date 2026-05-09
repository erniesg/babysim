import type { GameState } from "@contracts/game-state";
import type { MuppetExpression, MuppetGesture } from "../muppet/muppet-engine";

export type OfficerLine = {
  text: string;
  expression: MuppetExpression;
  gesture: MuppetGesture;
};

type OfficerBeat = "officer_intro" | "ominous_warning" | "verdict";

const ENDPOINT = "/api/officer";

export async function llmOfficerLine(
  beatId: OfficerBeat,
  state: GameState,
  signal?: AbortSignal,
): Promise<OfficerLine | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as { tool?: string; args?: OfficerLine };
    if (data.tool !== "say" || !data.args || typeof data.args.text !== "string") return null;
    return {
      text: data.args.text,
      expression: data.args.expression ?? "strict",
      gesture: data.args.gesture ?? "stamp",
    };
  } catch {
    return null;
  }
}

export function isOfficerAgentEnabled(): boolean {
  // Default ON in production deploys (the Pages Function holds the key);
  // disable via VITE_ENABLE_OFFICER_AGENT=0 to force scripted lines.
  const flag = import.meta.env.VITE_ENABLE_OFFICER_AGENT;
  return flag !== "0" && flag !== "false";
}
