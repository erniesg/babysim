// ElevenLabs TTS endpoint — used by Mode C (gpt-5.5 + tools): the officer
// agent calls elevenlabs_tts(text, voice_id) as a tool, the browser hits this
// endpoint to fetch the rendered MP3, and the muppet plays it.

export interface ElevenLabsEnv {
  ELEVENLABS_API_KEY?: string;
}

const VOICE_FOR_OFFICER: Record<string, string> = {
  // Stable voice IDs from ElevenLabs's default voice library. The officer
  // archetype maps to a distinct timbre so Tan/Lim/Wong sound different.
  Tan: "TX3LPaxmHKxFdv7VOQHJ", // Liam — deeper male UK
  Lim: "EXAVITQu4vr4xnSDxMaL", // Sarah — brisk, mid-range
  Wong: "JBFqnCBsd6RMkjVDRZzb", // George — warm, mid pitch
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=3600",
};

export async function officerTtsHandler(request: Request, env: ElevenLabsEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[officer-tts ${reqId}]`, ...args);

  if (!env.ELEVENLABS_API_KEY) {
    log("no ELEVENLABS_API_KEY");
    return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: { text?: string; officer?: "Tan" | "Lim" | "Wong"; voiceId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const text = (body.text ?? "").slice(0, 1200);
  if (!text.trim()) {
    return new Response(JSON.stringify({ error: "missing text" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const voiceId = body.voiceId || (body.officer && VOICE_FOR_OFFICER[body.officer]) || VOICE_FOR_OFFICER.Tan;
  log("synthesizing", { officer: body.officer, voiceId, textLen: text.length });

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
        }),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("upstream error", { status: upstream.status, body: errText.slice(0, 400) });
      return new Response(
        JSON.stringify({ error: "upstream_error", status: upstream.status, detail: errText.slice(0, 600) }),
        { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const audio = await upstream.arrayBuffer();
    log("synthesized ok", { byteLength: audio.byteLength });
    return new Response(audio, {
      status: 200,
      headers: { ...corsHeaders, "content-type": "audio/mpeg" },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return new Response(JSON.stringify({ error: "fetch_failed", detail }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
}
