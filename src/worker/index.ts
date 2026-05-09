// BabySim Worker — single entry, routes /api/* to handlers and falls through
// to the static-asset binding for the SPA. Pure Cloudflare Workers.

import { officerAgent, type OfficerEnv } from "./handlers/officer";
import { officerTtsHandler, type ElevenLabsEnv } from "./handlers/officer-tts";
import { geminiTokenHandler, type GeminiTokenEnv } from "./handlers/realtime-gemini-token";
import { openaiTokenHandler, type OpenAITokenEnv } from "./handlers/realtime-openai-token";
import { babyAgent, type BabyEnv } from "./handlers/baby";
import { gmAgent, type GMEnv } from "./handlers/gm";

// GMEnv is an alias of OfficerEnv (same OPENAI_API_KEY + OPENAI_TEXT_MODEL).
interface Env extends OfficerEnv, ElevenLabsEnv, GeminiTokenEnv, OpenAITokenEnv, BabyEnv, GMEnv {
  ASSETS: Fetcher;
}

const corsPreflight = new Response(null, {
  status: 204,
  headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
  },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Lightweight health check — handy for live debugging.
    if (path === "/api/healthz") {
      return new Response(
        JSON.stringify({
          ok: true,
          ts: Date.now(),
          secrets: {
            OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
            GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY),
            GOOGLE_API_KEY: Boolean(env.GOOGLE_API_KEY),
          },
          models: {
            text: env.OPENAI_TEXT_MODEL,
            realtime: env.OPENAI_REALTIME_MODEL,
            geminiLive: env.GEMINI_LIVE_MODEL,
          },
        }),
        { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } },
      );
    }

    if (method === "OPTIONS" && path.startsWith("/api/")) return corsPreflight;

    if (path === "/api/officer" && method === "POST") return officerAgent(request, env);
    if (path === "/api/officer/say" && method === "POST") return officerTtsHandler(request, env);
    if (path === "/api/realtime/gemini/token" && method === "POST") return geminiTokenHandler(request, env);
    if (path === "/api/realtime/openai/token" && method === "POST") return openaiTokenHandler(request, env);
    if (path === "/api/baby" && method === "POST") return babyAgent(request, env);
    if (path === "/api/gm" && method === "POST") return gmAgent(request, env);

    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "not_found", path }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // Anything else falls through to the static SPA bundle.
    return env.ASSETS.fetch(request);
  },
};
