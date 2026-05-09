// GM (Director) agent: gpt-5.5 with DirectorCommand tool suite. Runs in the Worker.
// The GM is the ONLY agent allowed to emit `enter_beat`.
// All state mutation still happens in src/engine/runtime.ts via the reducer;
// this endpoint only returns validated commands — the browser dispatches them.

import type { GameState, GameEvent } from "../../../contracts/game-state";
import type { BeatId } from "../../../contracts/beats";
import { BEAT_GRAPH } from "../../../contracts/beats";

// Reuse the same env shape as the Officer (same model, same key).
export type GMEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
};

// ─── Tool argument shapes (strict TS mirror of the JSON-Schema below) ──────────

type EnterBeatArgs = { beatId: string };
type SetCaptionArgs = { text: string };
type PlayAudioArgs = { channel: "baby" | "partner" | "officer" | "ambient"; assetId: string; loop: boolean };
type StopAudioArgs = { channel: "baby" | "partner" | "officer" | "ambient" | "all" };
type AskAgentArgs = { agent: "officer" | "baby" | "partner"; payload: Record<string, unknown> };
type AdvanceTimeArgs = { hours: number };
type TriggerFallbackArgs = { reason: string };

type ParsedToolCall =
  | { name: "enter_beat"; args: EnterBeatArgs }
  | { name: "set_caption"; args: SetCaptionArgs }
  | { name: "play_audio"; args: PlayAudioArgs }
  | { name: "stop_audio"; args: StopAudioArgs }
  | { name: "ask_agent"; args: AskAgentArgs }
  | { name: "advance_time"; args: AdvanceTimeArgs }
  | { name: "trigger_fallback"; args: TriggerFallbackArgs };

// ─── Request / response shapes ─────────────────────────────────────────────────

type RequestBody = {
  state: GameState;
  recentEvents: GameEvent[]; // last 10
  reason?: string;
};

type GmResponse = {
  tools: ParsedToolCall[];
  rejected: { name: string; args: unknown; reason: string }[];
};

// ─── Tool definitions (JSON Schema sent to the model) ─────────────────────────
// One function per DirectorCommand variant for a clean tool-call surface.
// Shapes deliberately match the discriminated union in contracts/director-commands.ts.

const GM_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "enter_beat",
      description:
        "Transition the game to a new beat. ONLY call this with a beatId that is listed in the current beat's possibleNextBeats. This is the ONLY tool that can change the active beat — guard it carefully.",
      parameters: {
        type: "object",
        properties: {
          beatId: {
            type: "string",
            description: "The target BeatId to enter. Must be a direct successor of the current beat per BEAT_GRAPH.",
          },
        },
        required: ["beatId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_caption",
      description: "Display a caption overlay in the game UI. Use for stage directions, scene labels, and context cues. Never speak to the player as a character — this is a director's note, not dialogue.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Caption text. Maximum 120 characters. Plain text, no markdown.",
            maxLength: 120,
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "play_audio",
      description: "Start audio playback on a specific channel. Use for ambient beds, baby sounds, partner reactions, or officer underscore. Do NOT invent asset IDs — use only established manifest IDs.",
      parameters: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            enum: ["baby", "partner", "officer", "ambient"],
            description: "The audio channel to target.",
          },
          assetId: {
            type: "string",
            description: "Asset identifier from the audio manifest (e.g. 'babyAudio.hunger', 'ambient.night').",
          },
          loop: {
            type: "boolean",
            description: "Whether the audio should loop continuously.",
          },
        },
        required: ["channel", "assetId", "loop"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "stop_audio",
      description: "Stop audio on a specific channel or all channels at once.",
      parameters: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            enum: ["baby", "partner", "officer", "ambient", "all"],
            description: "Channel to stop. Use 'all' to silence everything.",
          },
        },
        required: ["channel"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_agent",
      description: "Dispatch a request payload to another LLM agent. Use to trigger officer dialogue, partner reaction, or baby state commentary. The agent will respond asynchronously.",
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            enum: ["officer", "baby", "partner"],
            description: "The agent to invoke.",
          },
          payload: {
            type: "object",
            description: "Arbitrary JSON payload the target agent will receive.",
            additionalProperties: true,
          },
        },
        required: ["agent", "payload"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "advance_time",
      description: "Skip game time forward. Use to bridge gameplay gaps (e.g. 8 hours of sleep). Updates all need meters proportionally.",
      parameters: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "Number of game-hours to advance. Must be between 1 and 24 inclusive.",
            minimum: 1,
            maximum: 24,
          },
        },
        required: ["hours"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "trigger_fallback",
      description: "Signal that the GM cannot determine a valid next action. The deterministic DirectorRuntime will take over via the current beat's fallbackBeat. Always prefer explicit commands — use this only when genuinely stuck.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Short explanation of why the fallback was triggered. Logged for observability.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
] as const;

