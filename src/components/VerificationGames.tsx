import { useEffect, useMemo, useRef, useState } from "react";
import "./VerificationGames.css";

type Question = {
  id: string;
  prompt: string;
  options: { label: string; value: string; passing?: boolean }[];
};

const QUESTIONS: Question[] = [
  {
    id: "consent",
    prompt: "Confirm: this is a rehearsal. The Ministry is not transmitting.",
    options: [
      { label: "Confirmed", value: "yes", passing: true },
      { label: "Negotiating", value: "no" },
    ],
  },
  {
    id: "night_shift",
    prompt: "At 2:07 AM, who gets up first?",
    options: [
      { label: "Me", value: "me", passing: true },
      { label: "Partner", value: "partner", passing: true },
      { label: "Whoever cracks", value: "either", passing: true },
    ],
  },
  {
    id: "support",
    prompt: "Name one person you'd call before becoming a tragic monologue.",
    options: [
      { label: "A friend", value: "friend", passing: true },
      { label: "A parent", value: "parent", passing: true },
      { label: "No one", value: "none" },
    ],
  },
  {
    id: "panic",
    prompt: "If everything is loud, your plan is…",
    options: [
      { label: "Pause, breathe, keep baby safe", value: "safe", passing: true },
      { label: "Panic productively", value: "panic" },
    ],
  },
];

type Tool = { name: string; args: Record<string, unknown> };

type Props = {
  officerName: string;
  durationMs?: number;
  onComplete: () => void;
};

export function VerificationGames({ officerName, durationMs = 12000, onComplete }: Props) {
  const [progress, setProgress] = useState(0);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [toolLog, setToolLog] = useState<Tool[]>([]);
  const startedAtRef = useRef(performance.now());
  const completedRef = useRef(false);

  const active = QUESTIONS[activeIdx];

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const t = (performance.now() - startedAtRef.current) / durationMs;
      setProgress(Math.min(1, t));
      if (t < 1) raf = requestAnimationFrame(step);
      else if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, onComplete]);

  // Officer "asks_intake_question" tool log entry per active question.
  useEffect(() => {
    setToolLog((log) => [
      { name: "ask_intake_question", args: { officer: officerName, questionId: active.id } },
      ...log,
    ].slice(0, 8));
  }, [active.id, officerName]);

  function answer(value: string) {
    setAnswered((a) => ({ ...a, [active.id]: value }));
    setToolLog((log) => [
      { name: "record_answer", args: { questionId: active.id, answer: value } },
      ...log,
    ].slice(0, 8));
    if (activeIdx < QUESTIONS.length - 1) {
      setActiveIdx((i) => i + 1);
    }
  }

  const generationLabels = useMemo(() => {
    return [
      "Initializing baby seed",
      "Compositing 2.5D puppet rig",
      "Synthesizing cry pack",
      "Generating partner profile",
      "Composing verdict templates",
      "Verifying intake responses",
    ];
  }, []);
  const labelIdx = Math.floor(progress * (generationLabels.length - 0.001));
  const generationLabel = generationLabels[Math.min(generationLabels.length - 1, labelIdx)];

  return (
    <div className="verif-games">
      <div className="verif-progress">
        <div className="verif-progress-head">
          <span className="kicker">{generationLabel}</span>
          <span className="verif-progress-pct">{Math.round(progress * 100)}%</span>
        </div>
        <div className="verif-progress-track">
          <div className="verif-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="verif-questions">
        <span className="kicker">Intake question {activeIdx + 1} / {QUESTIONS.length}</span>
        <h3>{active.prompt}</h3>
        <div className="verif-options">
          {active.options.map((opt) => (
            <button
              key={opt.value}
              className={answered[active.id] === opt.value ? "primary" : ""}
              onClick={() => answer(opt.value)}
              disabled={Boolean(answered[active.id])}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <details className="verif-tool-log">
        <summary><span className="kicker">Tool calls (officer agent)</span></summary>
        <ul>
          {toolLog.map((t, i) => (
            <li key={i}><strong>{t.name}</strong> {JSON.stringify(t.args)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
