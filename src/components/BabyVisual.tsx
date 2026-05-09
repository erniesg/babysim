import { useRef, useEffect } from "react";
import type { BabyVisualState } from "@contracts/game-state";
import "./BabyVisual.css";

// Photoreal 2.5D puppet from the internal-pipeline pipeline.
// Pre-baked deterministic baseline; live generation will swap these in via
// /api/baby/portrait once that endpoint lands.
const STATE: Record<BabyVisualState, { url: string; label: string; bg: string }> = {
  settled: { url: "/img/baby/settled.png", label: "Settled", bg: "#1f2933" },
  drowsy:  { url: "/img/baby/drowsy.png",  label: "Drowsy",  bg: "#272235" },
  hungry:  { url: "/img/baby/hungry.png",  label: "Hungry",  bg: "#3a1f14" },
  fussy:   { url: "/img/baby/fussy.png",   label: "Fussy",   bg: "#3a1f1f" },
  crying:  { url: "/img/baby/crying.png",  label: "Crying",  bg: "#4a1414" },
  sleep:   { url: "/img/baby/sleep.png",   label: "Asleep",  bg: "#161b2c" },
};

type Props = {
  visualState: BabyVisualState;
  name?: string;
  mood: number;
};

// Check whether a video path exists by attempting to load it.
// Returns the path on success, null on 404 or any error.
// Uses a HEAD request to avoid downloading the full file just for existence checking.
async function videoExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export function BabyVisual({ visualState, name, mood }: Props) {
  const view = STATE[visualState];
  const animate = visualState === "crying" || visualState === "fussy";

  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Track the previous visual state to build transition clip names.
  const prevStateRef = useRef<BabyVisualState>(visualState);
  // Track whether we're currently showing video (true) or PNG fallback (false).
  const showingVideoRef = useRef(false);

  // Set video volume once on mount.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = 0.5;
    }
  }, []);

  // React to visualState changes: attempt transition → idle → PNG fallback.
  useEffect(() => {
    const videoEl = videoRef.current;
    const imgEl = imgRef.current;
    if (!videoEl || !imgEl) return;

    const currentState = visualState;
    const previousState = prevStateRef.current;
    prevStateRef.current = currentState;

    const idlePath = `/video/baby/${currentState}-idle.mp4`;
    const transitionPath = `/video/baby/${previousState}-to-${currentState}.mp4`;

    // Shows the video element, hides the img fallback.
    function showVideo(src: string, loop: boolean) {
      videoEl!.loop = loop;
      videoEl!.src = src;
      videoEl!.load();
      videoEl!.play().catch(() => {
        // Autoplay may be blocked — fall through to PNG.
        showPng();
      });
      videoEl!.style.display = "";
      imgEl!.style.display = "none";
      showingVideoRef.current = true;
    }

    // Shows the PNG fallback, hides the video element.
    function showPng() {
      videoEl!.pause();
      videoEl!.removeAttribute("src");
      videoEl!.style.display = "none";
      imgEl!.style.display = "";
      imgEl!.src = STATE[currentState].url;
      showingVideoRef.current = false;
    }

    // Attempt: transition clip → idle clip → PNG.
    void (async () => {
      // Skip the transition check when the state hasn't changed (initial mount).
      if (previousState !== currentState) {
        const hasTransition = await videoExists(transitionPath);
        if (hasTransition) {
          showVideo(transitionPath, false);
          // When the transition finishes, chain into the idle loop.
          const onTransitionEnd = () => {
            videoEl!.removeEventListener("ended", onTransitionEnd);
            // State may have changed again while transition was playing.
            void videoExists(idlePath).then((hasIdle) => {
              if (hasIdle) {
                showVideo(idlePath, true);
              } else {
                showPng();
              }
            });
          };
          videoEl.addEventListener("ended", onTransitionEnd);
          return;
        }
      }

      // No transition clip (or initial mount): try idle loop directly.
      const hasIdle = await videoExists(idlePath);
      if (hasIdle) {
        showVideo(idlePath, true);
      } else {
        showPng();
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualState]);

  return (
    <div
      className={`baby-visual ${animate ? "shake" : ""}`}
      style={{ background: view.bg }}
      role="img"
      aria-label={`Baby ${name ?? ""} is ${view.label.toLowerCase()}`}
    >
      {/*
        Single <video> element — src is swapped by the effect above.
        Initially hidden; shown only when a video clip successfully loads.
        autoPlay is set so the browser starts as soon as src is assigned via effect.
        muted={false} so video-embedded baby audio plays (at volume 0.5, set on mount).
      */}
      <video
        ref={videoRef}
        autoPlay
        muted={false}
        playsInline
        className="baby-photo"
        style={{ display: "none" }}
      />
      {/* PNG fallback — always rendered so layout is stable; hidden when video is active. */}
      <img ref={imgRef} src={view.url} alt="" className="baby-photo" />
      <div className="baby-meta">
        <span className="baby-name">{name || "your baby"}</span>
        <span className="baby-state">{view.label}</span>
        <div className="mood-track" aria-label="mood">
          <div className="mood-fill" style={{ width: `${Math.max(2, mood)}%` }} />
        </div>
      </div>
    </div>
  );
}
