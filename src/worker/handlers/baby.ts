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

type BabyNeedName = "hunger" | "sleepiness" | "discomfort" | "connection" | "health";
const BABY_NEED_NAMES: BabyNeedName[] = ["hunger", "sleepiness", "discomfort", "connection", "health"];

type BabyVisualStateName = "settled" | "drowsy" | "hungry" | "fussy" | "crying" | "sleep";
const BABY_VISUAL_STATES: BabyVisualStateName[] = ["settled", "drowsy", "hungry", "fussy", "crying", "sleep"];

type AttentionKind = "cry" | "fuss" | "coo";
const ATTENTION_KINDS: AttentionKind[] = ["cry", "fuss", "coo"];

type SetVisualStateArgs = { state: BabyVisualStateName };
type SetMoodDeltaArgs = { delta: number };
type SetNeedDeltaArgs = { need: BabyNeedName; delta: number };
type RequestAttentionArgs = { kind: AttentionKind; intensity: number };
type AcknowledgeActionArgs = { action: string; success: boolean };

type BabyToolCall =
  | { name: "play_audio"; args: PlayAudioArgs }
  | { name: "set_caption"; args: SetCaptionArgs }
  | { name: "trigger_fallback"; args: TriggerFallbackArgs }
  | { name: "set_visual_state"; args: SetVisualStateArgs }
  | { name: "set_mood_delta"; args: SetMoodDeltaArgs }
  | { name: "set_need_delta"; args: SetNeedDeltaArgs }
  | { name: "request_attention"; args: RequestAttentionArgs }
  | { name: "acknowledge_action"; args: AcknowledgeActionArgs };

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

const SET_VISUAL_STATE_FUNCTION = {
  type: "function" as const,
  function: {
    name: "set_visual_state",
    description:
      "Override the baby's rendered visual state in the puppet rig. " +
      "Use when the baby's emotional presentation should visually reflect a state " +
      "that hasn't yet been driven by a needs threshold crossing. " +
      "Examples: the baby just started calming (settled), has been crying a long time (crying), " +
      "or is drifting to sleep (drowsy). " +
      "Do NOT use to contradict an extreme need state already visible (e.g. don't set 'settled' when hunger=90).",
    parameters: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: BABY_VISUAL_STATES,
          description:
            "settled = calm/content, drowsy = sleepy but awake, hungry = fussing from hunger, " +
            "fussy = mildly distressed, crying = actively crying, sleep = asleep.",
        },
      },
      required: ["state"],
      additionalProperties: false,
    },
  },
};

const SET_MOOD_DELTA_FUNCTION = {
  type: "function" as const,
  function: {
    name: "set_mood_delta",
    description:
      "Bump the baby's mood by a signed integer (−20 to +20). " +
      "Mood is a derived composite (0=miserable, 100=content). " +
      "Positive delta when the player does something aligned with the baby's traits. " +
      "Negative delta when the action conflicts. " +
      "The engine clamps the result to [0, 100]. " +
      "Use sparingly — only call when there is a clear personality-driven reason.",
    parameters: {
      type: "object",
      properties: {
        delta: {
          type: "number",
          description: "Signed mood shift. Allowed range: −20 to +20.",
          minimum: -20,
          maximum: 20,
        },
      },
      required: ["delta"],
      additionalProperties: false,
    },
  },
};

const SET_NEED_DELTA_FUNCTION = {
  type: "function" as const,
  function: {
    name: "set_need_delta",
    description:
      "Bump one specific baby need by a signed integer. " +
      "Hunger/sleepiness/discomfort increase toward 100 (worse). " +
      "Connection/health increase toward 100 (better). " +
      "Engine clamps all values to [0, 100]. " +
      "Use when the player's action should have an immediate partial effect " +
      "not yet captured by the deterministic tick — e.g. a perfectly timed feed " +
      "for a frequent-feeder baby warrants a larger hunger drop than the scripted delta.",
    parameters: {
      type: "object",
      properties: {
        need: {
          type: "string",
          enum: BABY_NEED_NAMES,
          description: "Which need to adjust.",
        },
        delta: {
          type: "number",
          description:
            "Signed delta. Negative reduces pressure needs (hunger/sleepiness/discomfort). " +
            "Positive increases connection/health. Keep to ±15 per call.",
          minimum: -30,
          maximum: 30,
        },
      },
      required: ["need", "delta"],
      additionalProperties: false,
    },
  },
};

const REQUEST_ATTENTION_FUNCTION = {
  type: "function" as const,
  function: {
    name: "request_attention",
    description:
      "Signal the UI that the baby is actively soliciting player engagement. " +
      "This surfaces an attention hint near the baby visual so the player knows to act. " +
      "'cry' = urgent distress signal, 'fuss' = mild whimper/restlessness, " +
      "'coo' = happy babbling (reward signal, low urgency). " +
      "intensity is 1–10, where 10 is the most insistent. " +
      "Call this when the baby's needs are escalating but the player hasn't acted yet.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ATTENTION_KINDS,
          description: "cry = urgent cry, fuss = mild fuss, coo = happy vocalization.",
        },
        intensity: {
          type: "number",
          description: "Signal intensity 1–10.",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["kind", "intensity"],
      additionalProperties: false,
    },
  },
};

