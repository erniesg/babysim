import { useState } from "react";
import {
  selectedProviderFromEnv,
  setRealtimeProviderOverride,
} from "../realtime/factory";
import type { RealtimeProvider } from "../realtime/types";
import "./RealtimeProviderToggle.css";

// Tiny HUD pill that lets the player flip the realtime partner provider
// at runtime — OpenAI Realtime ⇄ Gemini Flash Live — without a rebuild.
// Persists in localStorage; applies to the next argument turn.
export function RealtimeProviderToggle() {
  const [provider, setProvider] = useState<RealtimeProvider>(selectedProviderFromEnv);

  function flip(next: RealtimeProvider) {
    setRealtimeProviderOverride(next);
    setProvider(next);
  }

  return (
    <div
      className="realtime-provider-toggle"
      role="group"
      aria-label="Realtime partner backend"
      title="Realtime partner backend — applies to the next argument turn"
    >
      <span className="realtime-provider-tag">VOICE</span>
      <button
        type="button"
        className={`realtime-provider-btn ${provider === "openai" ? "is-active" : ""}`}
        onClick={() => flip("openai")}
        aria-pressed={provider === "openai"}
      >
        OpenAI
      </button>
      <button
        type="button"
        className={`realtime-provider-btn ${provider === "gemini" ? "is-active" : ""}`}
        onClick={() => flip("gemini")}
        aria-pressed={provider === "gemini"}
      >
        Gemini
      </button>
    </div>
  );
}
