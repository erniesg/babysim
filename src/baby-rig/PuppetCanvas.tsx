/**
 * PuppetCanvas — 2.5D layered baby puppet rig.
 *
 * Renders a stack of pre-aligned full-frame PNG layers onto a Canvas2D
 * surface, composited per BabyVisualState. Adds:
 *
 *   - Radial-gradient vignette behind the figure with per-state palette + pulse rate
 *   - Cross-faded expression transitions over ~400 ms
 *   - Per-state idle motion table (bob frequency / amplitude, micro head-tilt)
 *   - Random blink (~120 ms duration, every 3-5 s)
 *   - Audio-reactive mouth aperture via setMouthOpen() ref handle
 *   - Crying-eye fallback to settled eyes (the eyes_crying plate has alignment
 *     artifacts that show as dark voids; the cry mouth + tears + red vignette
 *     + faster motion carry the emotional weight)
 *
 * See docs/baby-animation.md for the full spec.
 */

import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { BabyVisualState } from "@contracts/game-state";

// ─── Manifest types ─────────────────────────────────────────────────────────

export interface PuppetLayer {
  name: string;
  file: string;
  group: string;
  layout: "fullFrame" | string;
}

export interface PuppetExpression {
  layers: string[];
  eyeLayer?: string;
  mouthLayer?: string;
  mouthLayers?: string[];
  tears: boolean;
}

export interface PuppetManifest {
  id: string;
  layout: "full-frame-state-layers" | string;
  canvas: { width: number; height: number };
  parts?: PuppetLayer[];
  layers: PuppetLayer[];
  expressions: Record<BabyVisualState, PuppetExpression>;
  metadata?: Record<string, unknown>;
}

// ─── Public ref interface ───────────────────────────────────────────────────

