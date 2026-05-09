// Officer agent: gpt-5.5 with a rich tool-calling surface. Runs in the Worker.
// Tools: say, set_expression, play_gesture, warn_player, start_challenge, advance_phase, request_player_input.

export interface OfficerEnv {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
}

// ── Tool argument types ────────────────────────────────────────────────────────

type SayArgs = {
  text: string;
  expression: "strict" | "warm" | "skeptical" | "delighted";
  gesture: "stamp" | "lean" | "nod" | "wave" | "point" | "none";
};

type SetExpressionArgs = {
  expression: "strict" | "warm" | "skeptical" | "delighted";
};

type PlayGestureArgs = {
  gesture: "stamp" | "lean" | "nod" | "wave" | "point" | "none";
};

type WarnPlayerArgs = {
  text: string;
  severity: "note" | "stern" | "final";
};

type StartChallengeArgs = {
  challenge: "rps" | "voice" | "keymash" | "konami";
};

type AdvancePhaseArgs = {
  to: string;
};

type RequestPlayerInputArgs = {
  kind: "confirm" | "choice" | "text";
  prompt: string;
};

export type OfficerToolCall =
  | { name: "say"; args: SayArgs }
  | { name: "set_expression"; args: SetExpressionArgs }
  | { name: "play_gesture"; args: PlayGestureArgs }
  | { name: "warn_player"; args: WarnPlayerArgs }
  | { name: "start_challenge"; args: StartChallengeArgs }
  | { name: "advance_phase"; args: AdvancePhaseArgs }
  | { name: "request_player_input"; args: RequestPlayerInputArgs };

// ── Request body ───────────────────────────────────────────────────────────────

type RequestBody = {
  beatId: "officer_intro" | "ominous_warning" | "verdict";
  officerName: "Officer Ernest" | "Officer Bern" | "Officer Crumb" | "Officer Tan" | "Officer Lim" | "Officer Wong";
  ledger?: {
    playerNightShifts: number;
    partnerNightShifts: number;
    playerShirks: number;
    partnerShirks: number;
    playerSoothes: number;
    partnerSoothes: number;
  };
  partnerName?: string;
  babyName?: string;
};

// ── OpenAI tool definitions ────────────────────────────────────────────────────

const EXPRESSION_ENUM = ["strict", "warm", "skeptical", "delighted"];
const GESTURE_ENUM = ["stamp", "lean", "nod", "wave", "point", "none"];

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "say",
      description:
        "Officer delivers a line of dialogue with one expression and one gesture. The muppet renderer will read the text aloud and animate the chosen expression + gesture. Use this when the officer needs to speak.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The line the officer speaks. 1-3 sentences, in character. No stage directions.",
          },
          expression: { type: "string", enum: EXPRESSION_ENUM },
          gesture: { type: "string", enum: GESTURE_ENUM },
        },
        required: ["text", "expression", "gesture"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_expression",
      description:
        "Silently flip the officer's expression without speaking. Useful between lines to telegraph mood changes before a say() call.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", enum: EXPRESSION_ENUM },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "play_gesture",
      description:
        "Trigger a gesture on the muppet without speaking. Use for physical reactions to player actions.",
      parameters: {
        type: "object",
        properties: {
          gesture: { type: "string", enum: GESTURE_ENUM },
        },
        required: ["gesture"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "warn_player",
      description:
        "Fire an OfficerWarning banner during gameplay. Severity: 'note' for mild observations, 'stern' for second-warning tone, 'final' for last-chance ultimatum. Does NOT advance the beat.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The warning text shown in the banner. 1-2 sentences max.",
          },
          severity: { type: "string", enum: ["note", "stern", "final"] },
        },
        required: ["text", "severity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "start_challenge",
      description:
        "Kick off a verification mini-game round. The player must complete the challenge before the intake continues.",
      parameters: {
        type: "object",
        properties: {
          challenge: { type: "string", enum: ["rps", "voice", "keymash", "konami"] },
        },
        required: ["challenge"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "advance_phase",
      description:
        "Request the engine to enter a specific beat. The engine will validate this against the current beat's possibleNextBeats and silently reject illegal transitions.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "The beatId to transition into (e.g. 'photo_intake', 'ominous_warning', 'verdict').",
          },
        },
        required: ["to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_player_input",
      description:
        "Open a modal asking the player to confirm something or provide input. Does not advance the beat automatically — waits for player response.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["confirm", "choice", "text"] },
          prompt: {
            type: "string",
            description: "The question or instruction shown to the player in the modal.",
          },
        },
        required: ["kind", "prompt"],
        additionalProperties: false,
      },
    },
  },
] as const;

