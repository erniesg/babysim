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

export function BabyVisual({ visualState, name, mood }: Props) {
  const view = STATE[visualState];
  const animate = visualState === "crying" || visualState === "fussy";

  return (
    <div
      className={`baby-visual ${animate ? "shake" : ""}`}
      style={{ background: view.bg }}
      role="img"
      aria-label={`Baby ${name ?? ""} is ${view.label.toLowerCase()}`}
    >
      <img src={view.url} alt="" className="baby-photo" />
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
