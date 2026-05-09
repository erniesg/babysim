import type { CreatePartnerSession, RealtimeProvider } from "./types";
import { createGeminiLivePartner } from "./gemini-live";
import { createOpenAIRealtimePartner } from "./openai-realtime";

export function createRealtimePartner(provider: RealtimeProvider = "openai"): CreatePartnerSession {
  if (provider === "gemini") return createGeminiLivePartner;
  return createOpenAIRealtimePartner;
}

export function selectedProviderFromEnv(): RealtimeProvider {
  // Runtime override: ?realtime=openai|gemini in URL, or localStorage key.
  // Lets the player A/B without a rebuild. Falls back to env-baked default.
  if (typeof window !== "undefined") {
    try {
      const qs = new URLSearchParams(window.location.search);
      const q = qs.get("realtime");
      if (q === "openai" || q === "gemini") return q;
      const ls = window.localStorage.getItem("babysim:realtimeProvider");
      if (ls === "openai" || ls === "gemini") return ls;
    } catch { /* SSR or sandboxed — fall through */ }
  }
  const flag = import.meta.env.VITE_REALTIME_PARTNER_PROVIDER;
  if (flag === "gemini") return "gemini";
  // Default: OpenAI Realtime (WebRTC + ephemeral key — known-reliable). The
  // Gemini Live path needs a working v1alpha auth/tokens response with
  // liveConnectConstraints; until that's verified end-to-end in this
  // environment, OpenAI is the demo-stable provider.
  return "openai";
}

export function setRealtimeProviderOverride(provider: RealtimeProvider | null): void {
  if (typeof window === "undefined") return;
  try {
    if (provider === null) window.localStorage.removeItem("babysim:realtimeProvider");
    else window.localStorage.setItem("babysim:realtimeProvider", provider);
  } catch { /* sandboxed storage — silent */ }
}
