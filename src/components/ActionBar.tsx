import { useCallback, useEffect, useRef, useState } from "react";
import type { GameAction } from "@contracts/actions";
import "./ActionBar.css";

const LABELS: Partial<Record<GameAction, string>> = {
  start_game: "Start new game",
  create_room: "Create room",
  join_room: "Join room",
  answer_intake: "Continue",
  upload_photo: "Use photo",
  skip_photo: "Skip photo",
  name_baby: "Name baby",
  feed: "Feed",
  rock: "Rock",
  sing: "Sing",
  shush: "Shush",
  hold: "Hold",
  check_diaper: "Check diaper",
  adjust_temperature: "Adjust warmth",
  reposition: "Reposition",
  wait: "Wait",
  shirk: "Pretend to sleep",
  wake_partner: "Wake partner",
  get_up: "Get up",
  comfort_partner: "Comfort partner",
  panic: "Panic",
  skip_to: "Skip",
};

const ICONS: Partial<Record<GameAction, string>> = {
  feed: "🍼",
  rock: "🤲",
  sing: "🎵",
  shush: "🤫",
  hold: "🫂",
  check_diaper: "🧷",
  adjust_temperature: "🌡️",
  reposition: "🔁",
  wait: "⏳",
  shirk: "😴",
  wake_partner: "👋",
  get_up: "🦵",
  comfort_partner: "💞",
};

const PRIMARY_ACTIONS: ReadonlyArray<GameAction> = [
  "start_game",
  "answer_intake",
  "name_baby",
  "get_up",
];

// Per-action cooldown (ms). Soothing actions disable themselves briefly so
// players can't spam, mirroring the agentic vision: "introduce cool-downs".
const COOLDOWN_MS: Partial<Record<GameAction, number>> = {
  feed: 1800,
  rock: 1400,
  sing: 1600,
  shush: 1200,
  hold: 1500,
  check_diaper: 1400,
  adjust_temperature: 1400,
  reposition: 1300,
  wait: 800,
  shirk: 2000,
  wake_partner: 2500,
};

type Props = {
  actions: ReadonlyArray<GameAction>;
  onAction: (action: GameAction) => void;
  disabled?: boolean;
  /** Optional spent-action limit. When set, displays a counter and disables
   *  the bar after the limit is reached. Used in argument / shirk_or_wake
   *  beats to constrain the player's choices. */
  actionPoints?: number;
};

export function ActionBar({ actions, onAction, disabled, actionPoints }: Props) {
  const [pressed, setPressed] = useState<Record<string, number>>({});
  const [pointsLeft, setPointsLeft] = useState<number | null>(actionPoints ?? null);
  const tickRef = useRef<number>(0);
  const [, forceTick] = useState(0);

  // Reset action-points budget whenever the prop changes (e.g. beat flip).
  useEffect(() => {
    setPointsLeft(actionPoints ?? null);
  }, [actionPoints]);

  // Tick the cooldown clock at ~60 fps so disabled state updates smoothly.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tickRef.current = performance.now();
      forceTick((n) => (n + 1) % 1024);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const press = useCallback(
    (a: GameAction) => {
      if (disabled) return;
      if (pointsLeft !== null && pointsLeft <= 0) return;

      const cd = COOLDOWN_MS[a];
      if (cd) {
        const lockUntil = pressed[a];
        if (lockUntil && performance.now() < lockUntil) return;
        setPressed((p) => ({ ...p, [a]: performance.now() + cd }));
      }
      if (pointsLeft !== null) setPointsLeft((n) => (n === null ? n : n - 1));

      onAction(a);
    },
    [disabled, pointsLeft, pressed, onAction],
  );

  if (!actions.length) return null;
  return (
    <div className="action-bar">
      {actions.map((a) => {
        const cd = COOLDOWN_MS[a];
        const lockUntil = pressed[a];
        const cooling = !!cd && lockUntil && performance.now() < lockUntil;
        const remaining = cooling ? Math.max(0, lockUntil - performance.now()) : 0;
        const cdProgress = cooling ? Math.min(1, 1 - remaining / (cd ?? 1)) : 1;
        const outOfPoints = pointsLeft !== null && pointsLeft <= 0;
        const justPressed = lockUntil && performance.now() - (lockUntil - (cd ?? 0)) < 320;
        return (
          <button
            key={a}
            className={[
              PRIMARY_ACTIONS.includes(a) ? "primary" : "",
              "action-btn",
              justPressed ? "action-btn-flash" : "",
              cooling ? "action-btn-cooldown" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => press(a)}
            disabled={disabled || cooling || outOfPoints}
            aria-disabled={disabled || cooling || outOfPoints}
          >
            <span className="action-btn-content">
              {ICONS[a] && <span className="action-btn-icon" aria-hidden="true">{ICONS[a]}</span>}
              <span>{LABELS[a] ?? a}</span>
            </span>
            {cd && (
              <span
                className="action-btn-cd"
                style={{ width: `${cdProgress * 100}%` }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      {pointsLeft !== null && (
        <span className="action-points" aria-label="action points remaining">
          {pointsLeft} / {actionPoints} actions
        </span>
      )}
    </div>
  );
}
