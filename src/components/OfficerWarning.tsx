import { useEffect, useState } from "react";
import "./OfficerWarning.css";

/**
 * OfficerWarning — overlay banner that surfaces an Officer line during
 * gameplay (without breaking the gameplay beat). Triggered by parent on
 * threshold crossings (shirks, baby health, etc.). Fades in, holds, fades
 * out. Audio playback is owned by the parent via muppet.say().
 */

type Props = {
  text: string | null;
  officerName: string;
  durationMs?: number;
};

export function OfficerWarning({ text, officerName, durationMs = 4500 }: Props) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!text) {
      setVisible(false);
      return;
    }
    setShown(text);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(t);
  }, [text, durationMs]);

  if (!shown) return null;
  return (
    <div className={`officer-warning ${visible ? "shown" : "hiding"}`} role="status" aria-live="polite">
      <span className="officer-warning-tag">{officerName} · note</span>
      <p className="officer-warning-text">"{shown}"</p>
    </div>
  );
}
