import { useEffect, useRef, useState } from "react";
import type { GameState } from "@contracts/game-state";
import type { PartnerEvent, RealtimePartnerSession, PartnerToolCall } from "../realtime/types";
import { createRealtimePartner, selectedProviderFromEnv } from "../realtime/factory";
import "./RealtimePartner.css";

type Props = {
  state: GameState;
  beatId: string;
  onToolCall: (call: PartnerToolCall) => void;
  onClose: () => void;
};

type Phase = "connecting" | "live" | "error" | "closed";

export function RealtimePartner({ state, beatId, onToolCall, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sessionRef = useRef<RealtimePartnerSession | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playQueueTimeRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<{ disconnect: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = selectedProviderFromEnv();
    const factory = createRealtimePartner(provider);
    const session = factory({
      partnerName: state.partner.name,
      archetype: state.partner.traits.archetype,
      ledger: {
        playerNightShifts: state.ledger.playerNightShifts,
        playerSoothes: state.ledger.playerSoothes,
        playerShirks: state.ledger.playerShirks,
        partnerNightShifts: state.ledger.partnerNightShifts,
        partnerSoothes: state.ledger.partnerSoothes,
        partnerShirks: state.ledger.partnerShirks,
      },
      babyName: state.baby.name || "the baby",
      beatId,
    });
    sessionRef.current = session;

    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;
    playQueueTimeRef.current = audioCtx.currentTime;

    const unsub = session.on((event: PartnerEvent) => {
      if (cancelled) return;
      if (event.type === "open") {
        setPhase("live");
        startMic(session, audioCtx);
      } else if (event.type === "audio") {
        playPcmChunk(audioCtx, event.chunk);
      } else if (event.type === "text_delta") {
        setTranscript((t) => t + event.text);
      } else if (event.type === "text_complete") {
        setTranscript(event.text);
      } else if (event.type === "tool_call") {
        onToolCall(event.call);
      } else if (event.type === "error") {
        setErrorMsg(event.error);
        setPhase("error");
      } else if (event.type === "closed") {
        setPhase("closed");
      }
    });

    session
      .start()
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });

    return () => {
      cancelled = true;
      unsub();
      micProcessorRef.current?.disconnect();
      micProcessorRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      session.close();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatId]);

  async function startMic(session: RealtimePartnerSession, audioCtx: AudioContext) {
    if (session.provider === "openai") {
      // OpenAI uses WebRTC track; mic is added inside session.start().
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
      const source = audioCtx.createMediaStreamSource(stream);
      const node = audioCtx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // Resample 24kHz → 16kHz nearest-neighbour for Gemini Live.
        const ratio = audioCtx.sampleRate / 16000;
        const outLength = Math.floor(input.length / ratio);
        const out = new Int16Array(outLength);
        for (let i = 0; i < outLength; i++) {
          const v = input[Math.floor(i * ratio)] || 0;
          out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        }
        session.sendMicChunk(out.buffer);
      };
      source.connect(node);
      node.connect(audioCtx.destination);
      micProcessorRef.current = {
        disconnect: () => {
          source.disconnect();
          node.disconnect();
        },
      };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Mic blocked");
      setPhase("error");
    }
  }

  function playPcmChunk(audioCtx: AudioContext, buf: ArrayBuffer) {
    // Gemini Live returns 24kHz s16le PCM by default.
    const i16 = new Int16Array(buf);
    if (i16.length === 0) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const ab = audioCtx.createBuffer(1, f32.length, 24000);
    ab.copyToChannel(f32, 0);
    const src = audioCtx.createBufferSource();
    src.buffer = ab;
    src.connect(audioCtx.destination);
    const startAt = Math.max(audioCtx.currentTime, playQueueTimeRef.current);
    src.start(startAt);
    playQueueTimeRef.current = startAt + ab.duration;
  }

  return (
    <div className={`realtime-partner ${phase}`}>
      <div className="realtime-head">
        <span className="kicker">Live partner · {sessionRef.current?.provider ?? "gemini"} · {phase}</span>
        <button onClick={onClose} className="realtime-close">End live turn</button>
      </div>
      {phase === "connecting" && <p className="dim">Connecting to {state.partner.name}…</p>}
      {phase === "error" && (
        <div className="realtime-error">
          <strong>Live session failed.</strong>
          <pre className="realtime-error-detail">{errorMsg ?? "unknown"}</pre>
          <p className="dim small">
            Open the browser console (Cmd-Opt-J) for full <code>[GeminiLive]</code> log output. The scripted partner is still active in the surrounding scene.
          </p>
        </div>
      )}
      {transcript && <p className="realtime-transcript">"{transcript}"</p>}
      {phase === "live" && (
        <p className="dim small">Speak directly. {state.partner.name} can take/refuse the night shift, concede, or raise resentment. Tool calls update the ledger live.</p>
      )}
    </div>
  );
}
