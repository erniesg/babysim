// Probation-theme music endpoint — Lyria-002 via Vertex AI.
// Requires GOOGLE_SERVICE_ACCOUNT_JSON secret (full service-account JSON, pasted as Worker secret).
// JWT-signs with crypto.subtle (Workers-compatible) to mint a Vertex AI access token.
// Returns audio/wav bytes (Workers cannot run ffmpeg; frontend <audio> plays WAV fine), cached 24h.
// Falls back to 503 if GOOGLE_SERVICE_ACCOUNT_JSON is unset — frontend uses pre-baked
// /audio/music/probation-theme.mp3 in that case.

export interface MusicEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}

type Vibe = "intro" | "argument" | "verdict";
const VALID_VIBES = new Set<Vibe>(["intro", "argument", "verdict"]);

const VIBE_PROMPTS: Record<Vibe, string> = {
  intro:
    "Driving cinematic title cue, brisk 110 BPM. Stabs of rhythmic pizzicato strings, syncopated kick + snare on a heavy reverb, low brass marcato motif, occasional timpani hit, glittery harp arpeggio every two bars. Energetic and adventurous — like a 1970s East Asian state-drama opener crossed with a heist movie. Builds urgency without losing menace. Instrumental, no vocals. Loopable.",
  argument:
    "Tense domestic scene underscore, escalating. Rising string ostinato, nervous pizzicato, muted brass stabs, syncopated low-end pulse. 1970s East Asian family drama style. Instrumental, no vocals. Builds.",
  verdict:
    "Solemn bureaucratic verdict cue. Stately low brass, single dampened timpani hit, held string chord resolving downward. Evokes official judgment. Instrumental, no vocals. Short, final.",
};

// Service-account JSON shape (only what we need)
interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id: string;
  project_id: string;
}

// Cloudflare Workers compat base64url encode (no Buffer available)
function base64UrlEncode(input: string): string {
  return btoa(input)
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function ab2str(buf: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buf));
}

// Strip PEM headers/footers and decode the DER body
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

// Lyria-002 model candidates tried in order (from scripts/generate-music.mjs)
const LYRIA_ATTEMPTS = [
  { region: "us-central1", model: "lyria-002" },
  { region: "us-central1", model: "lyria-2" },
];

const corsHeaders = {
  "access-control-allow-origin": "*",
};

export async function musicHandler(request: Request, env: MusicEnv): Promise<Response> {
  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[music ${reqId}]`, ...args);

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    log("no GOOGLE_SERVICE_ACCOUNT_JSON");
    return new Response(
      JSON.stringify({
        error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured",
        detail: "Set this Worker secret to enable live Lyria-002 music generation",
      }),
      { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: { vibe?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const vibe: Vibe =
    body.vibe && VALID_VIBES.has(body.vibe as Vibe)
      ? (body.vibe as Vibe)
      : "intro";
  const prompt = VIBE_PROMPTS[vibe];

  log("generating music", { vibe });

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

  const errors: string[] = [];
  for (const { region, model } of LYRIA_ATTEMPTS) {
    try {
      const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${region}/publishers/google/models/${model}:predict`;
      log("calling lyria", { region, model });

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sample_count: 1 },
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        const msg = `${region}/${model} ${upstream.status}: ${errText.slice(0, 400)}`;
        log("lyria failed", msg);
        errors.push(msg);
        continue;
      }

      const json = (await upstream.json()) as {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          audioContent?: string;
          audio?: { bytesBase64Encoded?: string };
          audio_content?: string;
          mimeType?: string;
        }>;
      };

      const pred = json?.predictions?.[0];
      const b64 =
        pred?.bytesBase64Encoded ??
        pred?.audioContent ??
        pred?.audio?.bytesBase64Encoded ??
        pred?.audio_content ??
        null;

      if (!b64) {
        const msg = `${region}/${model}: response missing audio field`;
        log("lyria missing audio", msg);
        errors.push(msg);
        continue;
      }

      const binaryString = atob(b64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      log("music ok", { region, model, byteLength: bytes.byteLength });
      return new Response(bytes.buffer, {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "audio/wav",
          "cache-control": "public, max-age=86400",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("lyria threw", { region, model, err: msg });
      errors.push(msg);
    }
  }

  log("all lyria attempts failed", errors);
  return new Response(
    JSON.stringify({ error: "upstream_error", detail: errors.join(" | ") }),
    { status: 503, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
}
