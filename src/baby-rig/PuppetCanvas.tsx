/**
 * PuppetCanvas — React port of viewer.js `buildPuppet` + `applyPuppetExpression`
 * (viewer.js lines 1231–1263 and 1494–1516).
 *
 * Loads a puppet.json manifest, preloads all layer PNGs, and composites the
 * correct layer stack for the current BabyVisualState onto a Canvas2D surface.
 *
 * Idle animation:
 *   - Gentle vertical bob via Math.sin(t * 0.001) * 2  (~6s cycle, ±2px)
 *   - Random eye-blink: swaps to eyes_settled for ~120ms every 3–5s
 *
 * Lip-sync hook (future):
 *   Call ref.current.setMouthOpen(0..1) to scale mouth aperture vertically.
 *   Currently a no-op placeholder — wired but unused.
 */

import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { BabyVisualState } from "@contracts/game-state";

// ─── Manifest types (mirrors gptimage2-fullbody-clean-face-rig-v1/puppet.json) ─

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
  /** Flat parts list (same data as layers, used for metadata). */
  parts?: PuppetLayer[];
  /** Ordered draw list — the canonical render order. */
  layers: PuppetLayer[];
  expressions: Record<BabyVisualState, PuppetExpression>;
  metadata?: Record<string, unknown>;
}

// ─── Public ref interface ───────────────────────────────────────────────────

export interface PuppetCanvasHandle {
  /**
   * Set mouth aperture for audio-reactive lip-sync.
   * @param open 0 = fully closed, 1 = fully open
   */
  setMouthOpen: (open: number) => void;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface PuppetCanvasProps {
  visualState: BabyVisualState;
  manifestUrl?: string;
  baseDir?: string;
}

// ─── Blink timings ──────────────────────────────────────────────────────────

const BLINK_DURATION_MS = 120;
const BLINK_MIN_INTERVAL_MS = 3000;
const BLINK_MAX_INTERVAL_MS = 5000;

function nextBlinkDelay(): number {
  return (
    BLINK_MIN_INTERVAL_MS +
    Math.random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS)
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export const PuppetCanvas = forwardRef<PuppetCanvasHandle, PuppetCanvasProps>(
  function PuppetCanvas(
    {
      visualState,
      manifestUrl = "/puppets/baby/puppet.json",
      baseDir = "/puppets/baby",
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [manifest, setManifest] = useState<PuppetManifest | null>(null);
    const [images, setImages] = useState<Map<string, HTMLImageElement>>(
      new Map()
    );
    const [loadError, setLoadError] = useState(false);

    // Mutable refs for the rAF loop — avoids stale closures.
    const rafRef = useRef<number>(0);
    const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const blinkActiveRef = useRef(false);
    // mouth open factor 0..1 — set via imperative handle
    const mouthOpenRef = useRef(0);
    // current visual state ref for rAF closure
    const visualStateRef = useRef<BabyVisualState>(visualState);

    useEffect(() => {
      visualStateRef.current = visualState;
    }, [visualState]);

    // Expose lip-sync hook via imperative handle.
    useImperativeHandle(ref, () => ({
      setMouthOpen(open: number) {
        mouthOpenRef.current = Math.max(0, Math.min(1, open));
      },
    }));

    // ── 1. Fetch manifest ────────────────────────────────────────────────────
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

    // ── 2. Preload all layer images ──────────────────────────────────────────
    useEffect(() => {
      if (!manifest) return;
      const imgs = new Map<string, HTMLImageElement>();
      const promises = manifest.layers.map(
        (layer) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            // Normalise path: strip leading slash from file if baseDir already ends with /
            const filePath = layer.file.startsWith("/")
              ? layer.file
              : `${baseDir}/${layer.file}`;
            img.src = filePath;
            img.onload = () => {
              imgs.set(layer.name, img);
              resolve();
            };
            img.onerror = () => {
              // Still resolve so Promise.all doesn't hang on a missing layer.
              resolve();
            };
          })
      );
      Promise.all(promises).then(() => {
        setImages(new Map(imgs));
      });
    }, [manifest, baseDir]);

    // ── 3. rAF render loop (idle bob + blink + compositing) ─────────────────
    useEffect(() => {
      if (!manifest || images.size === 0 || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = manifest.canvas;
      canvas.width = width;
      canvas.height = height;

      // Schedule blink cycles.
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

      // Core render function — called every animation frame.
      function render(timestamp: number) {
        if (!ctx) return;

        const currentState = visualStateRef.current;
        const expr =
          manifest!.expressions[currentState] ??
          manifest!.expressions["settled"];

        // Idle vertical bob: ±2px over ~6.3s cycle
        const bobY = Math.sin(timestamp * 0.001) * 2;

        ctx.clearRect(0, 0, width, height);

        // Draw layers in manifest order, applying bob offset.
        for (const layerName of expr.layers) {
          const img = images.get(layerName);
          if (!img) continue;

          // During a blink, substitute the settled eye layer for the current eye.
          const isEyeLayer = layerName === expr.eyeLayer;
          const imgToDraw =
            isEyeLayer && blinkActiveRef.current
              ? (images.get("eyes_settled") ?? img)
              : img;

          // Apply bob offset (translate context per-draw for the bob effect).
          ctx.save();
          ctx.translate(0, bobY);
          ctx.drawImage(imgToDraw, 0, 0, width, height);
          ctx.restore();
        }

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
      // Re-run only when manifest/images are ready — visualState is read via ref.
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
  }
);
