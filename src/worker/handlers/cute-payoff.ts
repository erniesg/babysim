// Cute-payoff video endpoint — Veo-3.1 via Vertex AI (2-step async job).
// POST /api/cute-payoff/video  → initiates generation, returns { operationName, status: "running" }
// GET  /api/cute-payoff/video?operation=...  → polls operation; returns video bytes or { status, done }
//
// NOTE: Veo generation takes ~30s; the Worker has a 30s CPU cap. The initiate step
// kicks off the job and returns immediately. The poll step checks the long-running
// operation and returns the video bytes when done, or { status: "pending" } while running.
//
// Frontend fallback: CSS animation. This endpoint returns 503 if Vertex is unreachable.
// Status: WIRED — initiate + poll implemented. Requires GOOGLE_SERVICE_ACCOUNT_JSON.

export interface CutePayoffEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id: string;
  project_id: string;
}

function base64UrlEncode(input: string): string {
  return btoa(input)
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function ab2str(buf: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buf));
}

function pemToDer(pem: string): ArrayBuffer {
  const lines = pem
    .replace(/-----BEGIN[^-]*-----/, "")
    .replace(/-----END[^-]*-----/, "")
    .replace(/\s+/g, "");
  const binaryString = atob(lines);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: sa.private_key_id }),
  );
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const keyDer = pemToDer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const signature = btoa(ab2str(sigBuf))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${signingInput}.${signature}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`OAuth token exchange failed (${tokenResp.status}): ${text.slice(0, 400)}`);
  }
  const json = (await tokenResp.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("OAuth response missing access_token");
  return json.access_token;
}

function buildVideoPrompt(babyName: string, gender: "girl" | "boy"): string {
  const pronoun = gender === "girl" ? "her" : "his";
  const genderWord = gender === "girl" ? "baby girl" : "baby boy";
  return [
    `Cinematic close-up of a happy newborn ${genderWord} named ${babyName}.`,
    `The baby is awake and content, gazing at the camera, ${pronoun} face soft and warm.`,
    "Setting: dim domestic interior, warm amber key light from upper-left, shallow depth of field.",
    "1970s East Asian family drama aesthetic — slightly desaturated, painterly film grain.",
    "No text, no watermarks. 3-5 seconds, loopable.",
  ].join(" ");
}

const VEO_REGION = "us-central1";
const VEO_MODEL = "veo-3.1-generate-preview";

const corsHeaders = {
  "access-control-allow-origin": "*",
};

// POST /api/cute-payoff/video — initiate generation
async function handleInitiate(
  request: Request,
  env: CutePayoffEnv,
  log: (...args: unknown[]) => void,
): Promise<Response> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    log("no GOOGLE_SERVICE_ACCOUNT_JSON");
    return new Response(
      JSON.stringify({
        error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured",
        detail: "Set this Worker secret to enable Veo-3.1 cute-payoff generation",
      }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: { babyName?: string; gender?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const babyName = typeof body.babyName === "string" ? body.babyName.slice(0, 40).trim() : "";
  if (!babyName) {
    return new Response(JSON.stringify({ error: "babyName required" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const gender = body.gender === "girl" || body.gender === "boy" ? body.gender : "girl";

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      throw new Error("service account JSON missing required fields");
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("invalid service account JSON", detail);
    return new Response(
      JSON.stringify({ error: "invalid GOOGLE_SERVICE_ACCOUNT_JSON", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let accessToken: string;
  try {
    accessToken = await mintAccessToken(sa);
    log("access token minted");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("token mint failed", detail);
    return new Response(
      JSON.stringify({ error: "vertex_auth_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const prompt = buildVideoPrompt(babyName, gender);
  const url = `https://${VEO_REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${VEO_REGION}/publishers/google/models/${VEO_MODEL}:predictLongRunning`;

  log("initiating veo job", { babyName, gender, model: VEO_MODEL });

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sample_count: 1,
          duration_seconds: 5,
          aspect_ratio: "1:1",
        },
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("veo initiate failed", { status: upstream.status, body: errText.slice(0, 400) });
      return new Response(
        JSON.stringify({ error: "upstream_error", status: upstream.status, detail: errText.slice(0, 600) }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const json = (await upstream.json()) as { name?: string };
    const operationName = json.name;
    if (!operationName) {
      log("veo response missing operation name", JSON.stringify(json).slice(0, 300));
      return new Response(
        JSON.stringify({ error: "upstream_error", detail: "Veo response missing operation name" }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    log("veo job initiated", { operationName });
    return new Response(
      JSON.stringify({ operationName, status: "running" }),
      { status: 202, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("veo initiate threw", detail);
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
}

// GET /api/cute-payoff/video?operation=... — poll / fetch result
async function handlePoll(
  operationName: string,
  env: CutePayoffEnv,
  log: (...args: unknown[]) => void,
): Promise<Response> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    log("no GOOGLE_SERVICE_ACCOUNT_JSON for poll");
    return new Response(
      JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("invalid service account JSON on poll", detail);
    return new Response(
      JSON.stringify({ error: "invalid GOOGLE_SERVICE_ACCOUNT_JSON", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let accessToken: string;
  try {
    accessToken = await mintAccessToken(sa);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("token mint failed on poll", detail);
    return new Response(
      JSON.stringify({ error: "vertex_auth_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  // Long-running operations URL — strip any leading "projects/..." prefix if needed
  const opUrl = operationName.startsWith("projects/")
    ? `https://${VEO_REGION}-aiplatform.googleapis.com/v1/${operationName}`
    : `https://${VEO_REGION}-aiplatform.googleapis.com/v1/${operationName}`;

  log("polling veo operation", { operationName });

  try {
    const upstream = await fetch(opUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      log("poll failed", { status: upstream.status, body: errText.slice(0, 400) });
      return new Response(
        JSON.stringify({ error: "upstream_error", status: upstream.status, detail: errText.slice(0, 600) }),
        { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const json = (await upstream.json()) as {
      done?: boolean;
      error?: { message?: string; code?: number };
      response?: {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          videoContent?: string;
          mimeType?: string;
        }>;
      };
    };

    if (json.error) {
      log("veo operation error", json.error);
      return new Response(
        JSON.stringify({ error: "veo_operation_error", detail: json.error.message ?? JSON.stringify(json.error) }),
        { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    if (!json.done) {
      log("veo still pending");
      return new Response(
        JSON.stringify({ status: "pending", done: false }),
        { status: 202, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const pred = json.response?.predictions?.[0];
    const b64 = pred?.bytesBase64Encoded ?? pred?.videoContent ?? null;

    if (!b64) {
      log("veo done but missing video bytes", JSON.stringify(json).slice(0, 300));
      return new Response(
        JSON.stringify({ error: "upstream_error", detail: "operation done but no video bytes" }),
        { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    log("veo video ready", { byteLength: bytes.byteLength });
    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": pred?.mimeType ?? "video/mp4",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("poll threw", detail);
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
}

export async function cutePayoffHandler(request: Request, env: CutePayoffEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[cute-payoff ${reqId}]`, ...args);

  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET") {
    const operationName = url.searchParams.get("operation");
    if (!operationName) {
      return new Response(JSON.stringify({ error: "missing ?operation= query param" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    log("poll request", { operationName: operationName.slice(0, 100) });
    return handlePoll(operationName, env, log);
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
