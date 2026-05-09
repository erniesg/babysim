# Baby animation — 2.5D layered puppet approach

Implementation guide for `src/baby-rig/PuppetCanvas.tsx`. Implement directly. No external project credits — this is original work.

## Concept

A photoreal baby rendered as a stack of pre-aligned PNG layers composited on a single `<canvas>`. Each layer is a full-frame 1024×1024 PNG with mostly transparent pixels and a tightly-cropped opaque region (face, eyes, mouth, etc.). Drawing them in z-order over a clean facial backplate gives the illusion of a single photoreal subject; swapping the eye + mouth layers on state change gives the illusion of expression change without re-rendering the whole figure.

## Manifest schema (`public/puppets/baby/puppet.json`)

```json
{
  "id": "baby-puppet-v1",
  "canvas": { "width": 1024, "height": 1024 },
  "layers": [
    { "name": "face_backplate", "file": "layers/face_backplate.png" },
    { "name": "eyes_settled",   "file": "layers/eyes_settled.png" },
    { "name": "mouth_settled",  "file": "layers/mouth_settled.png" },
    "...etc."
  ],
  "expressions": {
    "settled": {
      "layers":     ["face_backplate", "eyes_settled", "mouth_settled"],
      "eyeLayer":   "eyes_settled",
      "mouthLayer": "mouth_settled"
    },
    "crying": {
      "layers":      ["face_backplate", "eyes_crying", "mouth_crying_inner", "mouth_crying_rim"],
      "eyeLayer":    "eyes_crying",
      "mouthLayers": ["mouth_crying_inner", "mouth_crying_rim"]
    }
  }
}
```

The `layers` array under each expression is the **canonical draw order** — iterate it and `ctx.drawImage` each in sequence. No z-index calculation needed.

## Render loop (single `<canvas>`, single `requestAnimationFrame`)

```ts
function loop(t: number) {
  ctx.save();

  // 1. Vignette / glow backdrop ----------------------------------------------
  drawVignette(ctx, t, currentState);

  // 2. Idle ambient motion (translate + tiny rotate) -------------------------
  const bobY = Math.sin(t * 0.0016) * 2;            // ±2px slow vertical bob
  const tilt = Math.sin(t * 0.0009) * 0.012;        // ±0.7° micro head-tilt
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(tilt);
  ctx.translate(-canvas.width / 2, -canvas.height / 2 + bobY);

  // 3. Layer compositing -----------------------------------------------------
  if (transitioning) {
    drawLayerSet(prevExpr.layers, 1 - transitionProgress);  // fade out
    drawLayerSet(nextExpr.layers, transitionProgress);      // fade in
  } else {
    drawLayerSet(currentExpr.layers, 1.0);
  }

  // 4. Blink — eye-layer alpha dip every 3-5s --------------------------------
  if (isBlinking(t)) {
    overdrawEyeLayer(currentExpr.eyeLayer, 0.0);
  }

  // 5. Mouth aperture for lip-sync -------------------------------------------
  if (mouthOpen > 0 && currentExpr.mouthLayer) {
    overdrawMouth(currentExpr.mouthLayer, mouthOpen);     // see Lip-sync below
  }

  ctx.restore();
  requestAnimationFrame(loop);
}
```

## Vignette / glow backdrop

A radial gradient drawn before the figure layers, animated to give the scene atmosphere and to anchor the figure (helps with proportion / framing).

```ts
function drawVignette(ctx, t, state) {
  const g = ctx.createRadialGradient(
    canvas.width / 2, canvas.height * 0.45, 80,
    canvas.width / 2, canvas.height * 0.45, canvas.width * 0.7,
  );
  const palette = VIGNETTE_PALETTES[state]; // see below
  const pulse = 0.85 + 0.15 * Math.sin(t * palette.pulseHz * 0.001);
  g.addColorStop(0,   `rgba(${palette.center}, ${pulse * 0.55})`);
  g.addColorStop(0.6, `rgba(${palette.mid},    ${pulse * 0.25})`);
  g.addColorStop(1,   `rgba(${palette.edge},   1)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

const VIGNETTE_PALETTES = {
  settled: { center: "255, 220, 180", mid: "120, 80, 50",  edge: "20, 22, 30",  pulseHz: 0.5 },
  drowsy:  { center: "180, 150, 200", mid: "70, 60, 90",   edge: "20, 18, 30",  pulseHz: 0.3 },
  hungry:  { center: "240, 160, 100", mid: "120, 70, 40",  edge: "30, 18, 12",  pulseHz: 1.2 },
  fussy:   { center: "240, 130, 110", mid: "130, 60, 60",  edge: "30, 12, 14",  pulseHz: 1.4 },
  crying:  { center: "255, 110, 110", mid: "150, 30, 30",  edge: "40, 8, 8",    pulseHz: 2.0 },
  sleep:   { center: "120, 140, 200", mid: "40, 50, 90",   edge: "10, 12, 20",  pulseHz: 0.2 },
};
```

## Cross-faded expression transitions

Hard-swapping the layer set looks abrupt. Cross-fade over 350-500 ms.

```ts
function setExpression(next: BabyVisualState) {
  if (next === currentState) return;
  prevExpr = currentExpr;
  currentExpr = manifest.expressions[next];
  currentState = next;
  transitionStartedAt = performance.now();
  transitioning = true;
}

