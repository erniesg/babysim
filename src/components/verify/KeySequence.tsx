import { useCallback, useEffect, useRef, useState } from "react";
import "./KeySequence.css";

interface ChallengeProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
}

type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
const ARROW_DISPLAY: Record<ArrowKey, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
const ALL_ARROWS: ArrowKey[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

const SEQUENCE_LEN = 5;
const TIME_LIMIT_MS = 8000;

function randomSequence(): ArrowKey[] {
  return Array.from({ length: SEQUENCE_LEN }, () =>
    ALL_ARROWS[Math.floor(Math.random() * ALL_ARROWS.length)]
  );
}

type Phase = "briefing" | "dictating" | "active" | "done-pass" | "done-fail" | "retry";

type ArrowState = "waiting" | "active" | "done" | "error";

export function KeySequence({ officerName, onPass, onSkip }: ChallengeProps) {
  const [sequence] = useState<ArrowKey[]>(() => randomSequence());
  const [phase, setPhase] = useState<Phase>("briefing");
  const [dictateIdx, setDictateIdx] = useState<number>(-1);
  const [playerInput, setPlayerInput] = useState<ArrowKey[]>([]);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT_MS);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [retryUsed, setRetryUsed] = useState(false);
  const [arrowStates, setArrowStates] = useState<ArrowState[]>(
    Array(SEQUENCE_LEN).fill("waiting")
  );

  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  // Dictation phase: reveal arrows one at a time on 1.5s rhythm
  useEffect(() => {
    if (phase !== "dictating") return;
    setDictateIdx(0);
    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      if (idx >= SEQUENCE_LEN) {
        clearInterval(interval);
        // Small gap then go active
        setTimeout(() => {
          setPhase("active");
          setArrowStates(Array(SEQUENCE_LEN).fill("waiting"));
        }, 600);
      } else {
        setDictateIdx(idx);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [phase]);

  // Timer during active phase
  useEffect(() => {
    if (phase !== "active") return;
    startTimeRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const remaining = Math.max(0, TIME_LIMIT_MS - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setPhase("done-fail");
        setStatusMsg(
          "Time expired. " + (retryUsed ? "Sequence not completed." : "One retry available.")
        );
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, retryUsed]);

  // Key handler
  const handleKey = useCallback(
    (key: ArrowKey) => {
      if (phase !== "active") return;
      setPlayerInput((prev) => {
        const next = [...prev, key];
        const pos = prev.length; // 0-based index of the key just pressed

        if (key !== sequence[pos]) {
          // Wrong key — shake and reset
          setArrowStates((s) => {
            const ns = [...s];
            ns[pos] = "error";
            return ns;
          });
          setTimeout(() => {
            setArrowStates(Array(SEQUENCE_LEN).fill("waiting"));
          }, 500);
          return []; // reset input
        }

        // Correct key
        setArrowStates((s) => {
          const ns = [...s];
          ns[pos] = "done";
          return ns;
        });

        if (next.length === SEQUENCE_LEN) {
          // Full sequence correct
          setStatusMsg("Sequence confirmed. You are compliant.");
          setPhase("done-pass");
        }

        return next;
      });
    },
    [phase, sequence]
  );

  useEffect(() => {
    if (phase !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      if (ALL_ARROWS.includes(e.code as ArrowKey)) {
        e.preventDefault();
        handleKey(e.code as ArrowKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, handleKey]);

  // Auto-advance after pass
  useEffect(() => {
    if (phase !== "done-pass") return;
    const t = setTimeout(() => onPass(), 1800);
    return () => clearTimeout(t);
  }, [phase, onPass]);

  // Auto-skip after second fail
  useEffect(() => {
    if (phase !== "done-fail" || !retryUsed) return;
    const t = setTimeout(() => onSkip("Key sequence failed after retry"), 2000);
    return () => clearTimeout(t);
  }, [phase, retryUsed, onSkip]);

  const startRetry = () => {
    setRetryUsed(true);
    setPlayerInput([]);
    setArrowStates(Array(SEQUENCE_LEN).fill("waiting"));
    setStatusMsg("");
    setTimeLeft(TIME_LIMIT_MS);
    setPhase("dictating");
    setDictateIdx(-1);
  };

  const timeFrac = timeLeft / TIME_LIMIT_MS;

  return (
    <div className="keyseq-challenge">
      <p className="keyseq-brief">
        {officerName} will display a sequence of arrow keys. Memorize them. Then press them in
        order — all {SEQUENCE_LEN} — within 8 seconds.
      </p>

      {phase === "briefing" && (
        <div className="keyseq-actions">
          <button className="primary" onClick={() => setPhase("dictating")}>
            Show sequence
          </button>
        </div>
      )}

      {phase === "dictating" && (
        <>
          <div className="keyseq-input-label">Memorize this sequence:</div>
          <div className="keyseq-sequence-row">
            {sequence.map((arrow, i) => (
              <div
                key={i}
                className={`keyseq-arrow ${
                  i < dictateIdx ? "keyseq-done" : i === dictateIdx ? "keyseq-active" : "keyseq-waiting"
                }`}
              >
                {ARROW_DISPLAY[arrow]}
              </div>
            ))}
          </div>
        </>
      )}

      {(phase === "active" || phase === "done-pass" || phase === "done-fail") && (
        <>
          <div className="keyseq-input-label">Target sequence</div>
          <div className="keyseq-sequence-row">
            {sequence.map((arrow, i) => (
              <div
                key={i}
                className={`keyseq-arrow ${arrowStates[i] === "active" ? "keyseq-active" : arrowStates[i] === "done" ? "keyseq-done" : arrowStates[i] === "error" ? "keyseq-error" : ""}`}
              >
                {ARROW_DISPLAY[arrow]}
              </div>
            ))}
          </div>

          <div className="keyseq-input-label">Your input</div>
          <div className="keyseq-input-row">
            {playerInput.length === 0 && phase === "active" && (
              <span style={{ color: "var(--dim)", fontSize: "13px" }}>
                Press the arrow keys…
              </span>
            )}
            {playerInput.map((k, i) => (
              <div key={i} className="keyseq-input-arrow">{ARROW_DISPLAY[k]}</div>
            ))}
          </div>

          {phase === "active" && (
            <div className="keyseq-timer">
              <div className="keyseq-timer-head">
                <span className="kicker">Time remaining</span>
                <span className="keyseq-time-left">{(timeLeft / 1000).toFixed(1)}s</span>
              </div>
              <div className="keyseq-timer-track">
                <div
                  className="keyseq-timer-fill"
                  style={{ width: `${timeFrac * 100}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <p className={`keyseq-status ${phase === "done-pass" ? "good" : phase === "done-fail" ? "warn" : ""}`}>
        {statusMsg}
      </p>

      <div className="keyseq-actions">
        {phase === "done-fail" && !retryUsed && (
          <button onClick={startRetry}>Retry</button>
        )}
        {phase === "done-fail" && retryUsed && (
          <button onClick={() => onSkip("Key sequence failed after retry")}>Proceed</button>
        )}
      </div>
    </div>
  );
}
