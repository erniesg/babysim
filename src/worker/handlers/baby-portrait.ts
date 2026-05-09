// Baby portrait endpoint — Replicate openai/gpt-image-2 OR fal.ai fal-ai/flux-pro/v1.1
// for live baby visuals. Returns image/png bytes, cached 1h.
// Frontend falls back to pre-baked /img/baby/{state}.png if this returns non-200.
//
// ── fal.ai provider notes ────────────────────────────────────────────────────
// Model chosen: fal-ai/flux-pro/v1.1
//   Rationale: FLUX 1.1 Pro produces photorealistic portraits with strong
//   composition and prompt adherence. Supports safety_tolerance (1–6) which
//   lets us dial past overly-conservative defaults for newborn skin tones.
//   Recraft-v3 was considered but specialises in graphic/vector aesthetics;
//   FLUX Pro is the better fit for photographic-painterly newborn portraits.
//
// Endpoint URL pattern:
//   Queue (async):  POST https://queue.fal.run/fal-ai/flux-pro/v1.1
//                   GET  https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/{id}/status
//                   GET  https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/{id}
//
// Auth header:      Authorization: Key $FAL_KEY
//
// Flow chosen:      Queue/poll — same pattern as Replicate's async flow. fal also
//   exposes sync_mode=true which returns a data URI immediately, but sync blocks
//   the GPU runner for the full generation time and is rate-limited more
//   aggressively. Queue is safer for Worker concurrency.
//
// Cold-start / rate limits:
//   FLUX Pro 1.1 has dedicated capacity on fal; typical queue wait is 2–8 s on
//   warm runners with no cold start penalty (fal keeps the model loaded).
//   Free tier: 30 req/min. Paid: no hard limit, billed per megapixel.
//   1024×1024 = 1 MP = $0.04/image.
// ─────────────────────────────────────────────────────────────────────────────

export interface BabyPortraitEnv {
  REPLICATE_API_TOKEN: string;
  FAL_KEY?: string;
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

// fal.ai model: fal-ai/flux-pro/v1.1
const FAL_MODEL_ID = "fal-ai/flux-pro/v1.1";
const FAL_QUEUE_BASE = `https://queue.fal.run/${FAL_MODEL_ID}`;

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[];
  error?: string;
}

interface FalQueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
}

interface FalResultResponse {
  images?: Array<{ url: string; content_type: string; width: number; height: number }>;
  error?: string;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
};

