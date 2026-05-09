import { useCallback, useEffect, useRef, useState } from "react";
import "./KeyMash.css";

interface ChallengeProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
}

const TARGET = 20;
const WINDOW_MS = 5000;

type Phase = "waiting" | "active" | "done-pass" | "done-fail" | "retry";

export function KeyMash({ officerName, onPass, onSkip }: ChallengeProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [count, setCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(WINDOW_MS);
  const [bump, setBump] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [retryUsed, setRetryUsed] = useState(false);

  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("waiting");

  phaseRef.current = phase;

  const startChallenge = useCallback(() => {
    setCount(0);
    setTimeLeft(WINDOW_MS);
    setStatusMsg("");
    startTimeRef.current = performance.now();
    setPhase("active");
  }, []);

  // Timer RAF
  useEffect(() => {
    if (phase !== "active") return;
    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const remaining = Math.max(0, WINDOW_MS - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setCount((c) => {
          const final = c;
          if (final >= TARGET) {
            setStatusMsg("Target reached. Parental urgency confirmed.");
            setPhase("done-pass");
          } else {
            setStatusMsg(
              `${final} / ${TARGET}. ` +
              (retryUsed ? "Insufficient urgency logged." : "You may retry once.")
            );
            setPhase("done-fail");
          }
          return c;
        });
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, retryUsed]);

  // Key handler
  useEffect(() => {
    if (phase !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setCount((c) => {
          const next = c + 1;
          if (next >= TARGET) {
            setStatusMsg("Target reached. Parental urgency confirmed.");
            setPhase("done-pass");
          }
          return next;
        });
        setBump(true);
        setTimeout(() => setBump(false), 120);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // Also handle tap for mobile
  const handleTap = useCallback(() => {
    if (phase !== "active") return;
    setCount((c) => {
      const next = c + 1;
      if (next >= TARGET) {
        setStatusMsg("Target reached. Parental urgency confirmed.");
        setPhase("done-pass");
      }
      return next;
    });
    setBump(true);
    setTimeout(() => setBump(false), 120);
  }, [phase]);

  // Auto-advance after pass
  useEffect(() => {
    if (phase !== "done-pass") return;
    const t = setTimeout(() => onPass(), 1600);
    return () => clearTimeout(t);
  }, [phase, onPass]);

  // Auto-skip after second fail
  useEffect(() => {
    if (phase !== "done-fail" || !retryUsed) return;
    const t = setTimeout(() => onSkip(`Key-mash: only ${count}/${TARGET} after retry`), 2000);
    return () => clearTimeout(t);
  }, [phase, retryUsed, count, onSkip]);

  const timeFrac = timeLeft / WINDOW_MS;
  const isUrgent = timeFrac < 0.35;

  return (
    <div className="keymash-challenge">
      <p className="keymash-brief">
        {officerName} demands parental urgency. Strike{" "}
        <strong>SPACE</strong> twenty times in five seconds. Or tap the button below.
      </p>

      <div className="keymash-counter-box">
        <div className={`keymash-count ${bump ? "keymash-bump" : ""}`}>{count}</div>
        <div className="keymash-target">
          / <span>{TARGET}</span>
        </div>
      </div>

      {phase === "active" && (
        <div className="keymash-timer">
          <div className="keymash-timer-label">
            <span className="kicker">Time</span>
            <span className="keymash-time-left">{(timeLeft / 1000).toFixed(1)}s</span>
          </div>
          <div className="keymash-timer-track">
            <div
              className={`keymash-timer-fill ${isUrgent ? "keymash-urgent" : ""}`}
              style={{ width: `${timeFrac * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="keymash-key-visual">
        <div className={`keymash-key ${phase === "active" && bump ? "keymash-pressed" : ""}`}>
          SPACE
        </div>
      </div>

      <p className={`keymash-status ${phase === "done-pass" ? "good" : phase === "done-fail" ? "warn" : ""}`}>
        {statusMsg}
      </p>

      <div className="keymash-actions">
        {phase === "waiting" && (
          <button className="primary" onClick={startChallenge}>
            Begin
          </button>
        )}
        {phase === "active" && (
          <button className="primary" onClick={handleTap} style={{ padding: "18px 36px", fontSize: "18px" }}>
            TAP (mobile)
          </button>
        )}
        {phase === "done-fail" && !retryUsed && (
          <button onClick={() => { setRetryUsed(true); startChallenge(); }}>
            Retry
          </button>
        )}
        {phase === "done-fail" && retryUsed && (
          <button onClick={() => onSkip(`Key-mash: only ${count}/${TARGET} after retry`)}>
            Proceed
          </button>
        )}
      </div>
    </div>
  );
}
