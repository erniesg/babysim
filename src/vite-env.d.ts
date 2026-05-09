/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REAL_SECONDS_PER_GAME_HOUR?: string;
  readonly VITE_ENABLE_OFFICER_AGENT?: string;
  readonly VITE_ENABLE_BABY_AGENT?: string;
  readonly VITE_ENABLE_REALTIME_PARTNER?: string;
  readonly VITE_REALTIME_PARTNER_PROVIDER?: "gemini" | "openai";
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_GENERATIVE_BABY_PORTRAIT?: string;
  readonly VITE_OFFICER_VOICE_PROVIDER?: "browser" | "elevenlabs" | "off";
  readonly VITE_LIVE_MUSIC?: string;
  readonly VITE_LIVE_BABY_SFX?: string;
  readonly VITE_LIVE_OFFICER_AVATAR?: string;
  readonly VITE_LIVE_BABY_PORTRAIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
