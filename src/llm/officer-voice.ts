// Mode-C voice path: officer speaks via ElevenLabs TTS. The Worker's /api/officer/say
// endpoint generates the MP3 with the per-officer voice; the browser plays it through
// the muppet so mouth-sync lines up.

const ENDPOINT = "/api/officer/say";

const log = (...args: unknown[]) => console.log("[OfficerVoice]", ...args);

export async function fetchOfficerVoiceUrl(
  text: string,
  officer: "Ernest" | "Bern" | "Crumb" | "Tan" | "Lim" | "Wong",
): Promise<string | null> {
  log("requesting", { officer, textLen: text.length });
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, officer }),
    });
    log("response", { status: res.status, ok: res.ok, contentType: res.headers.get("content-type") });
    if (!res.ok) {
      const errBody = await res.text();
      log("not ok", errBody.slice(0, 200));
      return null;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    log("threw", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function isElevenLabsOfficerVoiceEnabled(): boolean {
  // Default ON: the dynamic game is the product, browser TTS is the testing fallback.
  // Set VITE_OFFICER_VOICE_PROVIDER=browser to force the deterministic-fallback voice.
  const flag = import.meta.env.VITE_OFFICER_VOICE_PROVIDER;
  if (flag === "browser" || flag === "off") return false;
  return true;
}
