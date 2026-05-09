// Officer avatar endpoint — Gemini image generation for officer expression variants.
// Returns image/png bytes, cached 1h.
// Frontend falls back to pre-baked /img/officer-tan-{strict,warm}.png on non-200.

export interface OfficerAvatarEnv {
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

const GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-3-image-preview",
  "gemini-2.5-flash-image-preview",
  "gemini-3-pro-image-preview",
];

function detectPng(buf: ArrayBuffer): boolean {
  const view = new Uint8Array(buf, 0, 8);
  return view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
};

export async function officerAvatarHandler(request: Request, env: OfficerAvatarEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[officer-avatar ${reqId}]`, ...args);

  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) {
    log("no GEMINI_API_KEY or GOOGLE_API_KEY");
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
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
  log("generating avatar", { officer, expression });

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

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const imageBuf = bytes.buffer;

      if (!detectPng(imageBuf)) {
        const mimeType = inline?.mimeType ?? "image/jpeg";
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

      log("avatar ok", { model, officer, expression, byteLength: imageBuf.byteLength });
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
