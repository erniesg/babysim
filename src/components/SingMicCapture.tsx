import { useEffect, useRef, useState } from "react";
import "./SingMicCapture.css";

type Features = {
  volume: number;
  rhythm: number;
  duration: number;
  pitch?: number;
};

type Props = {
  onCancel: () => void;
  onComplete: (features: Features) => void;
};

const TARGET_DURATION_MS = 3500;

export function SingMicCapture({ onCancel, onComplete }: Props) {
  const [phase, setPhase] = useState<"prep" | "recording" | "analyzing" | "done">("prep");
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const samplesRef = useRef<number[]>([]);
  const startedAtRef = useRef<number>(0);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    analyserRef.current = null;
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      samplesRef.current = [];
      startedAtRef.current = performance.now();
      setPhase("recording");

      const tick = () => {
        if (phase === "done") return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        samplesRef.current.push(avg);
        setLevel(avg);
        const elapsed = performance.now() - startedAtRef.current;
        setProgress(Math.min(1, elapsed / TARGET_DURATION_MS));
        if (elapsed >= TARGET_DURATION_MS) {
          finalize();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mic blocked.");
    }
  }

  function finalize() {
    cancelAnimationFrame(rafRef.current);
    setPhase("analyzing");
    const samples = samplesRef.current;
    if (samples.length < 4) {
      stopAll();
      onCancel();
      return;
    }
    // Volume = average level. Rhythm = sample-to-sample variance (a proxy for
    // articulated/changing sound vs flat hum). Duration = real ms.
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    let variance = 0;
    for (const s of samples) variance += (s - mean) ** 2;
    variance /= samples.length;
    const rhythm = Math.min(1, Math.sqrt(variance) * 2.5);
    const duration = performance.now() - startedAtRef.current;
    stopAll();
    setPhase("done");
    onComplete({ volume: mean, rhythm, duration, pitch: undefined });
  }

  if (error) {
    return (
      <div className="sing-modal">
        <div className="sing-card">
          <span className="kicker">Mic blocked</span>
          <p>{error}</p>
          <p className="dim">You can sing without the mic — the deterministic sing action is still effective.</p>
          <div className="sing-actions">
            <button className="primary" onClick={() => onComplete({ volume: 0.4, rhythm: 0.4, duration: TARGET_DURATION_MS })}>
              Sing without mic
            </button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sing-modal">
      <div className="sing-card">
        <span className="kicker">Sing into the mic</span>
        <h3>{phase === "prep" ? "Hold a soft hum or lullaby." : phase === "recording" ? "Keep going…" : "Analyzing…"}</h3>
        <div className="sing-meter">
          <div className="sing-meter-fill" style={{ height: `${Math.round(level * 100)}%` }} />
        </div>
        <div className="sing-progress">
          <div className="sing-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="sing-actions">
          {phase === "prep" && (
            <button className="primary" onClick={start}>
              Start singing
            </button>
          )}
          {phase === "recording" && (
            <button onClick={finalize}>Stop early</button>
          )}
          <button onClick={() => { stopAll(); onCancel(); }}>Cancel</button>
        </div>
        <p className="dim sing-hint">The Ministry analyzes volume and rhythm. It does not transcribe.</p>
      </div>
    </div>
  );
}
