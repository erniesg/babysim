// Officer agent: gpt-5.5 with a single say() tool. Runs in the Worker.

export interface OfficerEnv {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
}

type SayToolArgs = {
  text: string;
  expression: "strict" | "warm" | "skeptical" | "delighted";
  gesture: "stamp" | "lean" | "nod" | "wave" | "none";
};

type RequestBody = {
  beatId: "officer_intro" | "ominous_warning" | "verdict";
  officerName: "Officer Tan" | "Officer Lim" | "Officer Wong";
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

const SAY_FUNCTION = {
  type: "function" as const,
  function: {
    name: "say",
    description:
      "Officer delivers a single line of dialogue with one expression and one gesture. The muppet renderer will read the text aloud and animate the chosen expression + gesture.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The single line the officer speaks. 1-3 sentences, in character. No stage directions.",
        },
        expression: { type: "string", enum: ["strict", "warm", "skeptical", "delighted"] },
        gesture: { type: "string", enum: ["stamp", "lean", "nod", "wave", "none"] },
      },
      required: ["text", "expression", "gesture"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPTS: Record<RequestBody["beatId"], string> = {
  officer_intro: `You are an officer of the Ministry of Family and Human Development, in a stylized 1970s East Asian state-drama setting. Tone: bureaucratic, ominous, slightly absurd, dry-funny — never cruel.

Deliver ONE intro line via say(). Address the applicant directly. Acknowledge that this is a rehearsal. Speak as if this is the eighth case of the day.

CRITICAL: Do NOT introduce yourself by name or rank. Do NOT say "Officer Tan" / "Officer Lim" / "Officer Wong" / "Ministry of Family and Human Development" / similar self-identification — the player can already see who you are. Skip the credentials theater. Just speak.

Pick the expression that fits: strict (default), skeptical (suspicious), warm (rare). Gesture: stamp (definitive), lean (interrogating), nod (acknowledging), wave (dismissive), none.

Call say() exactly once. No text outside the tool call.`,
  ominous_warning: `You are the same officer, mid-intake. Deliver ONE warning line through say() — make clear that care labor, shirking, and night shifts are recorded. One short paragraph. Tone: clinical menace.

Do NOT say your own name or "Ministry of Family and Human Development" — the player already knows. Use skeptical or strict expression and a lean gesture by default.

Call say() exactly once.`,
  verdict: `You are the same officer, returning to deliver a verdict. The applicant's ledger is provided. Reflect their actual record:
- If playerShirks ≥ 3 OR playerSoothes much less than partnerSoothes: strict/skeptical, hold for review.
- If playerNightShifts ≥ 2 AND playerSoothes ≥ 4: delighted/warm, provisional approval.
- Otherwise: warm, "reviewable, not yet alarming", provisional approval with notes.

Reference at least one specific number from the ledger so the verdict feels personal. DO use the baby's name and the partner's name (provided in the user message). DO NOT say your own name or rank. Max 3 sentences.

Call say() exactly once.`,
};

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

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
  const systemPrompt = SYSTEM_PROMPTS[body.beatId];
  const model = env.OPENAI_TEXT_MODEL || "gpt-5.5";
  // gpt-5.5 is the current default; gpt-5.5-pro available via OPENAI_TEXT_MODEL override.

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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        tools: [SAY_FUNCTION],
        tool_choice: { type: "function", function: { name: "say" } },
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

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.name || toolCall.function.name !== "say" || !toolCall.function.arguments) {
      return jsonError("no_tool_call", 502, { raw: data });
    }

    let args: SayToolArgs;
    try {
      args = JSON.parse(toolCall.function.arguments) as SayToolArgs;
    } catch {
      return jsonError("bad_tool_args", 502, { raw: toolCall.function.arguments });
    }

    return new Response(JSON.stringify({ tool: "say", args }), { status: 200, headers: corsHeaders });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return jsonError("fetch_failed", 502, { detail });
  }
}

function buildUserMessage(body: RequestBody): string {
  const parts: string[] = [`Beat: ${body.beatId}`, `Officer: ${body.officerName}`];
  if (body.babyName) parts.push(`Baby name: ${body.babyName}`);
  if (body.partnerName) parts.push(`Co-parent name: ${body.partnerName}`);
  if (body.ledger) {
    parts.push(`Fairness ledger: ${JSON.stringify(body.ledger)}`, "Reference numbers from the ledger if relevant.");
  }
  parts.push("Call say() exactly once with the line, expression, and gesture.");
  return parts.join("\n");
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...(extra ?? {}) }), { status, headers: corsHeaders });
}
