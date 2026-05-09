import { useEffect, useRef } from "react";

/**
 * MicLevelMeter — small canvas that renders a frequency-bar visualizer
 * tapping a MediaStream via AnalyserNode. Used to show players that the
 * mic is hot and actively picking up their voice during live turns.
 */

type Props = {
  stream: MediaStream | null;
  /** Width in CSS pixels. Internal canvas runs at 2x for HiDPI. */
  width?: number;
  /** Height in CSS pixels. */
  height?: number;
  /** Number of frequency bars rendered. Higher = denser. */
  barCount?: number;
};

export function MicLevelMeter({ stream, width = 140, height = 24, barCount = 24 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    function draw() {
      if (!ctx) return;
      analyser.getByteFrequencyData(bins);

      ctx.clearRect(0, 0, width, height);

      const barW = width / barCount;
      const gap = 1.5;
      const usedBars = Math.min(barCount, bins.length);

      for (let i = 0; i < usedBars; i++) {
        // Sample evenly across the spectrum, skipping the very lowest bin
        // (room noise / DC offset) and the very highest (mostly silence).
        const idx = Math.floor(2 + (i / barCount) * (bins.length - 4));
        const v = bins[idx] / 255; // 0..1
        const h = Math.max(2, v * height);
        const y = height - h;

        // Gradient: warm gold low, hot red on peak.
        const hue = 18 + 12 * (1 - v);
        const sat = 70 + 30 * v;
        const light = 45 + 18 * v;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
        ctx.fillRect(i * barW + gap / 2, y, barW - gap, h);
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch { /* noop */ }
      try { analyser.disconnect(); } catch { /* noop */ }
      audioCtx.close().catch(() => { /* noop */ });
    };
  }, [stream, width, height, barCount]);

  return (
    <canvas
      ref={canvasRef}
      className="mic-level-meter"
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}