// ─── System prompt ─────────────────────────────────────────────────────────────

const GM_SYSTEM_PROMPT = `You are the Director of BabySim — an invisible orchestrator who drives beat transitions and stage-directs the simulation. You never speak to the player directly and you never appear as a character.

Your job: read the current game state and recent events, then emit the minimum set of DirectorCommands needed to advance the scene correctly.

## Rules you must never break

1. **enter_beat is exclusive to you.** No other agent may transition beats. Use it deliberately.
2. **Only enter valid next beats.** You may ONLY call enter_beat with a beatId listed in the current beat's possibleNextBeats. If you call it with anything else, the server will reject it and log the violation.
3. **Never mutate state directly.** Emit commands; the reducer handles state.
4. **Never invent asset IDs.** Use only IDs from the established manifest (e.g. babyAudio.hunger, babyAudio.tired, babyAudio.discomfort, ambient.night).
5. **Never leave the baby crying without resolution actions.** If a cry beat has timed out, trigger_fallback rather than blocking.
6. **Preserve fallback paths.** If you are uncertain, call trigger_fallback with a clear reason. The deterministic runtime will recover.
7. **Multiple tool calls per response are fine.** You may set_caption + enter_beat in a single turn.
8. **Tone is invisible stage direction.** set_caption text is a director's note — terse, present-tense, functional. No flavour prose.

## Ordering

Prefer this sequence when transitioning beats:
1. stop_audio (if a channel is playing and the new beat doesn't need it)
2. set_caption (to label the incoming scene)
3. enter_beat (the actual transition)
4. play_audio (if the incoming beat needs sound)

You may ask_agent to prime the officer or partner before entering a beat so their lines are ready when the scene opens.`;

// ─── CORS headers (same as officer.ts) ────────────────────────────────────────

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

// ─── Validation helpers ────────────────────────────────────────────────────────

function isValidBeatId(id: unknown): id is BeatId {
  return typeof id === "string" && id in BEAT_GRAPH;
}

function validateEnterBeat(
  args: EnterBeatArgs,
  currentBeatId: string,
): { valid: true } | { valid: false; reason: string } {
  if (!isValidBeatId(args.beatId)) {
    return { valid: false, reason: `'${args.beatId}' is not a recognised BeatId` };
  }
  if (!isValidBeatId(currentBeatId)) {
    return { valid: false, reason: `current beat '${currentBeatId}' not found in BEAT_GRAPH` };
  }
  const currentSpec = BEAT_GRAPH[currentBeatId];
  if (!currentSpec.possibleNextBeats.includes(args.beatId as BeatId)) {
    return {
      valid: false,
      reason: `'${args.beatId}' is not in possibleNextBeats for '${currentBeatId}' (allowed: [${currentSpec.possibleNextBeats.join(", ")}])`,
    };
  }
  return { valid: true };
}

function validateSetCaption(args: SetCaptionArgs): { valid: true } | { valid: false; reason: string } {
  if (typeof args.text !== "string" || args.text.length === 0) {
    return { valid: false, reason: "text must be a non-empty string" };
  }
  if (args.text.length > 120) {
    return { valid: false, reason: `text exceeds 120 chars (got ${args.text.length})` };
  }
  return { valid: true };
}

function validatePlayAudio(args: PlayAudioArgs): { valid: true } | { valid: false; reason: string } {
  const validChannels = ["baby", "partner", "officer", "ambient"];
  if (!validChannels.includes(args.channel)) {
    return { valid: false, reason: `invalid channel '${args.channel}'` };
  }
  if (typeof args.assetId !== "string" || args.assetId.length === 0) {
    return { valid: false, reason: "assetId must be a non-empty string" };
  }
  return { valid: true };
}

