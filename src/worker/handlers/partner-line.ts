// Partner line agent: Gemini Flash text endpoint.
// Generates a partner reaction line for any beat, keyed by archetype + ledger + recent events.
// Returns { tools: [{ name: "say_line", args: { text, mood?, raise_resentment? } }] }.
// The caller (client) uses this to override the scripted line; scripted remains the fallback.

import type { PartnerState, FairnessLedger, GameEvent } from "../../../contracts/game-state";

export interface PartnerLineEnv {
  GEMINI_API_KEY?: string;
  GEMINI_TEXT_MODEL?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Request / response types
// ──────────────────────────────────────────────────────────────────────────────

type RequestBody = {
  beatId: string;
  partner: {
    name: string;
    traits: PartnerState["traits"];
    mood: number;
    fatigue: number;
    resentment: number;
  };
  ledger: FairnessLedger;
  baby: {
    name: string;
    traits: { temperament: string; soothing: string };
  };
  recentEvents: GameEvent[];
};

type SayLineArgs = {
  text: string;
  mood?: "warm" | "tense" | "exhausted" | "cold";
  raise_resentment?: boolean;
};

type SayLineTool = { name: "say_line"; args: SayLineArgs };

// ──────────────────────────────────────────────────────────────────────────────
// Gemini function definition
// ──────────────────────────────────────────────────────────────────────────────

const SAY_LINE_FUNCTION = {
  name: "say_line",
  description:
    "Deliver a single partner reaction line for this beat. " +
    "1-2 sentences, conversational, in-character. " +
    "Set raise_resentment=true only if the player has just shirked or been neglectful.",
  parameters: {
    type: "OBJECT",
    properties: {
      text: {
        type: "STRING",
        description:
          "What the partner says aloud. 1-2 sentences. No stage directions or quotation marks. " +
          "Match the archetype voice: anxious=worried run-ons, chill=short and dry, " +
          "resentful=tracking/scorekeeping, overfunctioner=busy/competent.",
      },
      mood: {
        type: "STRING",
        enum: ["warm", "tense", "exhausted", "cold"],
        description:
          "Emotional tone of the line. warm=bonding, tense=conflict brewing, " +
          "exhausted=running on empty, cold=shutting down.",
      },
      raise_resentment: {
        type: "BOOLEAN",
        description:
          "Set true if the player has shirked at least once and the partner is responding to that. " +
          "Default false.",
      },
    },
    required: ["text"],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are writing co-parent dialogue for BabySim, a co-parenting simulation game.

The scene: two adults are caring for a newborn under bureaucratic observation. Your job is to voice the PARTNER — the player's co-parent — for a single story beat.

ARCHETYPE VOICES:
- anxious: worried, over-explains, prone to catastrophizing; run-on sentences under stress.
- chill: terse, dry humor, responds to stress with understatement; never panics.
- resentful: keeps internal tallies; references past shirks; short and pointed.
- overfunctioner: already handled it; competent; occasionally passive-aggressive about being competent.

RULES:
1. 1-2 sentences only. Conversational. Present tense. No stage directions.
2. Reflect the ledger honestly: if playerShirks > 0, the partner knows it and it shows.
3. The line should feel like something a tired real person says — not a therapy script.
4. Night beats (night_cry, shirk_or_wake): partner may be groggy or asleep; shorter lines.
5. Cute / resolution beats (cute_payoff, argument_resolution): warmth is allowed, even earned.
6. Never mention the Ministry, the officer, or game mechanics.

Call say_line() exactly once.`;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...(extra ?? {}) }), { status, headers: corsHeaders });
}

function buildUserMessage(body: RequestBody): string {
  const { beatId, partner, ledger, baby, recentEvents } = body;

  const parts: string[] = [
    `Beat: ${beatId}`,
    `Partner: ${partner.name} | archetype=${partner.traits.archetype} | conflictStyle=${partner.traits.conflictStyle} | helpBias=${partner.traits.helpBias}`,
    `Partner state: mood=${Math.round(partner.mood)}, fatigue=${Math.round(partner.fatigue)}, resentment=${Math.round(partner.resentment)}`,
    `Baby: ${baby.name} | temperament=${baby.traits.temperament} | soothing=${baby.traits.soothing}`,
    `Fairness ledger: playerShirks=${ledger.playerShirks}, partnerShirks=${ledger.partnerShirks}, ` +
      `playerNightShifts=${ledger.playerNightShifts}, partnerNightShifts=${ledger.partnerNightShifts}, ` +
      `playerSoothes=${ledger.playerSoothes}, partnerSoothes=${ledger.partnerSoothes}`,
  ];

  if (recentEvents.length > 0) {
    const summaries = recentEvents
      .slice(-5)
      .map((e) => `[t=${e.at}] ${e.actor}:${e.type}${e.action ? `(${e.action})` : ""}`);
    parts.push(`Recent events: ${summaries.join(", ")}`);
  }

  parts.push("Call say_line() once with the partner's reaction to this beat.");
  return parts.join("\n");
}

// Gemini generateContent API shape (minimal)
type GeminiToolCall = {
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiToolCall[];
    };
  }>;
};

// ──────────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────────

export async function partnerLineHandler(request: Request, env: PartnerLineEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[partner-line ${reqId}]`, ...args);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError("invalid_json", 400);
  }

