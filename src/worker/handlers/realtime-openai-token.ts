// OpenAI Realtime ephemeral key endpoint.

export interface OpenAITokenEnv {
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_MODEL?: string;
}

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

export async function openaiTokenHandler(_request: Request, env: OpenAITokenEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[openai-token ${reqId}]`, ...args);

  if (!env.OPENAI_API_KEY) {
    log("no OPENAI_API_KEY");
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), { status: 503, headers: corsHeaders });
  }
  const model = env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  log("minting ephemeral", { model });

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, voice: "verse", modalities: ["audio", "text"] }),
    });
    const text = await upstream.text();
    log("upstream", { status: upstream.status, ok: upstream.ok, bodyHead: text.slice(0, 400) });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: "upstream_error", status: upstream.status, detail: text.slice(0, 600) }),
        { status: 502, headers: corsHeaders },
      );
    }

    let data: { client_secret?: { value?: string; expires_at?: number }; model?: string };
    try {
      data = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "non_json_upstream", detail: text.slice(0, 400) }), { status: 502, headers: corsHeaders });
    }
    if (!data.client_secret?.value) {
      return new Response(JSON.stringify({ error: "no_client_secret", raw: data }), { status: 502, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ client_secret: data.client_secret, model: data.model || model }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fetch threw", detail);
    return new Response(JSON.stringify({ error: "fetch_failed", detail }), { status: 502, headers: corsHeaders });
  }
}
