import type { CreatePartnerSession, PartnerEvent, PartnerSessionConfig, PartnerToolCall, RealtimePartnerSession } from "./types";

const TOKEN_ENDPOINT = "/api/realtime/gemini/token";

const log = (...args: unknown[]) => console.log("[GeminiLive]", ...args);

type GeminiTokenResponse = {
  ephemeralToken: string;
  model: string;
  source?: "auth_token_v1alpha" | "master_key_fallback";
  expiresAt?: string;
  warning?: string;
};

type LiveServerMessage = {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
    turnComplete?: boolean;
  };
  toolCall?: {
    functionCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }>;
  };
};

const PARTNER_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "take_night_shift",
        description: "Partner agrees to take this 2 AM shift. Updates ledger.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "refuse_night_shift",
        description: "Partner refuses this shift. Player will need to handle the cry.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "concede_argument",
        description: "Partner concedes — argument resolves, partner takes the shift.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "raise_resentment",
        description: "Partner stays angry; resentment increments.",
        parameters: {
          type: "object",
          properties: { delta: { type: "number", description: "Resentment delta 1-25." } },
        },
      },
    ],
  },
];

function archetypeStyle(archetype: PartnerSessionConfig["archetype"]): string {
  switch (archetype) {
    case "anxious":
      return "Tone: hushed, fretty, sentences trailing. Concerned not cruel. Slightly self-blaming.";
    case "chill":
      return "Tone: laconic, low-energy, half-amused. Short clauses. Says 'mm' and 'sure' a lot.";
    case "resentful":
      return "Tone: scorekeeping, clipped. Cites the ledger. Cold but not yelling.";
    case "overfunctioner":
      return "Tone: martyred, performatively competent, quietly exhausted. Lists tasks defensively.";
  }
}

function systemPromptFor(cfg: PartnerSessionConfig): string {
  const ledgerLine = `Ledger snapshot — you (the partner): ${cfg.ledger.partnerNightShifts} night shifts, ${cfg.ledger.partnerSoothes} soothes, ${cfg.ledger.partnerShirks} shirks. The player: ${cfg.ledger.playerNightShifts}/${cfg.ledger.playerSoothes}/${cfg.ledger.playerShirks}.`;
  return [
    `You are ${cfg.partnerName}, the player's co-parent in a stylized 1970s East Asian state-drama parenting rehearsal.`,
    `Archetype: ${cfg.archetype}. ${archetypeStyle(cfg.archetype)}`,
    `Baby: ${cfg.babyName}. Current beat: ${cfg.beatId}.`,
    ledgerLine,
    `It is 2:07 AM and the baby is crying. You are tired. The player just made a choice — either getting up themselves, shirking, or waking you. React in character with one short turn.`,
    `When you make a decision (take the shift, refuse, concede), call the appropriate function tool. You can also speak briefly. Do not narrate the simulation. Do not break character. Audio responses preferred over text.`,
  ].join(" ");
}

