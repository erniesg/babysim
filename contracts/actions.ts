export type GameAction =
  | "start_game"
  | "create_room"
  | "join_room"
  | "answer_intake"
  | "upload_photo"
  | "skip_photo"
  | "name_baby"
  | "feed"
  | "rock"
  | "sing"
  | "shush"
  | "hold"
  | "check_diaper"
  | "adjust_temperature"
  | "reposition"
  | "wait"
  | "shirk"
  | "wake_partner"
  | "get_up"
  | "comfort_partner"
  | "panic"
  | "skip_to";

export type ActionCategory =
  | "session"
  | "intake"
  | "care"
  | "night"
  | "argument"
  | "recovery";

export const ACTION_CATEGORIES: Record<GameAction, ActionCategory> = {
  start_game: "session",
  create_room: "session",
  join_room: "session",
  answer_intake: "intake",
  upload_photo: "intake",
  skip_photo: "intake",
  name_baby: "intake",
  feed: "care",
  rock: "care",
  sing: "care",
  shush: "care",
  hold: "care",
  check_diaper: "care",
  adjust_temperature: "care",
  reposition: "care",
  wait: "care",
  shirk: "night",
  wake_partner: "night",
  get_up: "night",
  comfort_partner: "argument",
  panic: "recovery",
  skip_to: "recovery",
};

