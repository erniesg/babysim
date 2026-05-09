import type {
  CreatePartnerSession,
  PartnerEvent,
  PartnerSessionConfig,
  PartnerToolCall,
  RealtimePartnerSession,
} from "./types";

const TOKEN_ENDPOINT = "/api/realtime/openai/token";

const log = (...args: unknown[]) => console.log("[OpenAIRealtime]", ...args);

type EphemeralKeyResponse = {
  client_secret: { value: string; expires_at: number };
  model: string;
};

type RealtimeServerEvent = { type: string; [k: string]: unknown };

type ParsedRealtimeToolCall = {
  callId?: string;
  call: PartnerToolCall;
};

// Function definitions matching the Gemini Live tool surface 1:1 so the
// reducer dispatch (Game.tsx) handles either provider transparently.
const PARTNER_TOOLS = [
  {
    type: "function" as const,
    name: "take_night_shift",
    description: "Partner agrees to take this 2 AM shift. Updates ledger.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "refuse_night_shift",
    description: "Partner refuses this shift. Player will need to handle the cry.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "concede_argument",
    description: "Partner concedes — argument resolves, partner takes the shift.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "raise_resentment",
    description: "Partner stays angry; resentment increments.",
    parameters: {
      type: "object",
      properties: { delta: { type: "number", description: "Resentment delta 1-25." } },
      required: [],
    },
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
  const ledgerLine =
    `Ledger snapshot — you (the partner): ${cfg.ledger.partnerNightShifts} night shifts, ` +
    `${cfg.ledger.partnerSoothes} soothes, ${cfg.ledger.partnerShirks} shirks. ` +
    `The player: ${cfg.ledger.playerNightShifts}/${cfg.ledger.playerSoothes}/${cfg.ledger.playerShirks}.`;
  return [
    `You are ${cfg.partnerName}, the player's co-parent in a stylized 1970s East Asian state-drama parenting rehearsal.`,
    `Archetype: ${cfg.archetype}. ${archetypeStyle(cfg.archetype)}`,
    `Baby: ${cfg.babyName}. Current beat: ${cfg.beatId}.`,
    ledgerLine,
    `It is 2:07 AM and the baby is crying. You are tired. The player just made a choice — getting up themselves, shirking, or waking you. React in character with one short turn.`,
    `When you make a decision (take the shift, refuse, concede, or escalate resentment), call the appropriate function tool. You can also speak briefly. Do not narrate the simulation. Do not break character. Audio responses preferred over text.`,
  ].join(" ");
}

// Voice mapping — OpenAI Realtime supports voices like "verse" / "alloy" /
// "ash" / "ballad" / "coral" / "echo" / "sage" / "shimmer". Pick distinct
// voices per archetype so the partner sounds different per playthrough.
function voiceForArchetype(archetype: PartnerSessionConfig["archetype"]): string {
  switch (archetype) {
    case "anxious":        return "shimmer";  // softer, breathy
    case "chill":          return "ash";      // dry, laid-back
    case "resentful":      return "ballad";   // cooler register
    case "overfunctioner": return "verse";    // brisk, capable
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function parseOpenAIRealtimeToolCall(evt: RealtimeServerEvent): ParsedRealtimeToolCall | null {
  if (evt.type === "response.function_call_arguments.done") {
    const name = typeof evt.name === "string" ? evt.name : "";
    if (!name) return null;
    return {
      callId: typeof evt.call_id === "string" ? evt.call_id : undefined,
      call: { name, args: parseArgs(evt.arguments) } as PartnerToolCall,
    };
  }

  if (evt.type === "response.output_item.done") {
    const item = evt.item as { type?: unknown; name?: unknown; arguments?: unknown; call_id?: unknown } | undefined;
    if (!item || item.type !== "function_call" || typeof item.name !== "string") return null;
    return {
      callId: typeof item.call_id === "string" ? item.call_id : undefined,
      call: { name: item.name, args: parseArgs(item.arguments) } as PartnerToolCall,
    };
  }

  return null;
}

export const createOpenAIRealtimePartner: CreatePartnerSession = (
  config: PartnerSessionConfig,
): RealtimePartnerSession => {
  const handlers = new Set<(e: PartnerEvent) => void>();
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let opened = false;
  let textBuffer = "";
  const emittedToolCalls = new Set<string>();

  function emit(e: PartnerEvent) {
    for (const h of handlers) h(e);
  }

  async function fetchKey(): Promise<EphemeralKeyResponse> {
    log("fetching ephemeral key");
    const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`ephemeral key fetch failed (${res.status}): ${bodyText.slice(0, 240)}`);
    }
    return JSON.parse(bodyText) as EphemeralKeyResponse;
  }

  // Push the system prompt + tools + voice into the session AFTER the data
  // channel opens. Until this fires, OpenAI uses generic defaults — no
  // archetype, no tool calls.
  function configureSession() {
    if (!dc || dc.readyState !== "open") return;
    const updateEvent = {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        voice: voiceForArchetype(config.archetype),
        instructions: systemPromptFor(config),
        tools: PARTNER_TOOLS,
        tool_choice: "auto",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 200,
          silence_duration_ms: 600,
        },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
      },
    };
    log("session.update", { voice: voiceForArchetype(config.archetype), beat: config.beatId });
    dc.send(JSON.stringify(updateEvent));

    // Trigger the first response so the partner speaks first when the live
    // turn opens — matches the Gemini path.
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  function acknowledgeToolCall(callId: string | undefined, name: string) {
    if (!callId || !dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: true, applied: name }),
      },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  async function start(): Promise<void> {
    const key = await fetchKey();
    log("opening WebRTC peer connection", { model: key.model });
    pc = new RTCPeerConnection();

    // Inbound audio track → speaker. OpenAI Realtime streams the partner's
    // voice as a normal audio track over WebRTC; we wire it to a hidden
    // <audio> element so the user hears it.
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;
      const audio = new Audio();
      audio.srcObject = stream;
      audio.autoplay = true;
      void audio.play().catch(() => { /* autoplay may need user gesture */ });
      log("inbound audio track", { id: stream.id });
    };

    dc = pc.createDataChannel("oai-events");
    dc.onopen = () => {
      log("data channel open");
      configureSession();
      if (!opened) {
        opened = true;
        emit({ type: "open" });
      }
    };
    dc.onmessage = (ev) => {
      try {
        const evt = JSON.parse(ev.data) as RealtimeServerEvent;
        const t = evt.type;
        const parsedTool = parseOpenAIRealtimeToolCall(evt);

        if (parsedTool) {
          if (parsedTool.callId && emittedToolCalls.has(parsedTool.callId)) return;
          if (parsedTool.callId) emittedToolCalls.add(parsedTool.callId);
          log("tool call", { name: parsedTool.call.name, args: parsedTool.call.args });
          emit({ type: "tool_call", call: parsedTool.call });
          acknowledgeToolCall(parsedTool.callId, parsedTool.call.name);
        } else if (t === "session.created" && !opened) {
          opened = true;
          emit({ type: "open" });
        } else if (t === "response.audio_transcript.delta" || t === "response.text.delta" || t === "response.output_text.delta") {
          const d = String(evt.delta ?? "");
          textBuffer += d;
          if (d) emit({ type: "text_delta", text: d });
        } else if (t === "response.audio_transcript.done" || t === "response.text.done" || t === "response.output_text.done") {
          const text = String(evt.transcript ?? evt.text ?? textBuffer);
          if (text) emit({ type: "text_complete", text });
          textBuffer = "";
        } else if (t === "error") {
          const msg = (evt.error as { message?: string } | undefined)?.message ?? "openai realtime error";
          log("server error", evt);
          emit({ type: "error", error: msg });
        }
      } catch {
        /* ignore non-JSON */
      }
    };

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach((t) => pc!.addTrack(t, micStream!));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    log("posting SDP offer to OpenAI");
    const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(key.model)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.client_secret.value}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!sdpRes.ok) {
      const detail = await sdpRes.text();
      throw new Error(`SDP exchange failed (${sdpRes.status}): ${detail.slice(0, 240)}`);
    }
    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    log("WebRTC connected");
  }

  function sendMicChunk(_chunk: ArrayBuffer): void {
    // OpenAI WebRTC: mic flows over the peer-connection track, no manual
    // chunking needed. Gemini Live takes manual chunks. Interface accepts both.
  }

  function sendText(text: string): void {
    if (!dc || dc.readyState !== "open") return;
    // Two-step: append the user message, then ask for a response.
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  function on(handler: (event: PartnerEvent) => void): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function close(): void {
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    try { dc?.close(); } catch { /* noop */ }
    dc = null;
    try { pc?.close(); } catch { /* noop */ }
    pc = null;
    handlers.clear();
  }

  return { start, sendMicChunk, sendText, on, close, provider: "openai" };
};