async function fetchEphemeralToken(): Promise<GeminiTokenResponse> {
  log("fetching ephemeral token from", TOKEN_ENDPOINT);
  const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
  const bodyText = await res.text();
  log("token endpoint response", { status: res.status, ok: res.ok, bodyHead: bodyText.slice(0, 240) });
  if (!res.ok) {
    throw new Error(`token fetch failed (${res.status}): ${bodyText.slice(0, 240)}`);
  }
  let parsed: GeminiTokenResponse;
  try {
    parsed = JSON.parse(bodyText) as GeminiTokenResponse;
  } catch (err) {
    throw new Error(`token endpoint returned non-JSON: ${bodyText.slice(0, 200)}`);
  }
  log("token parsed", {
    source: parsed.source,
    model: parsed.model,
    has_token: Boolean(parsed.ephemeralToken),
    warning: parsed.warning,
  });
  if (parsed.warning) {
    console.warn("[GeminiLive] token warning:", parsed.warning);
  }
  return parsed;
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function encodeArrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export const createGeminiLivePartner: CreatePartnerSession = (config: PartnerSessionConfig): RealtimePartnerSession => {
  let ws: WebSocket | null = null;
  const handlers = new Set<(e: PartnerEvent) => void>();
  let opened = false;
  let textBuffer = "";

  function emit(event: PartnerEvent) {
    for (const h of handlers) h(event);
  }

  async function start(): Promise<void> {
    const tokenInfo = await fetchEphemeralToken();
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(tokenInfo.ephemeralToken)}`;
    log("opening websocket", { model: tokenInfo.model, source: tokenInfo.source });
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    return await new Promise((resolve, reject) => {
      if (!ws) return reject(new Error("ws not created"));

      // Hard timeout — if setupComplete doesn't arrive within 12 s the user
      // sees the "Connecting…" pill forever. Fail loudly so the UI can show
      // the scripted-line fallback.
      const setupTimeoutMs = 12_000;
      const setupTimer = setTimeout(() => {
        if (!opened) {
          const detail = `setupComplete not received within ${setupTimeoutMs} ms — likely auth/quota/network. Token source: ${tokenInfo.source ?? "?"}.`;
          log("setup timeout", detail);
          emit({ type: "error", error: detail });
          try { ws?.close(); } catch { /* noop */ }
          reject(new Error(detail));
        }
      }, setupTimeoutMs);
      const clearSetupTimer = () => clearTimeout(setupTimer);

      const opts = {
        onOpen: () => {
          if (!ws) return;
          log("ws open — sending setup frame");
          const setup = {
            setup: {
              model: `models/${tokenInfo.model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceForArchetype(config.archetype) } },
                },
              },
              systemInstruction: { parts: [{ text: systemPromptFor(config) }] },
              tools: PARTNER_TOOLS,
            },
          };
          log("setup payload", { model: setup.setup.model, voice: voiceForArchetype(config.archetype) });
          ws.send(JSON.stringify(setup));
        },
        onMessage: (data: string | ArrayBuffer) => {
          if (typeof data !== "string") {
            log("ws binary message", { byteLength: (data as ArrayBuffer).byteLength });
            return;
          }
          let msg: LiveServerMessage;
          try {
            msg = JSON.parse(data) as LiveServerMessage;
          } catch (err) {
            log("ws message not json", data.slice(0, 200));
            return;
          }

          // Surface error frames Google sometimes sends in JSON form.
          const anyMsg = msg as unknown as { error?: { code?: number; message?: string; status?: string } };
          if (anyMsg.error) {
            const detail = `${anyMsg.error.code ?? "?"} ${anyMsg.error.status ?? ""} — ${anyMsg.error.message ?? "(no message)"}`;
            log("ws server error frame", anyMsg.error);
            emit({ type: "error", error: detail });
            if (!opened) {
              clearSetupTimer();
              reject(new Error(detail));
            }
            return;
          }

          if (msg.setupComplete && !opened) {
            log("setup complete — session live");
            opened = true;
            clearSetupTimer();
            emit({ type: "open" });
            resolve();
            return;
          }
          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.text) {
                textBuffer += part.text;
                emit({ type: "text_delta", text: part.text });
              }
              if (part.inlineData?.data) {
                const buf = decodeBase64ToArrayBuffer(part.inlineData.data);
                emit({ type: "audio", chunk: buf, mimeType: part.inlineData.mimeType });
              }
            }
          }
          if (msg.serverContent?.turnComplete) {
            if (textBuffer) {
              emit({ type: "text_complete", text: textBuffer });
              textBuffer = "";
            }
          }
          if (msg.toolCall?.functionCalls) {
            for (const fc of msg.toolCall.functionCalls) {
              log("tool call", fc);
              const call = { name: fc.name, args: (fc.args ?? {}) as Record<string, unknown> } as PartnerToolCall;
              emit({ type: "tool_call", call });
            }
          }
        },
        onError: (errMsg: string) => {
          log("ws error", errMsg);
          emit({ type: "error", error: errMsg });
          if (!opened) {
            clearSetupTimer();
            reject(new Error(errMsg));
          }
        },
        onClose: (code: number, reason: string) => {
          log("ws close", { code, reason });
          clearSetupTimer();
          emit({ type: "closed", code, reason });
          // If the WS closes BEFORE setupComplete arrives, surface this — most
          // common cause is the auth/tokens 404 fallback being a master key the
          // wss endpoint then rejects with a 1006/1011 close.
          if (!opened) {
            const detail = `WebSocket closed before setupComplete (code ${code}${reason ? `, ${reason}` : ""}). Token source: ${tokenInfo.source ?? "?"}.`;
            emit({ type: "error", error: detail });
            reject(new Error(detail));
          }
        },
      };

      ws.onopen = () => opts.onOpen();
      ws.onmessage = (ev) => opts.onMessage(ev.data as string | ArrayBuffer);
      ws.onerror = () => opts.onError("websocket error (browser-level)");
      ws.onclose = (ev) => opts.onClose(ev.code, ev.reason);
    });
  }

  function sendMicChunk(chunk: ArrayBuffer): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      realtimeInput: {
        mediaChunks: [
          { mimeType: "audio/pcm;rate=16000", data: encodeArrayBufferToBase64(chunk) },
        ],
      },
    };
    ws.send(JSON.stringify(payload));
  }

  function sendText(text: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    };
    ws.send(JSON.stringify(payload));
  }

  function on(handler: (event: PartnerEvent) => void): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function close(): void {
    if (ws && ws.readyState <= 1) ws.close();
    ws = null;
    handlers.clear();
  }

  return { start, sendMicChunk, sendText, on, close, provider: "gemini" };
};

function voiceForArchetype(archetype: PartnerSessionConfig["archetype"]): string {
  switch (archetype) {
    case "anxious":
      return "Aoede";
    case "chill":
      return "Puck";
    case "resentful":
      return "Charon";
    case "overfunctioner":
      return "Kore";
  }
}
