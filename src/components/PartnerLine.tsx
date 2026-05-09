import type { PartnerTraits } from "@contracts/game-state";
import "./PartnerLine.css";

const AVATAR_URL: Record<PartnerTraits["archetype"], string> = {
  anxious: "/img/partner-anxious.png",
  chill: "/img/partner-chill.png",
  resentful: "/img/partner-resentful.png",
  overfunctioner: "/img/partner-overfunctioner.png",
};

type Props = {
  name: string;
  line?: string;
  fatigue: number;
  resentment: number;
  isAsleep: boolean;
  archetype: PartnerTraits["archetype"];
  /** When true, the partner takes the full stage (used during argument beats per the demo loop spec). */
  enlarged?: boolean;
};

export function PartnerLine({ name, line, fatigue, resentment, isAsleep, archetype, enlarged }: Props) {
  if (!line && !isAsleep && !enlarged) return null;
  return (
    <div className={`partner-line ${enlarged ? "enlarged" : ""} ${isAsleep ? "asleep" : ""}`}>
      <img
        className="partner-avatar"
        src={AVATAR_URL[archetype]}
        alt={`${name}, ${archetype} archetype`}
        onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
      />
      <div className="partner-meta">
        <span className="kicker">
          {name} · {archetype} · {isAsleep ? "asleep" : "awake"} · fatigue {Math.round(fatigue)} · resentment {Math.round(resentment)}
        </span>
        {line && <p className="partner-quote">"{line}"</p>}
      </div>
    </div>
  );
}
