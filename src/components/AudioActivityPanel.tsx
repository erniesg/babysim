import { useEffect, useState } from "react";
import type { AudioDirector } from "../audio/AudioDirector";
import type { AudioChannel } from "@contracts/director-commands";
import "./AudioActivityPanel.css";

type Props = {
  audio: AudioDirector | null;
};

const LABELS: Record<AudioChannel, { dot: string; tag: string }> = {
  officer:  { dot: "speaking", tag: "Officer"  },
  partner:  { dot: "speaking", tag: "Partner"  },
  baby:     { dot: "crying",   tag: "Baby"     },
  ambient:  { dot: "playing",  tag: "Music"    },
};

const ORDER: AudioChannel[] = ["officer", "partner", "baby", "ambient"];

// Compact pulse-dot panel that subscribes to AudioDirector activity events
// and lights up a tag when each channel is producing sound. Clearer state
// signal for the player than a hidden audio element.
export function AudioActivityPanel({ audio }: Props) {
  const [active, setActive] = useState<Partial<Record<AudioChannel, boolean>>>({});

  useEffect(() => {
    if (!audio) return;
    return audio.onActivity((next) => setActive(next));
  }, [audio]);

  return (
    <div className="audio-activity">
      {ORDER.map((ch) => (
        <span
          key={ch}
          className={`audio-activity-pill ${active[ch] ? "is-on" : ""}`}
          title={`${LABELS[ch].tag} channel — ${active[ch] ? LABELS[ch].dot : "silent"}`}
        >
          <span className="audio-activity-dot" aria-hidden="true" />
          {LABELS[ch].tag}
        </span>
      ))}
    </div>
  );
}