function validateStopAudio(args: StopAudioArgs): { valid: true } | { valid: false; reason: string } {
  const validChannels = ["baby", "partner", "officer", "ambient", "all"];
  if (!validChannels.includes(args.channel)) {
    return { valid: false, reason: `invalid channel '${args.channel}'` };
  }
  return { valid: true };
}

function validateAskAgent(args: AskAgentArgs): { valid: true } | { valid: false; reason: string } {
  const validAgents = ["officer", "baby", "partner"];
  if (!validAgents.includes(args.agent)) {
    return { valid: false, reason: `invalid agent '${args.agent}'` };
  }
  if (typeof args.payload !== "object" || args.payload === null) {
    return { valid: false, reason: "payload must be an object" };
  }
  return { valid: true };
}

function validateAdvanceTime(args: AdvanceTimeArgs): { valid: true } | { valid: false; reason: string } {
  if (typeof args.hours !== "number" || !Number.isFinite(args.hours)) {
    return { valid: false, reason: "hours must be a finite number" };
  }
  if (args.hours < 1 || args.hours > 24) {
    return { valid: false, reason: `hours must be between 1 and 24 (got ${args.hours})` };
  }
  return { valid: true };
}

function validateTriggerFallback(args: TriggerFallbackArgs): { valid: true } | { valid: false; reason: string } {
  if (typeof args.reason !== "string" || args.reason.length === 0) {
    return { valid: false, reason: "reason must be a non-empty string" };
  }
  return { valid: true };
}

// ─── Build user message from game state ───────────────────────────────────────

function buildUserMessage(body: RequestBody): string {
  const { state, recentEvents, reason } = body;
  const currentBeatSpec = isValidBeatId(state.beatId) ? BEAT_GRAPH[state.beatId] : null;

  const parts: string[] = [
    `## Current game state`,
    `Beat: ${state.beatId} (phase: ${state.phase})`,
    `Hour: ${state.currentHour}`,
    `Possible next beats: [${currentBeatSpec?.possibleNextBeats.join(", ") ?? "none"}]`,
    ``,
    `## Baby`,
    `Name: ${state.baby.name} | Visual: ${state.baby.visualState} | Sleeping: ${state.baby.isAsleep}`,
    `Needs: hunger=${state.baby.needs.hunger} sleepiness=${state.baby.needs.sleepiness} discomfort=${state.baby.needs.discomfort} connection=${state.baby.needs.connection}`,
    state.baby.activeCry
      ? `Active cry: trigger=${state.baby.activeCry.trigger} intensity=${state.baby.activeCry.intensity}`
      : `No active cry`,
    ``,
    `## Partner`,
    `Name: ${state.partner.name} | Asleep: ${state.partner.isAsleep} | Mood: ${state.partner.mood} Fatigue: ${state.partner.fatigue} Resentment: ${state.partner.resentment}`,
    ``,
    `## Officer`,
    `${state.officer.name} | Visible: ${state.officer.visible}`,
    ``,
    `## Fairness ledger`,
    JSON.stringify(state.ledger),
    ``,
    `## Recent events (last ${recentEvents.length})`,
    recentEvents
      .slice(-10)
      .map((e) => `  [${e.actor}] ${e.type}${e.action ? ` action=${e.action}` : ""}`)
      .join("\n"),
  ];

  if (reason) {
    parts.push(``, `## Reason for this GM call`, reason);
  }

  parts.push(``, `Emit the DirectorCommands needed to advance or stabilise this beat. Remember: enter_beat MUST use one of [${currentBeatSpec?.possibleNextBeats.join(", ") ?? "—"}].`);

  return parts.join("\n");
}

