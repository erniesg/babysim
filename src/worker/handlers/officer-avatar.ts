// Officer avatar endpoint — Replicate openai/gpt-image-2 for officer expression variants.
// Returns image/png bytes, cached 1h.
// Frontend falls back to pre-baked /img/officer-tan-{strict,warm}.png on non-200.

export interface OfficerAvatarEnv {
  REPLICATE_API_TOKEN: string;
  // Legacy Gemini keys kept as optional so the shared Env interface stays valid.
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

type OfficerExpression = "strict" | "warm" | "skeptical" | "delighted";
type OfficerName = "Tan" | "Lim" | "Wong";

const VALID_EXPRESSIONS = new Set<OfficerExpression>(["strict", "warm", "skeptical", "delighted"]);
const VALID_OFFICERS = new Set<OfficerName>(["Tan", "Lim", "Wong"]);

// Expression descriptors cribbed directly from scripts/generate-officer-avatar.mjs
const EXPRESSION_DESCRIPTORS: Record<OfficerExpression, string> = {
  strict:
    "severely strict and disapproving expression, jaw set, brow lowered, eyes narrowed and locked just past camera, lips pressed thin.",
  warm:
    "subtly warm but still formal expression, faint suppressed half-smile, eyes slightly softened, head tilted a hair toward camera, dignified.",
  skeptical:
    "strict and slightly skeptical expression, mouth a flat line, brow faintly furrowed, gaze just past camera as if reviewing a confidential file.",
  delighted:
    "rare controlled delight — a satisfied upturn at one corner of the mouth, eyes just brightened enough to notice, the look of a stamp approved without comment.",
};

// Base prompt from scripts/generate-officer-avatar.mjs
const BASE_PROMPT = [
  'Stylized 1970s East Asian government drama portrait of "Officer Tan", a 50-year-old Singaporean/Malaysian civil servant.',
  "Wardrobe: dark navy government uniform with a small gold lapel badge, crisp collar, narrow tie.",
  "Setting: dim crimson velvet curtain backdrop with soft folds; a wooden government desk in the lower-third foreground holds a brass desk stamp; faint gold accents catch light.",
  "Lighting: single dramatic key light from upper-left, deep falloff into shadow on the right side; warm undertones, slightly desaturated palette.",
  "Style: cinematic, dignified, faintly menacing, light film grain, painterly photographic feel, shallow depth of field.",
  "Composition: tight head-and-shoulders, square 1:1 framing, subject roughly centered, eyes just past camera as if reviewing a file.",
  "No text, no watermarks, no overlaid graphics.",
].join(" ");

function buildPrompt(expression: OfficerExpression, officer: OfficerName): string {
  const nameNote = officer !== "Tan"
    ? ` (referred to internally as Officer ${officer}, same uniform and aesthetic as Tan)`
    : "";
  return `${BASE_PROMPT}${nameNote} Expression: ${EXPRESSION_DESCRIPTORS[expression]}`;
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

export async function officerAvatarHandler(request: Request, env: OfficerAvatarEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[officer-avatar ${reqId}]`, ...args);

  if (!env.REPLICATE_API_TOKEN) {
    log("no REPLICATE_API_TOKEN");
    return new Response(JSON.stringify({ error: "REPLICATE_API_TOKEN not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: { expression?: string; officer?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const expression = body.expression as OfficerExpression | undefined;
  if (!expression || !VALID_EXPRESSIONS.has(expression)) {
    return new Response(
      JSON.stringify({ error: "invalid expression", valid: Array.from(VALID_EXPRESSIONS) }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const officer: OfficerName =
    body.officer && VALID_OFFICERS.has(body.officer as OfficerName)
      ? (body.officer as OfficerName)
      : "Tan";

  const prompt = buildPrompt(expression, officer);
  log("generating avatar via Replicate gpt-image-2", { officer, expression });

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

  log("avatar ok", { officer, expression, byteLength: imageBytes.byteLength });
  return new Response(imageBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}
