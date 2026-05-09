/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REAL_SECONDS_PER_GAME_HOUR?: string;
  readonly VITE_ENABLE_OFFICER_AGENT?: string;
  readonly VITE_ENABLE_REALTIME_PARTNER?: string;
  readonly VITE_REALTIME_PARTNER_PROVIDER?: "gemini" | "openai";
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_GENERATIVE_BABY_PORTRAIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
