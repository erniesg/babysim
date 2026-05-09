// Cinematic clip endpoint — Seedance 2.0 OR Veo-3.1-fast via Replicate (2-step async job).
// POST /api/cinematic   → initiates generation, returns { predictionId, status, pollUrl, provider }
// GET  /api/cinematic?id=...  → polls Replicate; returns { status, videoUrl } once ready.
//
// Replicate predictions take 1-3 min for video. The initiate step kicks off the job
// and returns immediately with a predictionId. The poll step checks until "succeeded",
// then returns the Replicate delivery URL (frontend uses it as <video src>).
// We do NOT proxy video bytes — frontend fetches the Replicate CDN URL directly.
//
// Provider is selectable via body.provider: "seedance" | "veo" (default "seedance").
// Veo-3.1-fast is more permissive on infant content (Bytedance's Seedance moderation
// rejects photoreal newborn frames with E005). Veo also supports negative_prompt.
//
// If fromState + toState are provided, the start/end frame PNGs hosted on this Worker
// are passed as the start and end frame keys (which differ per provider — see PROVIDERS).

export interface CinematicEnv {
  REPLICATE_API_TOKEN: string;
}

type CinematicProvider = "seedance" | "veo";

interface ProviderConfig {
  modelVersion: string;
  startFrameKey: string;       // image input key
  endFrameKey: string;         // last-frame input key
  defaultDuration: number;
  defaultResolution: string;
  supportsNegativePrompt: boolean;
}

const PROVIDERS: Record<CinematicProvider, ProviderConfig> = {
  // bytedance/seedance-2.0
  seedance: {
    modelVersion: "4631ca9b77b48db08836df4527a436455c4eddff6b25dbc12e541f262aaab774",
    startFrameKey: "image",
    endFrameKey: "last_frame_image",
    defaultDuration: 5,
    defaultResolution: "720p",
    supportsNegativePrompt: false,
  },
  // google/veo-3.1-fast
  veo: {
    modelVersion: "ba987aceebef53bebfede32973f842fe3aa2301bf2585878181e7a7677052e36",
    startFrameKey: "image",
    endFrameKey: "last_frame",
    defaultDuration: 8,
    defaultResolution: "1080p",
    supportsNegativePrompt: true,
  },
};

const REPLICATE_PREDICTIONS_URL = "https://api.replicate.com/v1/predictions";

// Baby states recognised by the system.
const VALID_STATES = new Set([
  "settled",
  "drowsy",
  "hungry",
  "fussy",
  "crying",
  "sleep",
]);

const BASE_ASSET_URL = "https://babysim.berlayar.ai/img/baby";

const corsHeaders = {
  "access-control-allow-origin": "*",
};

type BabyState = "settled" | "drowsy" | "hungry" | "fussy" | "crying" | "sleep";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  // Seedance returns a single string URL; some models return an array.
  output?: string | string[];
  error?: string;
  urls?: { get: string };
}

