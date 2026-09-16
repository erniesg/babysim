// Gemini Live token endpoint. Tries the v1alpha auth_tokens endpoint first; on
// failure, returns the master key with a clear, surfaced reason. Verbose
// console.log shows up in `wrangler tail` for live debug.

export interface GeminiTokenEnv {
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  GEMINI_TEXT_MODEL?: string;
}

const TOKEN_TTL_SECONDS = 60 * 25;
const SESSION_TTL_SECONDS = 60 * 60;
const GEMINI_AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

function modelResourceName(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export function buildGeminiAuthTokenRequest(apiKey: string, liveModel: string, nowMs = Date.now()) {
  const expireTime = new Date(nowMs + TOKEN_TTL_SECONDS * 1000).toISOString();
  const newSessionExpireTime = new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString();

  return {
    url: `${GEMINI_AUTH_TOKENS_URL}?key=${encodeURIComponent(apiKey)}`,
    expireTime,
    body: {
      expireTime,
      uses: 1,
      newSessionExpireTime,
      // Raw REST uses the API field name. The SDK's liveConnectConstraints
      // option is transformed into this shape before it hits the endpoint.
      bidiGenerateContentSetup: {
        model: modelResourceName(liveModel),
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
      },
    },
  };
}

export async function geminiTokenHandler(request: Request, env: GeminiTokenEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[gemini-token ${reqId}]`, ...args);

  log("incoming", { method: request.method, url: request.url });

  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    log("no GEMINI_API_KEY/GOOGLE_API_KEY in env");
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY/GOOGLE_API_KEY not configured on Worker secrets" }),
      { status: 503, headers: corsHeaders },
    );
  }
  log("api key present", {
    length: apiKey.length,
    prefix: apiKey.slice(0, 6),
    source: env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GOOGLE_API_KEY",
  });

  const liveModel = env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
  const fallbackModel = env.GEMINI_TEXT_MODEL || "gemini-3.1-flash";

  try {
    const { url, body: tokenBody, expireTime } = buildGeminiAuthTokenRequest(apiKey, liveModel);
    log("calling auth_tokens", url.replace(apiKey, "<redacted>"));
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tokenBody),
    });
    const text = await upstream.text();
    log("auth_tokens response", { status: upstream.status, ok: upstream.ok, bodyHead: text.slice(0, 400) });

    if (upstream.ok) {
      let parsed: { name?: string; token?: string; ephemeralToken?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        log("auth_tokens body not JSON");
        parsed = {};
      }
      const token = parsed.ephemeralToken || parsed.token || parsed.name;
      if (token) {
        log("ephemeral token issued", { len: token.length });
        return new Response(
          JSON.stringify({
            ephemeralToken: token,
            model: liveModel,
            source: "auth_token_v1alpha",
            expiresAt: expireTime,
          }),
          { status: 200, headers: corsHeaders },
        );
      }
      log("auth_tokens missing token field", parsed);
    }

    log("falling back to master key", { upstreamStatus: upstream.status, bodyHead: text.slice(0, 200) });
    return new Response(
      JSON.stringify({
        ephemeralToken: apiKey,
        model: liveModel,
        source: "master_key_fallback",
        warning: `auth_tokens returned ${upstream.status}. Body head: ${text.slice(0, 240)}`,
        upstreamStatus: upstream.status,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("auth_tokens fetch threw", detail);
    return new Response(
      JSON.stringify({
        ephemeralToken: apiKey,
        model: fallbackModel,
        source: "master_key_fallback",
        warning: `auth_tokens fetch threw: ${detail}`,
      }),
      { status: 200, headers: corsHeaders },
    );
  }
}