const ACKNOWLEDGE_ACTION_FUNCTION = {
  type: "function" as const,
  function: {
    name: "acknowledge_action",
    description:
      "Confirm whether the player's last action helped this specific baby. " +
      "Drives a floating feedback badge (+N / −N) near the action button in the UI. " +
      "success=true when the action matched the baby's hidden soothing / feeding / sleep traits. " +
      "success=false when it conflicted or was neutral. " +
      "Always call this after a player soothing action so the feedback loop is clear.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The GameAction string the player just performed (e.g. 'rock', 'feed', 'sing').",
        },
        success: {
          type: "boolean",
          description: "true if the action helped; false if it was neutral or made things worse.",
        },
      },
      required: ["action", "success"],
      additionalProperties: false,
    },
  },
};

const BABY_TOOLS = [
  PLAY_AUDIO_FUNCTION,
  SET_CAPTION_FUNCTION,
  TRIGGER_FALLBACK_FUNCTION,
  SET_VISUAL_STATE_FUNCTION,
  SET_MOOD_DELTA_FUNCTION,
  SET_NEED_DELTA_FUNCTION,
  REQUEST_ATTENTION_FUNCTION,
  ACKNOWLEDGE_ACTION_FUNCTION,
];

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

YOUR JOB — given the baby's current state and the player's last action — decide which combination of the 7 tools to call:

──────────────────────────────────────────────────────────
TOOL USAGE GUIDE
──────────────────────────────────────────────────────────

1. play_audio — AUDIO SELECTION (unchanged rules):
   - hunger > 70 → play_audio("babyAudio.hunger", loop=true)
   - sleepiness > 70, baby awake → play_audio("babyAudio.tired", loop=false)
   - discomfort > 60 OR activeCry.trigger="discomfort" → play_audio("babyAudio.discomfort", loop=true)
   - mood > 65, settled/drowsy → play_audio("babyAudio.coo", loop=false)
   - loop=true for sustained states; loop=false for brief reactions.
   - At most one play_audio per response.

2. set_caption — TRAIT-DISCOVERY HINT:
   - Issue ONLY when there is something meaningful to observe. Max 60 chars.
   - Never name the trait. Phrase as player observation.
   - Good: "She settles when you hold her close." Bad: "Her soothing trait is contact."

3. set_visual_state — PUPPET RIG:
   - Call when the baby's visual should change to reflect what the player's action caused,
     faster than a need-threshold would naturally trigger it.
   - Soothing match → "settled" or "drowsy". Mismatch with active cry → "crying" or "fussy".
   - Do NOT contradict an extreme need state (e.g. hunger=95 → keep "crying").

4. set_mood_delta — PERSONALITY MICRO-BUMP (±1 to ±20):
   - Call when player's action clearly aligned or misaligned with the baby's temperament/traits.
   - Positive: action matched soothing style or feeding timing. Negative: mismatched.
   - Keep deltas small (±5 to ±15) to stay consultative.

5. set_need_delta — NEED FINE-TUNING (±1 to ±15 recommended):
   - Call when the player's action warrants a need shift beyond what the deterministic engine gave.
   - Example: feed + frequent-feeder → larger hunger reduction than base. hold + contact-soothed → more connection gain.
   - Engine clamps to [0, 100]. Use sparingly: only when trait-driven logic clearly justifies the delta.

6. request_attention — URGENCY SIGNAL:
   - Call when needs are escalating and the player hasn't responded yet.
   - kind: "cry" (hunger>70 or discomfort>70), "fuss" (50–70 range), "coo" (reward/mood>70).
   - intensity: 1–10. Use intensity 7–10 only for multi-need crises.
   - On BEAT_ENTERED events (no playerLastAction): always call request_attention to announce the baby's current state.

7. acknowledge_action — FEEDBACK BADGE:
   - Call WHENEVER playerLastAction is set (i.e. a soothing action was taken).
   - success=true if action matched baby's soothing/feeding/sleep trait and the baby calmed.
   - success=false if action mismatched or was neutral/worsening.
   - This drives the floating "+5" / "-2" badge near the action button.

──────────────────────────────────────────────────────────
SOOTHING RESPONSE RULES
──────────────────────────────────────────────────────────
- "motion" babies: rock > hold > shush > sing. Silence makes them worse.
- "sound" babies: sing > shush > rock. Motion-only without sound is neutral.
- "contact" babies: hold > rock. Shush/sing without touch is neutral.
- "silence" babies: wait > shush > hold. Singing escalates distress.

