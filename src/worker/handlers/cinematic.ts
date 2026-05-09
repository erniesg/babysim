// Cinematic clip endpoint — Seedance 2.0 via Replicate (2-step async job).
// POST /api/cinematic   → initiates generation, returns { predictionId, status, pollUrl }
// GET  /api/cinematic?id=...  → polls Replicate; returns { status, videoUrl } once ready.
//
// Replicate predictions take 1-3 min for video. The initiate step kicks off the job
// and returns immediately with a predictionId. The poll step checks until "succeeded",
// then returns the Replicate delivery URL (frontend uses it as <video src>).
// We do NOT proxy video bytes — frontend fetches the Replicate CDN URL directly.
//
// If fromState + toState are provided, the start/end frame PNGs hosted on this Worker
// are passed as `image` and `last_frame_image` to anchor the transition.
// Otherwise the request is pure text-to-video.

export interface CinematicEnv {
  REPLICATE_API_TOKEN: string;
}

const REPLICATE_MODEL_VERSION =
  "4631ca9b77b48db08836df4527a436455c4eddff6b25dbc12e541f262aaab774";

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
  output?: string;
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
      : 5;

  const generateAudio = body.generateAudio !== false; // default true

  // Build the Replicate input payload.
  const replicateInput: Record<string, unknown> = {
    prompt,
    duration,
    resolution: "720p",
    aspect_ratio: "16:9",
    generate_audio: generateAudio,
  };

  if (fromState) {
    replicateInput["image"] = `${BASE_ASSET_URL}/${fromState}.png`;
  }
  if (toState) {
    replicateInput["last_frame_image"] = `${BASE_ASSET_URL}/${toState}.png`;
  }

  log("initiating replicate prediction", {
    fromState,
    toState,
    duration,
    generateAudio,
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
        version: REPLICATE_MODEL_VERSION,
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

  log("replicate prediction initiated", { predictionId: prediction.id, status: prediction.status });

  return new Response(
    JSON.stringify({
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

  // Succeeded — output is a string URL for the MP4.
  const videoUrl = typeof output === "string" ? output : null;
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