// ── fal.ai portrait helper ───────────────────────────────────────────────────
// Submits a FLUX Pro 1.1 request via fal's queue API, polls until COMPLETED,
// fetches the image bytes, and returns them as image/png.
// Maps upstream errors to { error: "fal_error", upstreamStatus, detail }.
async function falPortrait(
  prompt: string,
  falKey: string,
  log: (...args: unknown[]) => void,
): Promise<Response> {
  const falAuthHeader = `Key ${falKey}`;

  // Step 1 — submit to queue
  let submission: FalQueueSubmitResponse;
  try {
    const res = await fetch(FAL_QUEUE_BASE, {
      method: "POST",
      headers: {
        "Authorization": falAuthHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_size: "square_hd",   // 1024×1024
        output_format: "png",
        num_images: 1,
        safety_tolerance: "5",     // permissive — newborn skin tones trip lower levels
        enhance_prompt: false,     // keep our carefully crafted prompt verbatim
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      log("fal submit failed", { status: res.status, detail });
      return new Response(
        JSON.stringify({ error: "fal_error", upstreamStatus: res.status, detail }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }
    submission = await res.json() as FalQueueSubmitResponse;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fal submit threw", detail);
    return new Response(
      JSON.stringify({ error: "fal_error", upstreamStatus: 0, detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  log("fal submitted", { request_id: submission.request_id });

  // Step 2 — poll status (up to 30 × 2 s = 60 s)
  const statusUrl = `${FAL_QUEUE_BASE}/requests/${submission.request_id}/status`;
  let completed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const statusRes = await fetch(statusUrl, {
        headers: { "Authorization": falAuthHeader },
      });
      if (!statusRes.ok) {
        log("fal status poll error", { attempt, status: statusRes.status });
        continue;
      }
      const statusBody = await statusRes.json() as FalStatusResponse;
      log("fal status", { attempt, status: statusBody.status, queuePos: statusBody.queue_position });
      if (statusBody.status === "COMPLETED") {
        completed = true;
        break;
      }
    } catch (err) {
      log("fal status poll threw", err instanceof Error ? err.message : String(err));
    }
  }

  if (!completed) {
    log("fal timed out");
    return new Response(
      JSON.stringify({ error: "fal_error", upstreamStatus: 504, detail: "fal generation timed out" }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  // Step 3 — fetch result
  const resultUrl = `${FAL_QUEUE_BASE}/requests/${submission.request_id}`;
  let resultBody: FalResultResponse;
  try {
    const resultRes = await fetch(resultUrl, {
      headers: { "Authorization": falAuthHeader },
    });
    if (!resultRes.ok) {
      const detail = (await resultRes.text()).slice(0, 400);
      log("fal result fetch failed", { status: resultRes.status, detail });
      return new Response(
        JSON.stringify({ error: "fal_error", upstreamStatus: resultRes.status, detail }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }
    resultBody = await resultRes.json() as FalResultResponse;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fal result fetch threw", detail);
    return new Response(
      JSON.stringify({ error: "fal_error", upstreamStatus: 0, detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const imageUrl = resultBody.images?.[0]?.url;
  if (!imageUrl) {
    log("fal result missing image url", JSON.stringify(resultBody).slice(0, 300));
    return new Response(
      JSON.stringify({ error: "fal_error", upstreamStatus: 200, detail: "fal result missing image url" }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  // Step 4 — proxy image bytes so the response shape matches the Replicate path
  log("fetching fal image bytes", { imageUrl: imageUrl.slice(0, 80) });
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      const detail = (await imgRes.text()).slice(0, 200);
      log("fal image byte fetch failed", { status: imgRes.status });
      return new Response(
        JSON.stringify({ error: "fal_error", upstreamStatus: imgRes.status, detail }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }
    const imageBytes = await imgRes.arrayBuffer();
    log("fal portrait ok", { byteLength: imageBytes.byteLength });
    return new Response(imageBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("fal image bytes threw", detail);
    return new Response(
      JSON.stringify({ error: "fal_error", upstreamStatus: 0, detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function babyPortraitHandler(request: Request, env: BabyPortraitEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[baby-portrait ${reqId}]`, ...args);

  let body: { state?: string; gender?: string; traits?: BabyTraits; babyName?: string; provider?: string };
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

  // Route to fal.ai when explicitly requested.
  const provider = body.provider === "fal" ? "fal" : "replicate";

  if (provider === "fal") {
    if (!env.FAL_KEY) {
      log("no FAL_KEY");
      return new Response(JSON.stringify({ error: "FAL_KEY not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    log("generating portrait via fal.ai flux-pro/v1.1", { state, gender, babyName, traitKeys: Object.keys(traits) });
    return falPortrait(prompt, env.FAL_KEY, log);
  }

  // Default: Replicate gpt-image-2
  if (!env.REPLICATE_API_TOKEN) {
    log("no REPLICATE_API_TOKEN");
    return new Response(JSON.stringify({ error: "REPLICATE_API_TOKEN not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

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

  // If still processing after Prefer: wait=60, poll up to 5 more times at 5s intervals
  // (gpt-image-2 cold-start can take 60s+; Workers wall-clock is unbounded while waiting on subrequests).
  for (let attempt = 0; attempt < 5; attempt++) {
    if (prediction.status === "succeeded" || prediction.status === "failed" || prediction.status === "canceled") break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const pollResp = await fetch(`${REPLICATE_PREDICTIONS_URL}/${prediction.id}`, {
        headers: { "Authorization": `Bearer ${env.REPLICATE_API_TOKEN}` },
      });
      if (pollResp.ok) {
        prediction = await pollResp.json() as ReplicatePrediction;
        log("poll", { attempt, id: prediction.id, status: prediction.status });
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