If playerLastAction MATCHES soothing trait:
  → set_visual_state("settled" or "drowsy"), set_mood_delta(+8 to +15), acknowledge_action(success=true),
    play_audio("babyAudio.coo", loop=false) if baby was crying, optional set_caption.

If playerLastAction MISMATCHES soothing trait:
  → set_visual_state("fussy" or "crying"), set_mood_delta(-5 to -12), acknowledge_action(success=false),
    optionally set_caption hinting it made things worse. Do NOT escalate audio if baby was already quiet.

──────────────────────────────────────────────────────────
BEAT_ENTERED RULES (no playerLastAction)
──────────────────────────────────────────────────────────
- Always call request_attention with the most urgent need.
- Call set_visual_state if it differs from the current visualState.
- Optionally set_caption to establish scene context.
- Do NOT call acknowledge_action (no player action to evaluate).

──────────────────────────────────────────────────────────
CONSTRAINTS
──────────────────────────────────────────────────────────
- Do NOT invent assetIds outside the allowed enum.
- Do NOT include a 'channel' parameter — the server hardcodes "baby".
- Do NOT call enter_beat, stop_audio, ask_agent, advance_time, or tools not in your list.
- At most one play_audio, one set_visual_state, one set_mood_delta per response.
- set_need_delta may be called once per need (max two needs per response).
- If genuinely uncertain across all signals, call trigger_fallback.

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

  const isActionTurn = !!playerLastAction;
  parts.push(
    isActionTurn
      ? `Evaluate the player's action ('${playerLastAction}') against the baby's hidden traits. ` +
        "Call acknowledge_action, adjust visual state and needs as appropriate, " +
        "select audio, and optionally emit a caption."
      : "This is a beat-entry or tick event (no player action). " +
        "Call request_attention to announce the baby's state, adjust visual state if needed, " +
        "and optionally emit a caption. Do NOT call acknowledge_action.",
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
        // "auto" lets gpt-5.5 call one or more tools, or even text-only if
        // it genuinely has nothing to emit (though the system prompt pushes it
        // toward always calling at least one).
        tool_choice: "auto",
        // gpt-5.5 only supports the default temperature (1). Setting 0.6 returns
        // "Unsupported value: 'temperature' does not support 0.6 with this model."
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

    const ALLOWED_TOOLS = [
      "play_audio",
      "set_caption",
      "trigger_fallback",
      "set_visual_state",
      "set_mood_delta",
      "set_need_delta",
      "request_attention",
      "acknowledge_action",
    ];

    // Only accept tools in the Baby allow-list.
    if (!ALLOWED_TOOLS.includes(fnName)) {
      log("rejecting disallowed tool", fnName);
      // Silently drop; don't propagate unknown tool names.
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

    if (fnName === "set_visual_state") {
      const vs = parsedArgs.state;
      if (!BABY_VISUAL_STATES.includes(vs as BabyVisualStateName)) {
        log("invalid visual state rejected", vs);
        continue;
      }
      validated.push({ name: "set_visual_state", args: { state: vs as BabyVisualStateName } });
      continue;
    }

    if (fnName === "set_mood_delta") {
      const raw = typeof parsedArgs.delta === "number" ? parsedArgs.delta : NaN;
      if (isNaN(raw)) {
        log("invalid mood delta rejected", parsedArgs.delta);
        continue;
      }
      // Clamp to declared schema bounds.
      const delta = Math.max(-20, Math.min(20, raw));
      validated.push({ name: "set_mood_delta", args: { delta } });
      continue;
    }

    if (fnName === "set_need_delta") {
      const need = parsedArgs.need;
      const raw = typeof parsedArgs.delta === "number" ? parsedArgs.delta : NaN;
      if (!BABY_NEED_NAMES.includes(need as BabyNeedName) || isNaN(raw)) {
        log("invalid set_need_delta rejected", { need, delta: parsedArgs.delta });
        continue;
      }
      // Clamp to schema bounds.
      const delta = Math.max(-30, Math.min(30, raw));
      validated.push({ name: "set_need_delta", args: { need: need as BabyNeedName, delta } });
      continue;
    }

    if (fnName === "request_attention") {
      const kind = parsedArgs.kind;
      const raw = typeof parsedArgs.intensity === "number" ? parsedArgs.intensity : NaN;
      if (!ATTENTION_KINDS.includes(kind as AttentionKind) || isNaN(raw)) {
        log("invalid request_attention rejected", { kind, intensity: parsedArgs.intensity });
        continue;
      }
      const intensity = Math.max(1, Math.min(10, Math.round(raw)));
      validated.push({ name: "request_attention", args: { kind: kind as AttentionKind, intensity } });
      continue;
    }

    if (fnName === "acknowledge_action") {
      const action = typeof parsedArgs.action === "string" ? parsedArgs.action : "";
      const success = Boolean(parsedArgs.success);
      if (!action) {
        log("acknowledge_action missing action string");
        continue;
      }
      validated.push({ name: "acknowledge_action", args: { action, success } });
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