// ─── Error helper (same pattern as officer.ts) ────────────────────────────────

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...(extra ?? {}) }), { status, headers: corsHeaders });
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function gmAgent(request: Request, env: GMEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[gm ${reqId}]`, ...args);

  // ── Parse request body ──
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError("invalid_json", 400);
  }

  if (!body.state || typeof body.state !== "object") {
    return jsonError("missing_state", 400);
  }
  if (!body.state.beatId) {
    return jsonError("state.beatId is required", 400);
  }
  if (!Array.isArray(body.recentEvents)) {
    return jsonError("recentEvents must be an array", 400);
  }
  if (!env.OPENAI_API_KEY) {
    log("OPENAI_API_KEY not configured");
    return jsonError("OPENAI_API_KEY not configured on Worker secrets", 503);
  }

  const currentBeatId = body.state.beatId;
  const model = env.OPENAI_TEXT_MODEL || "gpt-5.5";

  log("calling OpenAI", { beatId: currentBeatId, model });

  // ── Call OpenAI ──
  let upstreamText: string;
  let upstreamStatus: number;
  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: GM_SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(body) },
        ],
        tools: GM_TOOLS,
        // Allow the model to call multiple tools; do not force a single one.
        tool_choice: "auto",
      }),
    });

    upstreamText = await upstream.text();
    upstreamStatus = upstream.status;
    log("OpenAI response", { status: upstreamStatus, ok: upstream.ok, bodyHead: upstreamText.slice(0, 240) });

    if (!upstream.ok) {
      return jsonError("upstream_error", 502, {
        upstreamStatus,
        detail: upstreamText.slice(0, 600),
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return jsonError("fetch_failed", 502, { detail });
  }

  // ── Parse OpenAI response ──
  let data: {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  try {
    data = JSON.parse(upstreamText);
  } catch {
    return jsonError("non_json_upstream", 502, { detail: upstreamText.slice(0, 600) });
  }

  const rawToolCalls = data.choices?.[0]?.message?.tool_calls ?? [];

  if (rawToolCalls.length === 0) {
    log("no tool calls in response");
    // Return empty command list rather than an error — the runtime deterministic fallback handles it.
    return new Response(JSON.stringify({ tools: [], rejected: [] } satisfies GmResponse), {
      status: 200,
      headers: corsHeaders,
    });
  }

  // ── Validate and partition tool calls ──
  const accepted: ParsedToolCall[] = [];
  const rejected: GmResponse["rejected"] = [];

  for (const raw of rawToolCalls) {
    if (raw.type !== "function" || !raw.function?.name || !raw.function.arguments) {
      rejected.push({ name: raw.function?.name ?? "unknown", args: null, reason: "malformed tool_call" });
      continue;
    }

    const toolName = raw.function.name;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(raw.function.arguments);
    } catch {
      rejected.push({ name: toolName, args: raw.function.arguments, reason: "arguments not valid JSON" });
      continue;
    }

    // Per-tool validation — mirrors the DirectorCommand discriminated union.
    switch (toolName) {
      case "enter_beat": {
        const args = parsedArgs as EnterBeatArgs;
        const result = validateEnterBeat(args, currentBeatId);
        if (!result.valid) {
          log(`rejected_beat_transition`, { target: args.beatId, current: currentBeatId, reason: result.reason });
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "enter_beat", args });
        }
        break;
      }
      case "set_caption": {
        const args = parsedArgs as SetCaptionArgs;
        const result = validateSetCaption(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "set_caption", args });
        }
        break;
      }
      case "play_audio": {
        const args = parsedArgs as PlayAudioArgs;
        const result = validatePlayAudio(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "play_audio", args });
        }
        break;
      }
      case "stop_audio": {
        const args = parsedArgs as StopAudioArgs;
        const result = validateStopAudio(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "stop_audio", args });
        }
        break;
      }
      case "ask_agent": {
        const args = parsedArgs as AskAgentArgs;
        const result = validateAskAgent(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "ask_agent", args });
        }
        break;
      }
      case "advance_time": {
        const args = parsedArgs as AdvanceTimeArgs;
        const result = validateAdvanceTime(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "advance_time", args });
        }
        break;
      }
      case "trigger_fallback": {
        const args = parsedArgs as TriggerFallbackArgs;
        const result = validateTriggerFallback(args);
        if (!result.valid) {
          rejected.push({ name: toolName, args, reason: result.reason });
        } else {
          accepted.push({ name: "trigger_fallback", args });
        }
        break;
      }
      default: {
        rejected.push({ name: toolName, args: parsedArgs, reason: `'${toolName}' is not in the GM allow-list` });
      }
    }
  }

  if (rejected.length > 0) {
    log("rejected tool calls", rejected.map((r) => `${r.name}: ${r.reason}`));
  }

  log("accepted tool calls", accepted.map((t) => t.name));

  const response: GmResponse = { tools: accepted, rejected };
  return new Response(JSON.stringify(response), { status: 200, headers: corsHeaders });
}
