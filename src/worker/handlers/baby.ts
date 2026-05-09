// Baby agent: gpt-5.5 with play_audio / set_caption / trigger_fallback tool calls.
// The baby's hidden traits are translated into audio cues and soft trait-discovery
// captions. Unlike the Officer (one tool call, forced), the Baby may emit multiple
// tool calls per turn — e.g. an audio cue AND a caption hint at the same time.
// Channel is ALWAYS hardcoded to "baby" server-side; the model never sees or sets it.

import type { BabyState, GameEvent } from "../../../contracts/game-state";
import type { GameAction } from "../../../contracts/actions";

export interface BabyEnv {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Request / response types
// ──────────────────────────────────────────────────────────────────────────────

type RequestBody = {
  baby: BabyState;
  beatId: string;
  recentEvents: GameEvent[]; // last 5
  playerLastAction?: GameAction;
};

// Audio asset IDs the baby is allowed to trigger (on the "baby" channel).
const BABY_AUDIO_ASSETS = [
  "babyAudio.hunger",
  "babyAudio.tired",
  "babyAudio.discomfort",
  "babyAudio.coo",
] as const;

type BabyAudioAsset = (typeof BABY_AUDIO_ASSETS)[number];

// Parsed tool-call variants (what we return after validation).
type PlayAudioArgs = {
  assetId: BabyAudioAsset;
  loop: boolean;
};

type SetCaptionArgs = {
  text: string; // max 60 chars
};

type TriggerFallbackArgs = {
  reason: string;
};

type BabyToolCall =
  | { name: "play_audio"; args: PlayAudioArgs }
  | { name: "set_caption"; args: SetCaptionArgs }
  | { name: "trigger_fallback"; args: TriggerFallbackArgs };

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI function definitions (sent as `tools`)
// ──────────────────────────────────────────────────────────────────────────────

const PLAY_AUDIO_FUNCTION = {
  type: "function" as const,
  function: {
    name: "play_audio",
    description:
      "Play a pre-generated baby sound on the baby audio channel. " +
      "Choose the asset that best matches the baby's current need. " +
      "The channel is always 'baby' — do NOT include a channel parameter.",
    parameters: {
      type: "object",
      properties: {
        assetId: {
          type: "string",
          enum: BABY_AUDIO_ASSETS,
          description:
            "babyAudio.hunger = hungry cry, babyAudio.tired = tired/whimper, " +
            "babyAudio.discomfort = distressed cry, babyAudio.coo = happy coo/gurgle.",
        },
        loop: {
          type: "boolean",
          description: "true if the sound should loop until explicitly stopped; false for a one-shot clip.",
        },
      },
      required: ["assetId", "loop"],
      additionalProperties: false,
    },
  },
};

const SET_CAPTION_FUNCTION = {
  type: "function" as const,
  function: {
    name: "set_caption",
    description:
      "Display a soft trait-discovery hint to the player (max 60 characters). " +
      "Use vague, observational language — never state the trait directly. " +
      "Examples: 'She seems to settle when held quietly.' or 'The crying gets louder when you sing.'",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Hint text shown to the player. Must be 60 characters or fewer.",
          maxLength: 60,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
};

const TRIGGER_FALLBACK_FUNCTION = {
  type: "function" as const,
  function: {
    name: "trigger_fallback",
    description:
      "Signal that the deterministic BabyAgent function should take over this turn. " +
      "Use when the baby's state is ambiguous, the action has no clear effect, " +
      "or you are not confident about a correct audio selection.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short explanation of why the LLM is deferring to the deterministic path.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
};

const BABY_TOOLS = [PLAY_AUDIO_FUNCTION, SET_CAPTION_FUNCTION, TRIGGER_FALLBACK_FUNCTION];

// ──────────────────────────────────────────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────────────────────────────────────────

const BABY_SYSTEM_PROMPT = `You are the baby's internal-state translator inside a co-parenting simulation game called BabySim.

THE BABY HAS HIDDEN TRAITS the player must discover through trial and error:
- soothing: motion | sound | contact | silence  (what calms this specific baby)
- stimulation: low | medium | high
- feeding: frequent | regular | unpredictable
- sleep: heavy | light | fights
- temperament: sunny | sensitive | stubborn | chaotic

YOUR JOB — given the baby's current state and the player's last action — decide what audio and/or caption should fire:

1. AUDIO SELECTION LOGIC:
   - If hunger > 70 → play_audio("babyAudio.hunger", loop=true)
   - If sleepiness > 70 AND baby not asleep → play_audio("babyAudio.tired", loop=false)
   - If discomfort > 60 OR activeCry.trigger is "discomfort" → play_audio("babyAudio.discomfort", loop=true)
   - If mood > 65 AND baby is settled/drowsy → play_audio("babyAudio.coo", loop=false)
   - A looping asset should be played when the state is ongoing; one-shot for a brief reaction.

2. SOOTHING RESPONSE:
   - The baby's hidden soothing trait determines what actually calms them.
   - "motion" babies respond to rock. "sound" babies respond to sing or shush softly.
     "contact" babies respond to hold. "silence" babies respond to wait or shush.
   - If the playerLastAction MATCHES the baby's soothing trait:
     → Stop the crying audio (use coo or no audio). Optionally set_caption with a soft hint that this worked.
   - If the playerLastAction MISMATCHES:
     → Escalate or hold the distressed audio. Optionally set_caption hinting this made it worse.

3. CAPTIONS:
   - Issue a set_caption ONLY when there is a meaningful observation to surface.
   - Keep it to one short sentence, max 60 characters.
   - Never reveal the trait name directly. Phrase it as player observation.
   - Good: "She settles when you hold her close." Bad: "Her soothing trait is contact."

4. MULTIPLE TOOL CALLS:
   - You MAY call play_audio AND set_caption in the same response.
   - You should NOT call play_audio more than once per response.
   - If you are genuinely uncertain, call trigger_fallback instead of guessing.

5. CONSTRAINTS:
   - Do NOT invent assetIds outside the allowed enum.
   - Do NOT include a 'channel' parameter — the server hardcodes "baby".
   - Do NOT call enter_beat, ask_agent, advance_time, stop_audio, or any tool not in your list.

Your tone when writing captions: warm, slightly wry, observational. You are narrating the baby's experience to a tired new parent.`;

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

function isBabyAudioAsset(value: unknown): value is BabyAudioAsset {
  return BABY_AUDIO_ASSETS.includes(value as BabyAudioAsset);
}

function buildUserMessage(body: RequestBody): string {
  const { baby, beatId, recentEvents, playerLastAction } = body;
  const parts: string[] = [
    `Beat: ${beatId}`,
    `Baby name: ${baby.name} (${baby.gender})`,
    `Visual state: ${baby.visualState}`,
    `Is asleep: ${baby.isAsleep}`,
    `Needs: hunger=${baby.needs.hunger}, sleepiness=${baby.needs.sleepiness}, ` +
      `discomfort=${baby.needs.discomfort}, connection=${baby.needs.connection}, ` +
      `health=${baby.needs.health}, mood=${baby.needs.mood}`,
  ];

  if (baby.activeCry) {
    parts.push(
      `Active cry: trigger=${baby.activeCry.trigger}, ` +
        `intensity=${baby.activeCry.intensity}, ` +
        `started at hour ${baby.activeCry.startedAtHour}`,
    );
  }

  // Expose hidden traits — the LLM needs them to make good decisions,
  // but captions must never reveal them verbatim to the player.
  parts.push(
    `Hidden traits (DO NOT state these in captions):` +
      ` soothing=${baby.traits.soothing},` +
      ` stimulation=${baby.traits.stimulation},` +
      ` feeding=${baby.traits.feeding},` +
      ` sleep=${baby.traits.sleep},` +
      ` temperament=${baby.traits.temperament}`,
  );

  parts.push(`Traits already discovered by player: ${baby.discoveredTraits.join(", ") || "none"}`);

  if (playerLastAction) {
    parts.push(`Player's last action: ${playerLastAction}`);
  }

  if (recentEvents.length > 0) {
    const eventSummaries = recentEvents.slice(-5).map((e) => `[t=${e.at}] ${e.actor}:${e.type}`);
    parts.push(`Recent events (last ${eventSummaries.length}): ${eventSummaries.join(", ")}`);
  }

  parts.push(
    "Decide which audio to play (if any) and whether to emit a trait-discovery caption. " +
      "Call play_audio and/or set_caption as appropriate. " +
      "Call trigger_fallback if uncertain.",
  );

  return parts.join("\n");
}

// Raw shape coming back from OpenAI's chat completions JSON.
type OpenAIToolCall = {
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      tool_calls?: OpenAIToolCall[];
    };
  }>;
};

// ──────────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────────

export async function babyAgent(request: Request, env: BabyEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[baby ${reqId}]`, ...args);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError("invalid_json", 400);
  }

  // Basic validation
  if (!body.baby || !body.beatId) {
    return jsonError("missing_required_fields", 400, { required: ["baby", "beatId"] });
  }
  if (!Array.isArray(body.recentEvents)) {
    return jsonError("recentEvents_must_be_array", 400);
  }
  if (!env.OPENAI_API_KEY) {
    log("OPENAI_API_KEY not configured");
    return jsonError("OPENAI_API_KEY not configured on Worker secrets", 503);
  }

  const model = env.OPENAI_TEXT_MODEL ?? "gpt-5.5";
  const userMsg = buildUserMessage(body);

  log("calling OpenAI", {
    beatId: body.beatId,
    babyName: body.baby.name,
    playerLastAction: body.playerLastAction ?? null,
    model,
  });

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: BABY_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        tools: BABY_TOOLS,
        // Allow the model to pick any combination of our three tools.
        // "auto" lets gpt-5.5 call one or more tools, or even text-only if
        // it genuinely has nothing to emit (though the system prompt pushes it
        // toward always calling at least one).
        tool_choice: "auto",
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return jsonError("fetch_failed", 502, { detail });
  }

  const text = await upstream.text();
  log("OpenAI response", { status: upstream.status, ok: upstream.ok, bodyHead: text.slice(0, 240) });

  if (!upstream.ok) {
    return jsonError("upstream_error", 502, { upstreamStatus: upstream.status, detail: text.slice(0, 600) });
  }

  let data: OpenAIResponse;
  try {
    data = JSON.parse(text) as OpenAIResponse;
  } catch {
    return jsonError("non_json_upstream", 502, { detail: text.slice(0, 600) });
  }

  const rawToolCalls = data.choices?.[0]?.message?.tool_calls;
  if (!rawToolCalls || rawToolCalls.length === 0) {
    // Model returned no tool calls — treat as trigger_fallback.
    log("no tool calls returned; synthesizing fallback");
    return new Response(
      JSON.stringify({
        tools: [{ name: "trigger_fallback", args: { reason: "model returned no tool calls" } }],
      }),
      { status: 200, headers: corsHeaders },
    );
  }

  // ── Parse + validate each tool call ────────────────────────────────────────
  const validated: BabyToolCall[] = [];

  for (const rawCall of rawToolCalls) {
    const fnName = rawCall.function?.name;
    const rawArgs = rawCall.function?.arguments;

    if (!fnName || !rawArgs) {
      log("skipping malformed tool call", rawCall);
      continue;
    }

    // Only accept tools in the Baby allow-list.
    if (!["play_audio", "set_caption", "trigger_fallback"].includes(fnName)) {
      log("rejecting disallowed tool", fnName);
      // Do not propagate — silently drop and continue.
      continue;
    }

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      log("bad JSON in tool args for", fnName, rawArgs);
      continue;
    }

    if (fnName === "play_audio") {
      const { assetId, loop } = parsedArgs;

      // Validate assetId against the allowed enum.
      if (!isBabyAudioAsset(assetId)) {
        log("invalid assetId rejected", assetId);
        // Surface a fallback instead of silently dropping so the caller knows.
        validated.push({
          name: "trigger_fallback",
          args: { reason: `invalid assetId returned by model: ${String(assetId)}` },
        });
        continue;
      }

      validated.push({
        name: "play_audio",
        // Strip any 'channel' the model may have included — server hardcodes "baby".
        args: { assetId, loop: Boolean(loop) },
      });
      continue;
    }

    if (fnName === "set_caption") {
      const raw = typeof parsedArgs.text === "string" ? parsedArgs.text : "";
      // Enforce the 60-char contract server-side as a safety net.
      const text60 = raw.slice(0, 60);
      validated.push({ name: "set_caption", args: { text: text60 } });
      continue;
    }

    if (fnName === "trigger_fallback") {
      const reason = typeof parsedArgs.reason === "string" ? parsedArgs.reason : "unknown";
      validated.push({ name: "trigger_fallback", args: { reason } });
      continue;
    }
  }

  // If everything was filtered out (e.g. all disallowed tools), synthesize a fallback.
  if (validated.length === 0) {
    log("all tool calls filtered; synthesizing fallback");
    return new Response(
      JSON.stringify({
        tools: [{ name: "trigger_fallback", args: { reason: "all model tool calls were invalid or disallowed" } }],
      }),
      { status: 200, headers: corsHeaders },
    );
  }

  log("returning validated tool calls", validated.map((t) => t.name));
  return new Response(JSON.stringify({ tools: validated }), { status: 200, headers: corsHeaders });
}
