import type { CreatePartnerSession, PartnerEvent, PartnerSessionConfig, RealtimePartnerSession } from "./types";

const TOKEN_ENDPOINT = "/api/realtime/openai/token";

type EphemeralKeyResponse = {
  client_secret: { value: string; expires_at: number };
  model: string;
};

// OpenAI Realtime — WebRTC peer connection in browser, ephemeral key minted server-side.
// Skeleton: enough to compile + match the Gemini interface; full WebRTC negotiation
// can be filled in once the ephemeral-key endpoint is verified end-to-end.
export const createOpenAIRealtimePartner: CreatePartnerSession = (config: PartnerSessionConfig): RealtimePartnerSession => {
  const handlers = new Set<(e: PartnerEvent) => void>();
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let opened = false;

  function emit(e: PartnerEvent) {
    for (const h of handlers) h(e);
  }

  async function fetchKey(): Promise<EphemeralKeyResponse> {
    const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
    if (!res.ok) throw new Error(`ephemeral key fetch failed: ${res.status}`);
    return (await res.json()) as EphemeralKeyResponse;
  }

  async function start(): Promise<void> {
    const key = await fetchKey();
    pc = new RTCPeerConnection();

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;
      // Wrap inbound audio track into a single AudioContext sink at the call site.
      // Emit a single open-time event with the stream attached on first track.
      // For brevity we re-emit each chunk via a worklet — left as a follow-up.
      emit({ type: "text_delta", text: `[track ${stream.id}]` });
    };

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (ev) => {
      try {
        const evt = JSON.parse(ev.data) as { type: string; [k: string]: unknown };
        if (evt.type === "session.created" && !opened) {
          opened = true;
          emit({ type: "open" });
        } else if (evt.type === "response.text.delta") {
          emit({ type: "text_delta", text: String(evt.delta ?? "") });
        } else if (evt.type === "response.text.done") {
          emit({ type: "text_complete", text: String(evt.text ?? "") });
        } else if (evt.type === "response.function_call_arguments.done") {
          // OpenAI Realtime tool-call event shape per the research doc.
          const name = String(evt.name ?? "");
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(evt.arguments ?? "{}")) as Record<string, unknown>;
          } catch {}
          emit({ type: "tool_call", call: { name, args } });
        }
      } catch {
        // ignore non-JSON
      }
    };

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach((t) => pc!.addTrack(t, micStream!));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(key.model)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.client_secret.value}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status}`);
    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    if (!opened) {
      emit({ type: "open" });
      opened = true;
    }
  }

  function sendMicChunk(_chunk: ArrayBuffer): void {
    // OpenAI Realtime WebRTC: mic flows over the peer-connection track, no manual
    // chunking. Gemini Live takes manual chunks. The interface accepts both.
  }

  function sendText(text: string): void {
    if (!dc || dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: { modalities: ["audio", "text"], instructions: text },
      }),
    );
  }

  function on(handler: (event: PartnerEvent) => void): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function close(): void {
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    dc?.close();
    dc = null;
    pc?.close();
    pc = null;
    handlers.clear();
  }

  return { start, sendMicChunk, sendText, on, close, provider: "openai" };
};

// Reference the config so TS doesn't complain about unused param when the body
// is filled in later. The OpenAI flow uses session.update with the partner's
// system prompt and tool definitions over the data channel after start().
void ((cfg: PartnerSessionConfig) => cfg);
