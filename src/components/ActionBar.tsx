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

const PRIMARY_ACTIONS: ReadonlyArray<GameAction> = [
  "start_game",
  "answer_intake",
  "name_baby",
  "get_up",
];

type Props = {
  actions: ReadonlyArray<GameAction>;
  onAction: (action: GameAction) => void;
  disabled?: boolean;
};

export function ActionBar({ actions, onAction, disabled }: Props) {
  if (!actions.length) return null;
  return (
    <div className="action-bar">
      {actions.map((a) => (
        <button
          key={a}
          className={PRIMARY_ACTIONS.includes(a) ? "primary" : ""}
          onClick={() => onAction(a)}
          disabled={disabled}
        >
          {LABELS[a] ?? a}
        </button>
      ))}
    </div>
  );
}
