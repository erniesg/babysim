// Generic SFX endpoint — calls ElevenLabs text_to_sound_v2 with a free-form
// prompt the agent dictates. Used by the baby agent's play_sfx tool to spawn
// atmosphere on demand (door slam, traffic, kettle, etc) — not just baby cries.

export interface SfxEnv {
  ELEVENLABS_API_KEY?: string;
}

const corsHeaders = { "access-control-allow-origin": "*" };

export async function sfxHandler(request: Request, env: SfxEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[sfx ${reqId}]`, ...args);

  if (!env.ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: { prompt?: string; durationSeconds?: number; loop?: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const prompt = (body.prompt ?? "").trim();
  if (prompt.length < 4) {
    return new Response(JSON.stringify({ error: "prompt too short" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  const durationSeconds = typeof body.durationSeconds === "number"
    ? Math.min(Math.max(body.durationSeconds, 1), 22)
    : 4;
  const loop = Boolean(body.loop);

  log("generating sfx", { promptHead: prompt.slice(0, 80), durationSeconds, loop });

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
          text: prompt.slice(0, 600),
          model_id: "eleven_text_to_sound_v2",
          duration_seconds: durationSeconds,
          loop,
          prompt_influence: 0.4,
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
    log("sfx ok", { byteLength: audio.byteLength });
    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=600",
      },
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
