// Baby portrait endpoint — Replicate openai/gpt-image-2 for live baby visuals.
// Returns image/png bytes, cached 1h.
// Frontend falls back to pre-baked /img/baby/{state}.png if this returns non-200.

export interface BabyPortraitEnv {
  REPLICATE_API_TOKEN: string;
  // Legacy Gemini keys kept as optional so the shared Env interface stays valid.
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

// Match contracts/game-state.ts → BabyVisualState exactly so frontend can pass through.
type BabyVisualState =
  | "settled"
  | "drowsy"
  | "hungry"
  | "fussy"
  | "crying"
  | "sleep";

type BabyGender = "girl" | "boy";

interface BabyTraits {
  soothing?: "motion" | "sound" | "contact" | "silence";
  stimulation?: "low" | "medium" | "high";
  feeding?: "frequent" | "regular" | "unpredictable";
  sleep?: "heavy" | "light" | "fights";
  temperament?: "sunny" | "sensitive" | "stubborn" | "chaotic";
  hairColor?: string;
  eyeColor?: string;
  skinTone?: string;
}

const VALID_STATES = new Set<BabyVisualState>([
  "settled", "drowsy", "hungry", "fussy", "crying", "sleep",
]);

const STATE_DESCRIPTIONS: Record<BabyVisualState, string> = {
  settled: "eyes open and calm, soft relaxed expression, a small content look, perhaps a faint upward curl at the lips",
  drowsy:  "heavy eyelids drooping, unfocused gaze, head tilting slightly to the side, lips loosely parted",
  hungry:  "mouth opening and closing, fists clenched, brow slightly furrowed, face beginning to redden, pre-cry restlessness",
  fussy:   "brow knit, lips pursed, head turning side to side, low-grade unhappiness, not full crying",
  crying:  "eyes scrunched closed, mouth open mid-wail, face flushed and reddened, tears at the corners of eyes",
  sleep:   "eyes softly closed, face completely relaxed, tiny lips slightly parted, peaceful and still",
};

const BASE_PORTRAIT_PROMPT = [
  "Close-up portrait of a newborn baby, 0-8 weeks old.",
  "Lighting: warm low-key, single soft key light from upper-left, gentle shadows.",
  "Palette: warm, slightly desaturated tones — cream, peach, soft amber — consistent with a 1970s East Asian family drama aesthetic.",
  "1024x1024 square format, tight head-and-shoulders or face-only crop.",
  "No text, no watermarks, no overlaid graphics.",
  "Cinematic, photographic-painterly feel, light film grain, shallow depth of field.",
].join(" ");

function buildPrompt(state: BabyVisualState, gender: BabyGender, traits: BabyTraits, babyName?: string): string {
  const genderDesc = gender === "girl" ? "a baby girl" : "a baby boy";
  const traitParts: string[] = [];
  if (traits.hairColor) traitParts.push(`${traits.hairColor} hair`);
  if (traits.eyeColor) traitParts.push(`${traits.eyeColor} eyes`);
  if (traits.skinTone) traitParts.push(`${traits.skinTone} skin tone`);
  const traitDesc = traitParts.length > 0 ? `, ${traitParts.join(", ")}` : "";
  const nameDesc = babyName ? ` named ${babyName}` : "";
  return `${BASE_PORTRAIT_PROMPT} Subject: ${genderDesc}${nameDesc}${traitDesc}. Expression: ${STATE_DESCRIPTIONS[state]}`;
}

// Replicate model: openai/gpt-image-2
const REPLICATE_VERSION = "9ea921ca3eea597fe8773474545f54601fe1d30bc62517fb30fd86f42e4bb3cf";
const REPLICATE_PREDICTIONS_URL = "https://api.replicate.com/v1/predictions";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[];
  error?: string;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
};

export async function babyPortraitHandler(request: Request, env: BabyPortraitEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[baby-portrait ${reqId}]`, ...args);

  if (!env.REPLICATE_API_TOKEN) {
    log("no REPLICATE_API_TOKEN");
    return new Response(JSON.stringify({ error: "REPLICATE_API_TOKEN not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: { state?: string; gender?: string; traits?: BabyTraits; babyName?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const state = body.state as BabyVisualState | undefined;
  if (!state || !VALID_STATES.has(state)) {
    return new Response(
      JSON.stringify({ error: "invalid state", valid: Array.from(VALID_STATES) }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const gender = body.gender as BabyGender | undefined;
  if (gender !== "girl" && gender !== "boy") {
    return new Response(
      JSON.stringify({ error: "invalid gender", valid: ["girl", "boy"] }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const traits: BabyTraits = body.traits ?? {};
  const babyName = typeof body.babyName === "string" ? body.babyName.slice(0, 40) : undefined;
  const prompt = buildPrompt(state, gender, traits, babyName);

  log("generating portrait via Replicate gpt-image-2", { state, gender, babyName, traitKeys: Object.keys(traits) });

  // POST to Replicate with Prefer: wait=60 for a synchronous response.
  let prediction: ReplicatePrediction;
  try {
    const resp = await fetch(REPLICATE_PREDICTIONS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait=60",
      },
      body: JSON.stringify({
        version: REPLICATE_VERSION,
        input: {
          prompt,
          aspect_ratio: "1:1",
          quality: "auto",
          output_format: "png",
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      log("replicate create failed", { status: resp.status, body: errText.slice(0, 300) });
      return new Response(
        JSON.stringify({ error: "upstream_error", detail: `Replicate ${resp.status}: ${errText.slice(0, 300)}` }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    prediction = await resp.json() as ReplicatePrediction;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("replicate create threw", detail);
    return new Response(
      JSON.stringify({ error: "upstream_error", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  log("prediction initial status", { id: prediction.id, status: prediction.status });

  // If still processing after Prefer: wait, do one poll after 5s (Workers cap ~30s wall-clock).
  if (prediction.status === "processing" || prediction.status === "starting") {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const pollResp = await fetch(`${REPLICATE_PREDICTIONS_URL}/${prediction.id}`, {
        headers: { "Authorization": `Bearer ${env.REPLICATE_API_TOKEN}` },
      });
      if (pollResp.ok) {
        prediction = await pollResp.json() as ReplicatePrediction;
        log("poll status", { id: prediction.id, status: prediction.status });
      }
    } catch (err) {
      log("poll threw", err instanceof Error ? err.message : String(err));
    }
  }

  if (prediction.status !== "succeeded" || !prediction.output?.length) {
    const detail = prediction.error ?? `status=${prediction.status}`;
    log("prediction did not succeed", { id: prediction.id, detail });
    return new Response(
      JSON.stringify({ error: "upstream_error", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const imageUrl = prediction.output[0];
  log("fetching image bytes", { imageUrl });

  let imageBytes: ArrayBuffer;
  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      const errText = await imgResp.text();
      log("image fetch failed", { status: imgResp.status });
      return new Response(
        JSON.stringify({ error: "upstream_error", detail: `image fetch ${imgResp.status}: ${errText.slice(0, 200)}` }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }
    imageBytes = await imgResp.arrayBuffer();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("image fetch threw", detail);
    return new Response(
      JSON.stringify({ error: "upstream_error", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  log("portrait ok", { byteLength: imageBytes.byteLength });
  return new Response(imageBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}