export interface PuppetCanvasHandle {
  /** Set mouth aperture for audio-reactive lip-sync. 0 = closed, 1 = max open. */
  setMouthOpen: (open: number) => void;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface PuppetCanvasProps {
  visualState: BabyVisualState;
  manifestUrl?: string;
  baseDir?: string;
}

// ─── Per-state vignette palette ─────────────────────────────────────────────
// Anchors the figure in the frame; warm amber for calm, red for crying,
// cool blue for sleep. Pulse Hz drives the breathing effect.

interface VignettePalette {
  center: string; // inner rgb triple
  mid: string;    // mid rgb triple
  edge: string;   // outer rgb triple
  pulseHz: number;
}

const VIGNETTE: Record<BabyVisualState, VignettePalette> = {
  settled: { center: "255, 220, 180", mid: "120, 80, 50",  edge: "20, 22, 30", pulseHz: 0.5 },
  drowsy:  { center: "180, 150, 200", mid: "70, 60, 90",   edge: "20, 18, 30", pulseHz: 0.3 },
  hungry:  { center: "240, 160, 100", mid: "120, 70, 40",  edge: "30, 18, 12", pulseHz: 1.2 },
  fussy:   { center: "240, 130, 110", mid: "130, 60, 60",  edge: "30, 12, 14", pulseHz: 1.4 },
  crying:  { center: "255, 110, 110", mid: "150, 30, 30",  edge: "40,  8,  8", pulseHz: 2.0 },
  sleep:   { center: "120, 140, 200", mid: "40,  50, 90",  edge: "10, 12, 20", pulseHz: 0.2 },
};

// ─── Per-state idle motion ──────────────────────────────────────────────────

interface MotionParams {
  bobHz: number;
  bobPx: number;
  tiltDeg: number;
}

const MOTION: Record<BabyVisualState, MotionParams> = {
  settled: { bobHz: 0.40, bobPx: 2,   tiltDeg: 0.5 },
  drowsy:  { bobHz: 0.25, bobPx: 1.5, tiltDeg: 0.3 },
  hungry:  { bobHz: 0.70, bobPx: 3,   tiltDeg: 0.8 },
  fussy:   { bobHz: 1.00, bobPx: 4,   tiltDeg: 1.0 },
  crying:  { bobHz: 1.40, bobPx: 5,   tiltDeg: 1.4 },
  sleep:   { bobHz: 0.15, bobPx: 1,   tiltDeg: 0   },
};

// Cross-fade duration on expression change.
const TRANSITION_MS = 400;

// Issue #3: the eyes_crying plate has alignment artifacts (dark voids leak
// through). Substitute the settled eye plate; cry mouth + red vignette + faster
// motion carry the emotion.
const USE_SETTLED_EYES_FOR_CRYING = true;

// Blink timings.
const BLINK_DURATION_MS = 120;
const BLINK_MIN_MS = 3000;
const BLINK_MAX_MS = 5000;

function nextBlinkDelay(): number {
  return BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const PuppetCanvas = forwardRef<PuppetCanvasHandle, PuppetCanvasProps>(
  function PuppetCanvas(
    {
      visualState,
      manifestUrl = "/puppets/baby/puppet.json",
      baseDir = "/puppets/baby",
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [manifest, setManifest] = useState<PuppetManifest | null>(null);
    const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
    const [loadError, setLoadError] = useState(false);

    // Mutable refs for the rAF loop.
    const rafRef = useRef<number>(0);
    const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const blinkActiveRef = useRef(false);
    const mouthOpenRef = useRef(0);

    // Visual-state + cross-fade tracking.
    const currentStateRef = useRef<BabyVisualState>(visualState);
    const prevStateRef = useRef<BabyVisualState>(visualState);
    const transitionStartRef = useRef<number>(0);
    const transitioningRef = useRef(false);

    // Pick up state changes for the cross-fade machinery.
    useEffect(() => {
      if (visualState === currentStateRef.current) return;
      prevStateRef.current = currentStateRef.current;
      currentStateRef.current = visualState;
      transitionStartRef.current = performance.now();
      transitioningRef.current = true;
    }, [visualState]);

    useImperativeHandle(ref, () => ({
      setMouthOpen(open: number) {
        mouthOpenRef.current = Math.max(0, Math.min(1, open));
      },
    }));

    // Fetch manifest once on mount.
    useEffect(() => {
      let cancelled = false;
      fetch(manifestUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
          return r.json() as Promise<PuppetManifest>;
        })
        .then((m) => {
          if (!cancelled) setManifest(m);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
      return () => {
        cancelled = true;
      };
    }, [manifestUrl]);

    // Preload all layer images once the manifest arrives.
    useEffect(() => {
      if (!manifest) return;
      const imgs = new Map<string, HTMLImageElement>();
      const promises = manifest.layers.map(
        (layer) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            const filePath = layer.file.startsWith("/")
              ? layer.file
              : `${baseDir}/${layer.file}`;
            img.src = filePath;
            img.onload = () => {
              imgs.set(layer.name, img);
              resolve();
            };
            img.onerror = () => resolve();
          }),
      );
      Promise.all(promises).then(() => setImages(new Map(imgs)));
    }, [manifest, baseDir]);

    // rAF loop: vignette → motion transform → cross-faded layers → blink → mouth.
    useEffect(() => {
      if (!manifest || images.size === 0 || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = manifest.canvas;
      canvas.width = width;
      canvas.height = height;

      function scheduleBlink() {
        blinkTimerRef.current = setTimeout(() => {
          blinkActiveRef.current = true;
          setTimeout(() => {
            blinkActiveRef.current = false;
            scheduleBlink();
          }, BLINK_DURATION_MS);
        }, nextBlinkDelay());
      }
      scheduleBlink();

      function drawVignette(t: number, state: BabyVisualState) {
        if (!ctx) return;
        const palette = VIGNETTE[state];
        const omega = (t * palette.pulseHz * 2 * Math.PI) / 1000;
        const pulse = 0.85 + 0.15 * Math.sin(omega);
        const cx = width / 2;
        const cy = height * 0.45;
        const inner = 80;
        const outer = width * 0.7;
        const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        g.addColorStop(0, `rgba(${palette.center}, ${(pulse * 0.55).toFixed(3)})`);
        g.addColorStop(0.6, `rgba(${palette.mid}, ${(pulse * 0.25).toFixed(3)})`);
        g.addColorStop(1, `rgba(${palette.edge}, 1)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      function applyMotion(t: number, state: BabyVisualState) {
        if (!ctx) return;
        const m = MOTION[state];
        const omega = (t * m.bobHz * 2 * Math.PI) / 1000;
        const bobY = Math.sin(omega) * m.bobPx;
        const tilt = Math.sin(omega * 0.9) * radians(m.tiltDeg);
        const cx = width / 2;
        const cy = height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.translate(-cx, -cy + bobY);
      }

      // Eye-aperture coordinates derived from puppet.json baseFace [407, 117, 192, 192].
      // The face occupies x=407-599, y=117-309 in canvas coords. Eyes sit at
      // ~38% of face height. We erase a skin-tone band over that region BEFORE
      // drawing the state-specific eye PNG, so the baked-in eyes in
      // face_backplate.png don't leak through under any overlay whose coverage
      // is slightly smaller. Sampled from a forehead pixel of the backplate
      // (warm baby skin tone). Tuned to cover both eyes without leaking onto
      // the nose-bridge or upper cheek.
      const EYE_PATCH = {
        cx: 503,        // canvas.width / 2 ≈ between the eyes
        cy: 191,        // ~38% down from face top
        rx: 78,         // wide enough to cover both eyes + lashes
        ry: 22,         // tight enough not to bleed onto cheeks
      };
      const SKIN_FILL = "rgb(214, 174, 145)";  // warm cream — sampled from forehead

      function drawEyeEraser() {
        if (!ctx) return;
        ctx.save();
        ctx.fillStyle = SKIN_FILL;
        ctx.beginPath();
        ctx.ellipse(EYE_PATCH.cx, EYE_PATCH.cy, EYE_PATCH.rx, EYE_PATCH.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function drawLayerSet(
        layerNames: string[],
        eyeLayerName: string | undefined,
        mouthLayerName: string | undefined,
        alpha: number,
        state: BabyVisualState,
      ) {
        if (!ctx) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

        let eraserDrawn = false;

        for (const name of layerNames) {
          // After drawing the backplate but BEFORE drawing the eye overlay,
          // paint over the original eye region so the new eye PNG sits on a
          // clean skin-tone surface (not on top of the baked-in eyes).
          if (name === eyeLayerName && !eraserDrawn) {
            drawEyeEraser();
            eraserDrawn = true;
          }

          // Issue #3: substitute settled eyes for the crying eye plate.
          let lookupName = name;
          if (
            USE_SETTLED_EYES_FOR_CRYING &&
            state === "crying" &&
            name === "eyes_crying"
          ) {
            lookupName = "eyes_settled";
          }

          const img = images.get(lookupName);
          if (!img) continue;

          const isEyeLayer = name === eyeLayerName;
          const isMouthLayer = name === mouthLayerName;

          // Blink: skip the eye layer entirely for the blink frame.
          if (isEyeLayer && blinkActiveRef.current) continue;

          // Mouth open: scale the mouth layer y around the lip-line pivot.
          if (isMouthLayer && mouthOpenRef.current > 0.04) {
            const open = mouthOpenRef.current;
            ctx.save();
            const pivotY = height * 0.62;
            ctx.translate(0, pivotY);
            ctx.scale(1, 1 + open * 0.18);
            ctx.translate(0, -pivotY);
            ctx.drawImage(img, 0, 0, width, height);
            ctx.restore();
          } else {
            ctx.drawImage(img, 0, 0, width, height);
          }
        }

        ctx.restore();
      }

      function render(t: number) {
        if (!ctx) return;

        const currentState = currentStateRef.current;
        const prevState = prevStateRef.current;
        const expr =
          manifest!.expressions[currentState] ??
          manifest!.expressions["settled"];
        const prevExpr =
          manifest!.expressions[prevState] ??
          manifest!.expressions["settled"];

        let progress = 1;
        if (transitioningRef.current) {
          progress = Math.min(1, (t - transitionStartRef.current) / TRANSITION_MS);
          if (progress >= 1) transitioningRef.current = false;
        }

        ctx.clearRect(0, 0, width, height);

        // Vignette: cross-fade between prev and current palette during transition.
        if (transitioningRef.current && prevState !== currentState) {
          drawVignette(t, prevState);
          ctx.save();
          ctx.globalAlpha = progress;
          drawVignette(t, currentState);
          ctx.restore();
        } else {
          drawVignette(t, currentState);
        }

        // Motion-transformed layer compositing.
        ctx.save();
        applyMotion(t, currentState);

        if (transitioningRef.current && prevState !== currentState) {
          drawLayerSet(
            prevExpr.layers,
            prevExpr.eyeLayer,
            prevExpr.mouthLayer,
            1 - progress,
            prevState,
          );
          drawLayerSet(
            expr.layers,
            expr.eyeLayer,
            expr.mouthLayer,
            progress,
            currentState,
          );
        } else {
          drawLayerSet(
            expr.layers,
            expr.eyeLayer,
            expr.mouthLayer,
            1,
            currentState,
          );
        }

        ctx.restore();

        rafRef.current = requestAnimationFrame(render);
      }

      rafRef.current = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(rafRef.current);
        if (blinkTimerRef.current !== null) {
          clearTimeout(blinkTimerRef.current);
          blinkTimerRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest, images]);

    if (loadError) return null;
    if (!manifest) return null;

    return (
      <canvas
        ref={canvasRef}
        width={manifest.canvas.width}
        height={manifest.canvas.height}
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      />
    );
  },
);