// POST /api/cinematic — initiate generation
async function handleInitiate(
  request: Request,
  env: CinematicEnv,
  log: (...args: unknown[]) => void,
): Promise<Response> {
  if (!env.REPLICATE_API_TOKEN) {
    log("no REPLICATE_API_TOKEN");
    return new Response(
      JSON.stringify({
        error: "REPLICATE_API_TOKEN not configured",
        detail: "Set this Worker secret to enable Seedance 2.0 cinematic generation",
      }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: {
    prompt?: string;
    fromState?: string;
    toState?: string;
    duration?: number;
    generateAudio?: boolean;
    provider?: string;
    imageUrl?: string;        // explicit start-frame URL (overrides fromState→PNG)
    lastFrameUrl?: string;    // explicit end-frame URL (overrides toState→PNG)
    negativePrompt?: string;  // veo-only
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const prompt =
    typeof body.prompt === "string" ? body.prompt.slice(0, 1000).trim() : "";
  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt required" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const provider: CinematicProvider =
    body.provider === "veo" ? "veo" : "seedance";
  const cfg = PROVIDERS[provider];

  const fromState =
    typeof body.fromState === "string" && VALID_STATES.has(body.fromState)
      ? (body.fromState as BabyState)
      : null;
  const toState =
    typeof body.toState === "string" && VALID_STATES.has(body.toState)
      ? (body.toState as BabyState)
      : null;

  const duration =
    typeof body.duration === "number" && body.duration >= 2 && body.duration <= 15
      ? body.duration
      : cfg.defaultDuration;

  const generateAudio = body.generateAudio !== false; // default true

  // Build the Replicate input payload — keys differ per provider (Seedance: last_frame_image, Veo: last_frame).
  const replicateInput: Record<string, unknown> = {
    prompt,
    duration,
    resolution: cfg.defaultResolution,
    aspect_ratio: "16:9",
    generate_audio: generateAudio,
  };

  // Start frame: explicit URL beats fromState lookup.
  const startFrameUrl =
    typeof body.imageUrl === "string" && body.imageUrl
      ? body.imageUrl
      : fromState
        ? `${BASE_ASSET_URL}/${fromState}.png`
        : null;
  if (startFrameUrl) {
    replicateInput[cfg.startFrameKey] = startFrameUrl;
  }

  // End frame: explicit URL beats toState lookup.
  const endFrameUrl =
    typeof body.lastFrameUrl === "string" && body.lastFrameUrl
      ? body.lastFrameUrl
      : toState
        ? `${BASE_ASSET_URL}/${toState}.png`
        : null;
  if (endFrameUrl) {
    replicateInput[cfg.endFrameKey] = endFrameUrl;
  }

  // negative_prompt is Veo-only.
  if (cfg.supportsNegativePrompt && typeof body.negativePrompt === "string" && body.negativePrompt) {
    replicateInput["negative_prompt"] = body.negativePrompt.slice(0, 500);
  }

  log("initiating replicate prediction", {
    provider,
    fromState,
    toState,
    duration,
    generateAudio,
    hasExplicitImageUrl: Boolean(body.imageUrl),
  });

  let prediction: ReplicatePrediction;
  try {
    const upstream = await fetch(REPLICATE_PREDICTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "respond-async", // ask Replicate to return 201 immediately
      },
      body: JSON.stringify({
        version: cfg.modelVersion,
        input: replicateInput,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("replicate initiate failed", {
        status: upstream.status,
        body: errText.slice(0, 400),
      });
      return new Response(
        JSON.stringify({
          error: "upstream_error",
          status: upstream.status,
          detail: errText.slice(0, 600),
        }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    prediction = (await upstream.json()) as ReplicatePrediction;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("replicate initiate threw", detail);
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  if (!prediction.id) {
    log("replicate response missing id", JSON.stringify(prediction).slice(0, 300));
    return new Response(
      JSON.stringify({
        error: "upstream_error",
        detail: "Replicate response missing prediction id",
      }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  log("replicate prediction initiated", { provider, predictionId: prediction.id, status: prediction.status });

  return new Response(
    JSON.stringify({
      provider,
      predictionId: prediction.id,
      status: prediction.status ?? "starting",
      pollUrl: `/api/cinematic?id=${prediction.id}`,
    }),
    { status: 202, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
}

// GET /api/cinematic?id=... — poll prediction status
async function handlePoll(
  predictionId: string,
  env: CinematicEnv,
  log: (...args: unknown[]) => void,
): Promise<Response> {
  if (!env.REPLICATE_API_TOKEN) {
    log("no REPLICATE_API_TOKEN for poll");
    return new Response(
      JSON.stringify({ error: "REPLICATE_API_TOKEN not configured" }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const pollUrl = `${REPLICATE_PREDICTIONS_URL}/${predictionId}`;
  log("polling replicate prediction", { predictionId });

  let prediction: ReplicatePrediction;
  try {
    const upstream = await fetch(pollUrl, {
      headers: {
        Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("poll failed", { status: upstream.status, body: errText.slice(0, 400) });
      return new Response(
        JSON.stringify({
          error: "upstream_error",
          status: upstream.status,
          detail: errText.slice(0, 600),
        }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    prediction = (await upstream.json()) as ReplicatePrediction;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("poll threw", detail);
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const { status, output, error } = prediction;

  if (status === "failed" || status === "canceled") {
    log("prediction failed/canceled", { status, error });
    return new Response(
      JSON.stringify({ status, error: error ?? "prediction did not succeed" }),
      { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  if (status !== "succeeded") {
    // Still running — let the frontend keep polling.
    return new Response(
      JSON.stringify({ status, videoUrl: null }),
      { status: 202, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  // Succeeded — output is a URL (string) or array of URLs depending on the provider.
  const videoUrl = typeof output === "string"
    ? output
    : Array.isArray(output) && typeof output[0] === "string"
      ? output[0]
      : null;
  if (!videoUrl) {
    log("prediction succeeded but output is missing", JSON.stringify(prediction).slice(0, 300));
    return new Response(
      JSON.stringify({
        error: "upstream_error",
        detail: "prediction succeeded but output URL is missing",
      }),
      { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  log("prediction succeeded", { predictionId, videoUrl: videoUrl.slice(0, 80) });

  return new Response(
    JSON.stringify({ status: "succeeded", videoUrl }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

export async function cinematicHandler(
  request: Request,
  env: CinematicEnv,
): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) =>
    console.log(`[cinematic ${reqId}]`, ...args);

  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(
        JSON.stringify({ error: "missing ?id= query param" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }
    log("poll request", { id: id.slice(0, 40) });
    return handlePoll(id, env, log);
  }

  if (method === "POST") {
    log("initiate request");
    return handleInitiate(request, env, log);
  }

  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