// inside loop:
const elapsed = performance.now() - transitionStartedAt;
const transitionProgress = Math.min(1, elapsed / TRANSITION_MS); // 400ms
if (transitionProgress >= 1) transitioning = false;
```

`drawLayerSet(layers, alpha)` sets `ctx.globalAlpha = alpha` then iterates the layer names, drawing each preloaded `HTMLImageElement` full-frame.

## Per-state idle motion

Don't make all states bob the same way. Adjust frequency + amplitude per state:

| State | Bob freq | Bob amp | Tilt amp | Notes |
|---|---|---|---|---|
| settled | 0.4 Hz | 2 px | 0.5° | calm, almost still |
| drowsy | 0.25 Hz | 1.5 px | 0.3° | barely moving |
| hungry | 0.7 Hz | 3 px | 0.8° | restless |
| fussy | 1.0 Hz | 4 px | 1.0° | + small head shakes (`sin(t*5) * 1.5°` masked over a 200 ms window every ~2 s) |
| crying | 1.4 Hz | 5 px | 1.4° | heaviest motion |
| sleep | 0.15 Hz | 1 px | 0° | just chest breathing |

Use a single noise-driven function with state-tunable params rather than per-state branches.

## Blink

Replace the eye layer with a near-zero alpha for ~120 ms every `3 + Math.random() * 2` seconds. Picks a random next-blink timestamp at each blink.

```ts
let nextBlinkAt = performance.now() + 3000;
function maybeBlink(t: number, eyeLayerName: string) {
  if (t < nextBlinkAt) return false;
  if (t < nextBlinkAt + 120) return true; // blink frame
  nextBlinkAt = t + 3000 + Math.random() * 2000;
  return false;
}
```

Optional: substitute a dedicated `eyes_*_closed.png` if available in the manifest; otherwise just dim the eye-layer alpha.

## Mouth lip-sync hook (audio-reactive)

Expose an imperative method on the React component:

```tsx
const ref = useRef<{ setMouthOpen: (v: number) => void }>(null);
// Caller (audio analyser) does:
ref.current?.setMouthOpen(rms / 0.4);
```

Inside the component, store `mouthOpenRef = useRef(0)` and update from `setMouthOpen`. In the render loop, if `mouthOpenRef.current > 0`:
- Stretch the mouth-layer y-scale by `1 + mouthOpen * 0.15` around its baseline pivot, OR
- Cross-fade between `mouth_settled` and `mouth_crying_inner` proportionally to `mouthOpen` so the aperture appears to widen.

Drive this from the existing AudioDirector. When the baby agent fires `play_audio` for a cry, the AudioDirector's analyser node feeds frame-by-frame RMS into `setMouthOpen`. While silent, `mouthOpen` decays toward 0.

## CSS sizing (issue #2 from HANDOFF — out of proportion)

```css
.baby-visual {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 60vh;
  aspect-ratio: 1024 / 1280; /* head + torso framing, not full figure */
  margin: 0 auto;
  overflow: hidden;
  border-radius: 16px;
  background: #0a0c12;
}
.baby-visual canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.baby-visual .baby-meta {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;          /* moved BELOW the figure, not on the chest */
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 10px;
  backdrop-filter: blur(8px);
}
```

The canvas's internal coordinate space stays 1024×1024 (or whatever the manifest declares); CSS `width: 100%; height: 100%` does the visual scaling. To frame head+torso instead of full figure, the canvas-to-CSS aspect is intentionally taller-than-square (`1024 / 1280`) so the lower portion of the figure is cropped — adjust by drawing layers with a vertical offset (`ctx.translate(0, -CROP_PX)`) so the head sits centered.

## File checklist for the agent picking this up

- Touch only `src/baby-rig/PuppetCanvas.tsx` and `src/components/BabyVisual.css`. Do not modify `BabyVisual.tsx`'s props (`visualState`, `name`, `mood`).
- After implementing: `npm run typecheck && npm run build` should both pass with zero errors.
- Visual smoke: render at each `BabyVisualState` in dev (`npm run dev:worker`) and confirm:
  - Glow backdrop is visible and pulses
  - Switching states cross-fades over ~400 ms
  - Bob + tilt are subtle but present
  - Blink fires randomly every 3-5 s
  - Eye + mouth layers align with the face backplate (no dark voids — see HANDOFF issue #3 for alignment fixes)
  - Metadata strip sits below the figure, not on the body