  if (!body.beatId || !body.partner || !body.ledger || !body.baby) {
    return jsonError("missing_required_fields", 400, {
      required: ["beatId", "partner", "ledger", "baby"],
    });
  }
  if (!Array.isArray(body.recentEvents)) {
    return jsonError("recentEvents_must_be_array", 400);
  }
  if (!env.GEMINI_API_KEY) {
    log("GEMINI_API_KEY not configured");
    return jsonError("GEMINI_API_KEY not configured on Worker secrets", 503);
  }

  const model = env.GEMINI_TEXT_MODEL ?? "gemini-3.1-flash-lite";
  const userMsg = buildUserMessage(body);

  log("calling Gemini", {
    beatId: body.beatId,
    partnerName: body.partner.name,
    archetype: body.partner.traits.archetype,
    model,
  });

  const geminiBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    tools: [{ function_declarations: [SAY_LINE_FUNCTION] }],
    tool_config: {
      function_calling_config: { mode: "ANY", allowed_function_names: ["say_line"] },
    },
    generation_config: {
      temperature: 0.85,
      max_output_tokens: 200,
    },
  };

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(geminiBody),
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return jsonError("fetch_failed", 502, { detail });
  }

  const text = await upstream.text();
  log("Gemini response", { status: upstream.status, ok: upstream.ok, bodyHead: text.slice(0, 240) });

  if (!upstream.ok) {
    return jsonError("upstream_error", 502, {
      upstreamStatus: upstream.status,
      detail: text.slice(0, 600),
    });
  }

  let data: GeminiResponse;
  try {
    data = JSON.parse(text) as GeminiResponse;
  } catch {
    return jsonError("non_json_upstream", 502, { detail: text.slice(0, 600) });
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const fnCallPart = parts.find((p) => p.functionCall?.name === "say_line");

  if (!fnCallPart?.functionCall?.args) {
    log("no say_line function call returned; synthesizing fallback");
    return new Response(
      JSON.stringify({
        tools: [
          {
            name: "say_line",
            args: { text: "", mood: "exhausted" },
          },
        ],
      }),
      { status: 200, headers: corsHeaders },
    );
  }

  const rawArgs = fnCallPart.functionCall.args;
  const rawText = typeof rawArgs.text === "string" ? rawArgs.text.trim() : "";

  if (!rawText) {
    log("say_line returned empty text");
    return new Response(
      JSON.stringify({
        tools: [{ name: "say_line", args: { text: "", mood: "exhausted" } }],
      }),
      { status: 200, headers: corsHeaders },
    );
  }

  const ALLOWED_MOODS = new Set(["warm", "tense", "exhausted", "cold"]);
  const mood =
    typeof rawArgs.mood === "string" && ALLOWED_MOODS.has(rawArgs.mood)
      ? (rawArgs.mood as SayLineArgs["mood"])
      : undefined;

  const raise_resentment =
    typeof rawArgs.raise_resentment === "boolean" ? rawArgs.raise_resentment : false;

  const result: SayLineTool = {
    name: "say_line",
    args: { text: rawText, mood, raise_resentment },
  };

  log("returning say_line", { text: rawText.slice(0, 80), mood, raise_resentment });
  return new Response(JSON.stringify({ tools: [result] }), { status: 200, headers: corsHeaders });
}
