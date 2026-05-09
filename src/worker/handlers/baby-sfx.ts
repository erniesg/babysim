// Baby SFX endpoint — calls ElevenLabs text_to_sound_v2 with cry-style prompts.
// Returns audio/mpeg bytes, cached 1h keyed off trigger.
// On upstream failure returns 503 so the frontend can use pre-baked clips.

export interface BabySfxEnv {
  ELEVENLABS_API_KEY?: string;
}

type BabyTrigger = "hunger" | "tired" | "discomfort" | "coo";

// Prompts landed from scripts/generate-baby-sounds.mjs (elevenPrompt values).
const SFX_PROMPTS: Record<BabyTrigger, string> = {
  hunger:     "newborn 0-8 weeks, rhythmic hunger fuss, soft wail with brief silence, no adult voice or music, close-mic",
  tired:      "newborn 0-8 weeks, sleepy tired whimper, half-cry winding down, no adult voice or music, close-mic",
  discomfort: "newborn 0-8 weeks, strained discomfort cry, not screaming, distressed but not peak, close-mic",
  coo:        "newborn 0-8 weeks, contented coo and gurgle, gentle baby vocalization, no crying, close-mic",
};

const VALID_TRIGGERS = new Set<BabyTrigger>(["hunger", "tired", "discomfort", "coo"]);

const corsHeaders = {
  "access-control-allow-origin": "*",
};

export async function babySfxHandler(request: Request, env: BabySfxEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[baby-sfx ${reqId}]`, ...args);

  if (!env.ELEVENLABS_API_KEY) {
    log("no ELEVENLABS_API_KEY");
    return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: { trigger?: string; durationSeconds?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const trigger = body.trigger as BabyTrigger | undefined;
  if (!trigger || !VALID_TRIGGERS.has(trigger)) {
    return new Response(
      JSON.stringify({ error: "invalid trigger", valid: Array.from(VALID_TRIGGERS) }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const durationSeconds = typeof body.durationSeconds === "number"
    ? Math.min(Math.max(body.durationSeconds, 1), 22)
    : 3;

  log("generating sfx", { trigger, durationSeconds });

  try {
    const upstream = await fetch(
      "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: SFX_PROMPTS[trigger],
          model_id: "eleven_text_to_sound_v2",
          duration_seconds: durationSeconds,
          loop: false,
          prompt_influence: 0.45,
        }),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("upstream error", { status: upstream.status, body: errText.slice(0, 400) });
      return new Response(
        JSON.stringify({ error: "upstream_error", status: upstream.status, detail: errText.slice(0, 600) }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const audio = await upstream.arrayBuffer();
    log("sfx ok", { trigger, byteLength: audio.byteLength });
    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return new Response(JSON.stringify({ error: "fetch_failed", detail }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
}