// ── System prompts per beat ────────────────────────────────────────────────────

// Per-character voice profiles. Inserted into every system prompt so each
// officer sounds distinct. The user's complaint: "they're all speaking in
// too good English" → Crumb now talks Singlish, Bern severe-clinical, Ernest
// dry-mischievous. Character is read from body.officerName at request time.
function voiceProfileFor(officerName: string): string {
  if (officerName.includes("Bern")) {
    return `VOICE: Bern is severe, surgical, slow. Lower register. Speaks in short clipped declaratives. Dry humor lands in pauses, not jokes. Occasionally lets a single weary sigh slip ("...mm.") between sentences. NEVER warm. Vocabulary: clinical, bureaucratic. Avoid contractions when delivering rulings; use them when he's tired.`;
  }
  if (officerName.includes("Crumb")) {
    return `VOICE: Crumb is chaotic-friendly, talks SINGLISH (Singapore English) — informal, fast, with sentence-final particles. Use natural Singlish: "lah", "lor", "leh", "ah", "sia", "can or not", "you know lah", "wait ah", "die already", "alamak", "aiyoh". Drop articles ("intake desk got problem ah"), use repeated verbs ("walk walk", "see see"), occasional code-switch ("the baby very kelam-kabut one"). DO NOT overload — one or two Singlish markers per sentence is plenty. Crumb is warm-undermining, not stern; he gossips about the file like a kopitiam uncle.`;
  }
  return `VOICE: Ernest is playful, mid-deep, mischievous. Slight UK lilt. Uses dry asides and undermining bureaucratese — speaks the rules then immediately questions them ("...whatever 'a clean ledger' means at 2am"). Casual contractions. Occasional self-deprecating beats ("fluorescent lights work overtime, just like the rest of us").`;
}

// Tiny variety nudge — different opening hooks so the line doesn't feel baked.
// gpt-5.5 only supports temperature=1, so we lean on prompt diversity instead.
function varietyNudgeFor(beatId: RequestBody["beatId"]): string {
  const intros = [
    "Open with a beat about the room (the lights, the file pile, the chair).",
    "Open with a beat about the applicant's posture or expression.",
    "Open with a beat about the partner's name or the baby's name.",
    "Open with a beat about how many cases you've seen today.",
    "Open with a beat about the time of day / the smell of the office / the broken AC.",
  ];
  const warnings = [
    "Lead with a single concrete number from the ledger, then the warning.",
    "Lead with a metaphor — sleep as currency, attention as ledger ink.",
    "Lead with a small anecdote about a previous applicant, no names.",
    "Lead with a clinical observation about the room.",
  ];
  const verdicts = [
    "Open with the applicant's posture as you read the file.",
    "Open with one number from the ledger before the verdict.",
    "Open with a single weary line about your own day.",
  ];
  const pool = beatId === "officer_intro" ? intros : beatId === "ominous_warning" ? warnings : verdicts;
  return `VARIETY: ${pool[Math.floor(Math.random() * pool.length)]}`;
}

function systemPromptFor(beatId: RequestBody["beatId"], officerName: string): string {
  const voice = voiceProfileFor(officerName);
  const variety = varietyNudgeFor(beatId);
  const base = `You are an officer of a fictional Ministry of Family and Human Development in a stylized 1970s East Asian state-drama setting. Tone: bureaucratic, ominous, slightly absurd, dry-funny — never cruel.\n\n${voice}\n\n${variety}\n\nCRITICAL: Do NOT introduce yourself by name or rank. Do NOT say your own name, your rank, the ministry name, or any version of "I am Officer X". The player already knows who you are. Just speak.`;

  if (beatId === "officer_intro") {
    return `${base}\n\nYou have these tools: say(), set_expression(), play_gesture(), warn_player(), start_challenge(), advance_phase(), request_player_input().\n\nFor the intro, deliver ONE say() call. 1-2 sentences max. Speak directly to the applicant. Land the voice in the first six words.\n\nPick the expression that fits: strict (default), skeptical (suspicious), warm (rare). Gesture: stamp (definitive), lean (interrogating), nod (acknowledging), wave (dismissive), point (accusing), none.\n\nCall say() exactly once. No text outside the tool call.`;
  }
  if (beatId === "ominous_warning") {
    return `${base}\n\nDeliver ONE warning via say() — make clear that care labor, shirking, and night shifts are recorded. 1-2 sentences. Tone: clinical menace, in-character.\n\nYou may optionally follow say() with a warn_player() call to reinforce the point via a gameplay banner.\n\nUse skeptical or strict expression and a lean gesture by default.\n\nCall say() exactly once, then optionally warn_player() once.`;
  }
  return `${base}\n\nReturning to deliver a verdict. The applicant's ledger is provided. Reflect their actual record:\n- If playerShirks ≥ 3 OR playerSoothes much less than partnerSoothes: strict/skeptical, hold for review.\n- If playerNightShifts ≥ 2 AND playerSoothes ≥ 4: delighted/warm, provisional approval.\n- Otherwise: warm, "reviewable, not yet alarming", provisional approval with notes.\n\nReference at least one specific number from the ledger so the verdict feels personal. DO use the baby's name and the partner's name (provided in the user message). Max 2 sentences.\n\nYou may call set_expression() before say() to telegraph your mood, then call say() exactly once. Optionally follow with advance_phase({ to: "debrief_card" }).`;
}

