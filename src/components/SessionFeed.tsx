import { useEffect, useRef } from "react";
import "./SessionFeed.css";

export type FeedActor = "officer" | "partner" | "player" | "baby" | "gm" | "system";
export type FeedKind = "speech" | "action" | "state" | "beat" | "tool";

export type FeedEntry = {
  id: string;
  ts: number;
  actor: FeedActor;
  kind: FeedKind;
  text: string;
  speakerName?: string;
};

const ACTOR_LABEL: Record<FeedActor, string> = {
  officer: "Officer",
  partner: "Partner",
  player: "You",
  baby: "Baby",
  gm: "Director",
  system: "Ministry",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${m}:${s}`;
}

type Props = {
  entries: FeedEntry[];
  liveText?: string | null;
  liveSpeaker?: string;
};

export function SessionFeed({ entries, liveText, liveSpeaker }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, liveText]);

  return (
    <section className="session-feed" aria-live="polite" aria-label="Session log">
      <header className="session-feed-head">
        <span className="kicker">Session log</span>
        <span className="session-feed-count">{entries.length}</span>
      </header>
      <div ref={scrollRef} className="session-feed-scroll">
        {entries.length === 0 && !liveText && (
          <p className="session-feed-empty">The Ministry is preparing your file…</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className={`feed-row feed-${e.actor} feed-kind-${e.kind}`}>
            <div className="feed-meta">
              <span className="feed-actor">{e.speakerName ?? ACTOR_LABEL[e.actor]}</span>
              <span className="feed-ts">{formatTime(e.ts)}</span>
            </div>
            <p className="feed-text">{e.text}</p>
          </div>
        ))}
        {liveText && (
          <div className="feed-row feed-officer feed-kind-speech feed-live">
            <div className="feed-meta">
              <span className="feed-actor">{liveSpeaker ?? "Officer"}</span>
              <span className="feed-ts feed-live-tag">live</span>
            </div>
            <p className="feed-text">"{liveText}"</p>
          </div>
        )}
      </div>
    </section>
  );
}
