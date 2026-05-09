// Baby portrait endpoint — Gemini image generation for live baby visuals.
// Returns image/png bytes, cached 1h.
// Frontend falls back to pre-baked /img/baby/{state}.png if this returns non-200.

export interface BabyPortraitEnv {
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

type BabyVisualState =
  | "content"
  | "hungry"
  | "tired"
  | "crying"
  | "alert"
  | "sleeping";

type BabyGender = "girl" | "boy";

interface BabyTraits {
  temperament?: "easy" | "spirited" | "sensitive";
  hairColor?: string;
  eyeColor?: string;
  skinTone?: string;
}

const VALID_STATES = new Set<BabyVisualState>([
  "content", "hungry", "tired", "crying", "alert", "sleeping",
]);

const STATE_DESCRIPTIONS: Record<BabyVisualState, string> = {
  content:  "eyes open and calm, soft relaxed expression, a small content look, perhaps a faint upward curl at the lips",
  hungry:   "mouth opening and closing, fists clenched, brow slightly furrowed, face beginning to redden, pre-cry restlessness",
  tired:    "heavy eyelids drooping, unfocused gaze, head tilting slightly to the side, lips loosely parted",
  crying:   "eyes scrunched closed, mouth open mid-wail, face flushed and reddened, tears at the corners of eyes",
  alert:    "eyes wide open and bright, head held steady, gaze focused directly forward with curiosity",
  sleeping: "eyes softly closed, face completely relaxed, tiny lips slightly parted, peaceful and still",
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

// Gemini image model candidates, tried in order.
const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-3-image-preview",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
];

function detectPng(buf: ArrayBuffer): boolean {
  const view = new Uint8Array(buf, 0, 8);
  return view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
};

export async function babyPortraitHandler(request: Request, env: BabyPortraitEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[baby-portrait ${reqId}]`, ...args);

  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) {
    log("no GEMINI_API_KEY or GOOGLE_API_KEY");
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
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

  log("generating portrait", { state, gender, babyName, traitKeys: Object.keys(traits) });

  let lastError: string = "no model attempted";

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      );
      url.searchParams.set("key", apiKey);

      const upstream = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        lastError = `${model} ${upstream.status}: ${errText.slice(0, 300)}`;
        log("model failed", { model, status: upstream.status });
        continue;
      }

      const json = (await upstream.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mimeType?: string } }> };
        }>;
      };

      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const inlinePart = parts.find((p) => p.inlineData ?? p.inline_data);
      const inline = inlinePart?.inlineData ?? inlinePart?.inline_data;
      const base64 = inline?.data;

      if (!base64) {
        lastError = `${model}: response missing inline image`;
        log("model missing image", { model });
        continue;
      }

      // Decode base64 → ArrayBuffer via Workers-compatible approach
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const imageBuf = bytes.buffer;

      // Verify it is actually PNG (Gemini may return JPEG)
      if (!detectPng(imageBuf)) {
        // We cannot transcode in a Worker; return the bytes as-is with the real mime type
        const mimeType = (inline?.mimeType ?? inline?.mimeType ?? "image/jpeg");
        log("non-png from model, returning raw", { model, mimeType, byteLength: imageBuf.byteLength });
        return new Response(imageBuf, {
          status: 200,
          headers: {
            ...corsHeaders,
            "content-type": mimeType,
            "cache-control": "public, max-age=3600",
          },
        });
      }

      log("portrait ok", { model, byteLength: imageBuf.byteLength });
      return new Response(imageBuf, {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "image/png",
          "cache-control": "public, max-age=3600",
        },
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log("model threw", { model, err: lastError });
    }
  }

  log("all models failed", lastError);
  return new Response(
    JSON.stringify({ error: "upstream_error", detail: lastError }),
    { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
}