// ── CORS headers ───────────────────────────────────────────────────────────────

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

// ── Main handler ───────────────────────────────────────────────────────────────

export async function officerAgent(request: Request, env: OfficerEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[officer ${reqId}]`, ...args);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError("invalid json", 400);
  }

  if (!body.beatId || !body.officerName) {
    return jsonError("missing beatId or officerName", 400);
  }
  if (!env.OPENAI_API_KEY) {
    log("OPENAI_API_KEY not configured");
    return jsonError("OPENAI_API_KEY not configured on Worker secrets", 503);
  }

  const userMsg = buildUserMessage(body);
  const systemPrompt = systemPromptFor(body.beatId, body.officerName);
  const model = env.OPENAI_TEXT_MODEL || "gpt-5.5";

  log("calling OpenAI", { beatId: body.beatId, officer: body.officerName, model });

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        // gpt-5.5 only supports the default temperature (1). Setting 0.4 returns
        // "Unsupported value: 'temperature' does not support 0.4 with this model."
        // Stage-direction predictability comes from the system prompt + tool schema.
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        tools: TOOLS,
        // No forced tool_choice — let the model pick from all 7 tools.
        // The system prompt constrains which tools are appropriate per beat.
      }),
    });

    const text = await upstream.text();
    log("OpenAI response", { status: upstream.status, ok: upstream.ok, bodyHead: text.slice(0, 240) });

    if (!upstream.ok) {
      return jsonError("upstream_error", 502, { upstreamStatus: upstream.status, detail: text.slice(0, 600) });
    }

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
      data = JSON.parse(text);
    } catch {
      return jsonError("non_json_upstream", 502, { detail: text.slice(0, 600) });
    }

    const rawCalls = data.choices?.[0]?.message?.tool_calls ?? [];
    if (rawCalls.length === 0) {
      return jsonError("no_tool_calls", 502, { raw: data });
    }

    // Parse each tool call; silently drop malformed ones so a single bad call
    // doesn't void the entire response.
    const tools: OfficerToolCall[] = [];
    for (const raw of rawCalls) {
      const name = raw.function?.name;
      const argsStr = raw.function?.arguments;
      if (!name || !argsStr) continue;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsStr) as Record<string, unknown>;
      } catch {
        log("skipping malformed tool args", { name, argsStr });
        continue;
      }
      tools.push({ name, args } as OfficerToolCall);
    }

    if (tools.length === 0) {
      return jsonError("no_valid_tool_calls", 502, { rawCount: rawCalls.length });
    }

    log("tools parsed", tools.map((t) => t.name));
    return new Response(JSON.stringify({ tools }), { status: 200, headers: corsHeaders });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return jsonError("fetch_failed", 502, { detail });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildUserMessage(body: RequestBody): string {
  const parts: string[] = [`Beat: ${body.beatId}`, `Officer: ${body.officerName}`];
  if (body.babyName) parts.push(`Baby name: ${body.babyName}`);
  if (body.partnerName) parts.push(`Co-parent name: ${body.partnerName}`);
  if (body.ledger) {
    parts.push(`Fairness ledger: ${JSON.stringify(body.ledger)}`, "Reference numbers from the ledger if relevant.");
  }
  return parts.join("\n");
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...(extra ?? {}) }), { status, headers: corsHeaders });
}
