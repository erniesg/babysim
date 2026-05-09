import { useCallback, useEffect, useRef, useState } from "react";
import "./VerificationGames.css";
import { RockPaperScissors } from "./verify/RockPaperScissors";
import { VoiceVerify } from "./verify/VoiceVerify";
import { KeyMash } from "./verify/KeyMash";
import { KeySequence } from "./verify/KeySequence";

type ChallengeId = "rps" | "voice" | "keymash" | "konami";
type ChallengeOutcome = "pass" | "fail" | "skip";

type Tool = { name: string; args: Record<string, unknown> };

type Props = {
  officerName: string;
  durationMs?: number;
  onComplete: () => void;
};

const CHALLENGE_IDS: ChallengeId[] = ["rps", "voice", "keymash", "konami"];
const CHALLENGE_LABELS: Record<ChallengeId, string> = {
  rps: "Hand Gesture Identification",
  voice: "Verbal Compliance Check",
  keymash: "Parental Urgency Calibration",
  konami: "Sequence Memory Assessment",
};

const GENERATION_LABELS = [
  "Initializing baby seed",
  "Compositing 2.5D puppet rig",
  "Synthesizing cry pack",
  "Generating partner profile",
  "Composing verdict templates",
  "Verifying intake responses",
];

interface ChallengeSharedProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
}

export function VerificationGames({ officerName, durationMs = 11000, onComplete }: Props) {
  // ─── challenge sequencing ───────────────────────────────────────────────────
  const [challengeIdx, setChallengeIdx] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [toolLog, setToolLog] = useState<Tool[]>([]);
  const completedRef = useRef(false);

  // ─── time-based overall progress (kept for the generation-label bar) ────────
  const startedAtRef = useRef(performance.now());
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const t = (performance.now() - startedAtRef.current) / durationMs;
      setProgress(Math.min(1, t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  // ─── log initial challenge entry ────────────────────────────────────────────
  const currentId = CHALLENGE_IDS[challengeIdx] as ChallengeId | undefined;
  useEffect(() => {
    if (!currentId) return;
    setToolLog((log) =>
      [
        {
          name: "start_challenge",
          args: { officer: officerName, challenge: currentId },
        },
        ...log,
      ].slice(0, 12)
    );
  }, [currentId, officerName]);

  // ─── shared advance logic ────────────────────────────────────────────────────
  const recordAndAdvance = useCallback(
    (challenge: ChallengeId, outcome: ChallengeOutcome) => {
      setToolLog((log) =>
        [
          {
            name: "record_challenge_result",
            args: { challenge, outcome },
          },
          ...log,
        ].slice(0, 12)
      );

      setChallengeIdx((i) => {
        const next = i + 1;
        if (next >= CHALLENGE_IDS.length) {
          setAllDone(true);
        }
        return next;
      });
    },
    []
  );

  // ─── fire onComplete exactly once when all done ─────────────────────────────
  useEffect(() => {
    if (!allDone) return;
    if (completedRef.current) return;
    completedRef.current = true;
    // Small grace delay so the last challenge can render its done state
    const t = setTimeout(() => onComplete(), 800);
    return () => clearTimeout(t);
  }, [allDone, onComplete]);

  // ─── shared props factory ────────────────────────────────────────────────────
  function makeProps(id: ChallengeId): ChallengeSharedProps {
    return {
      officerName,
      onPass: () => recordAndAdvance(id, "pass"),
      onFail: () => recordAndAdvance(id, "fail"),
      onSkip: (_reason: string) => recordAndAdvance(id, "skip"),
    };
  }

  // ─── progress bar label ──────────────────────────────────────────────────────
  const labelIdx = Math.floor(progress * (GENERATION_LABELS.length - 0.001));
  const generationLabel = GENERATION_LABELS[Math.min(GENERATION_LABELS.length - 1, labelIdx)];

  return (
    <div className="verif-games">
      {/* Overall generation progress bar */}
      <div className="verif-progress">
        <div className="verif-progress-head">
          <span className="kicker">{generationLabel}</span>
          <span className="verif-progress-pct">{Math.round(progress * 100)}%</span>
        </div>
        <div className="verif-progress-track">
          <div className="verif-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {/* Challenge step indicator */}
      {!allDone && currentId && (
        <div className="verif-questions">
          <span className="kicker">
            Challenge {challengeIdx + 1} / {CHALLENGE_IDS.length} —{" "}
            {CHALLENGE_LABELS[currentId]}
          </span>

          {currentId === "rps" && <RockPaperScissors {...makeProps("rps")} />}
          {currentId === "voice" && <VoiceVerify {...makeProps("voice")} />}
          {currentId === "keymash" && <KeyMash {...makeProps("keymash")} />}
          {currentId === "konami" && <KeySequence {...makeProps("konami")} />}
        </div>
      )}

      {allDone && (
        <div className="verif-questions">
          <span className="kicker">Verification complete</span>
          <h3>All challenges cleared. Generating your simulation…</h3>
        </div>
      )}

      {/* Tool-call log expander */}
      <details className="verif-tool-log">
        <summary>
          <span className="kicker">Tool calls (officer agent)</span>
        </summary>
        <ul>
          {toolLog.map((t, i) => (
            <li key={i}>
              <strong>{t.name}</strong> {JSON.stringify(t.args)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
