import type { CreatePartnerSession, RealtimeProvider } from "./types";
import { createGeminiLivePartner } from "./gemini-live";
import { createOpenAIRealtimePartner } from "./openai-realtime";

export function createRealtimePartner(provider: RealtimeProvider = "gemini"): CreatePartnerSession {
  if (provider === "openai") return createOpenAIRealtimePartner;
  return createGeminiLivePartner;
}

export function selectedProviderFromEnv(): RealtimeProvider {
  const flag = import.meta.env.VITE_REALTIME_PARTNER_PROVIDER;
  if (flag === "openai") return "openai";
  return "gemini";
}
