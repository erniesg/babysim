import type { GameAction } from "./actions";
import type { DirectorCommand } from "./director-commands";
import type { Phase } from "./game-state";

export type BeatId =
  | "home"
  | "probation_splash"
  | "officer_intro"
  | "photo_intake"
  | "verification_games"
  | "generation_progress"
  | "ominous_warning"
  | "baby_roll"
  | "baby_arrival"
  | "first_calm"
  | "first_cry"
  | "discovery_soothing"
  | "time_jump_evening"
  | "night_cry"
  | "shirk_or_wake"
  | "argument_start"
  | "argument_resolution"
  | "night_soothe"
  | "cute_payoff"
  | "verdict"
  | "debrief_card";

export type BeatSpec = {
  id: BeatId;
  phase: Phase;
  allowedActions: GameAction[];
  entryEffects: DirectorCommand[];
  exitConditions: string[];
  possibleNextBeats: BeatId[];
  timeoutMs?: number;
  fallbackBeat?: BeatId;
};

export const BEAT_GRAPH: Record<BeatId, BeatSpec> = {
  home: {
    id: "home",
    phase: "home",
    allowedActions: ["start_game", "create_room", "join_room"],
    entryEffects: [{ type: "SET_CAPTION", text: "Start a new probation file or join a room." }],
    exitConditions: ["session_created"],
    possibleNextBeats: ["probation_splash"],
  },
  probation_splash: {
    id: "probation_splash",
    phase: "intake",
    allowedActions: ["answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Welcome to Probation." }],
    exitConditions: ["audio_unlocked", "splash_acknowledged"],
    possibleNextBeats: ["officer_intro"],
    timeoutMs: 2200,
    fallbackBeat: "officer_intro",
  },
  officer_intro: {
    id: "officer_intro",
    phase: "intake",
    allowedActions: ["answer_intake"],
    entryEffects: [
      { type: "SET_CAPTION", text: "Officer intake begins. This is a stress rehearsal, not medical advice." },
    ],
    exitConditions: ["officer_intro_complete", "intake_choice_made"],
    // The Adopt-or-Generate chooser pops in-stage at the END of officer_intro
    // (before scene_ack), then the engine routes straight into verification —
    // photo_intake is skipped because RPS captures a webcam frame as the case file.
    possibleNextBeats: ["verification_games", "photo_intake"],
  },
  // Kept for backwards compat / opt-in; current flow skips it.
  photo_intake: {
    id: "photo_intake",
    phase: "intake",
    allowedActions: ["upload_photo", "skip_photo", "answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Upload, webcam, or skip. Photos are theatrical in v0." }],
    exitConditions: ["photo_uploaded", "photo_skipped"],
    possibleNextBeats: ["verification_games"],
  },
  verification_games: {
    id: "verification_games",
    phase: "generation",
    allowedActions: ["answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Complete quick verification drills while generation progresses." }],
    exitConditions: ["verification_complete"],
    possibleNextBeats: ["generation_progress"],
    timeoutMs: 20000,
    fallbackBeat: "generation_progress",
  },
  generation_progress: {
    id: "generation_progress",
    phase: "generation",
    allowedActions: [],
    entryEffects: [{ type: "SET_CAPTION", text: "Generating your probation scenario." }],
    exitConditions: ["progress_complete"],
    possibleNextBeats: ["ominous_warning"],
    timeoutMs: 12000,
    fallbackBeat: "ominous_warning",
  },
  ominous_warning: {
    id: "ominous_warning",
    phase: "generation",
    allowedActions: ["answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Care labor, shirking, and night shifts will be recorded." }],
    exitConditions: ["warning_acknowledged"],
    possibleNextBeats: ["baby_roll"],
  },
  baby_roll: {
    id: "baby_roll",
    phase: "reveal",
    allowedActions: ["name_baby"],
    entryEffects: [{ type: "SET_CAPTION", text: "A child profile has been assigned. Name the baby." }],
    exitConditions: ["baby_named"],
    possibleNextBeats: ["baby_arrival"],
  },
  baby_arrival: {
    id: "baby_arrival",
    phase: "reveal",
    allowedActions: ["answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Your child has arrived." }],
    exitConditions: ["arrival_acknowledged"],
    possibleNextBeats: ["first_calm"],
    timeoutMs: 4500,
    fallbackBeat: "first_calm",
  },
  first_calm: {
    id: "first_calm",
    phase: "gameplay",
    allowedActions: ["feed", "rock", "sing", "shush", "hold", "check_diaper", "adjust_temperature", "reposition", "wait"],
    entryEffects: [{ type: "SET_CAPTION", text: "The room is quiet. For now." }],
    exitConditions: ["first_cry_triggered"],
    possibleNextBeats: ["first_cry"],
    timeoutMs: 5000,
    fallbackBeat: "first_cry",
  },
  first_cry: {
    id: "first_cry",
    phase: "gameplay",
    allowedActions: ["feed", "rock", "sing", "shush", "hold", "check_diaper", "adjust_temperature", "reposition", "wait"],
    entryEffects: [
      { type: "PLAY_AUDIO", channel: "baby", assetId: "babyAudio.discomfort", loop: true },
      { type: "SET_CAPTION", text: "The baby is crying. Try to discover what works." },
    ],
    exitConditions: ["soothing_attempted"],
    possibleNextBeats: ["discovery_soothing"],
    // Safety net so the game never hangs here even if the player goes idle.
    timeoutMs: 12000,
    fallbackBeat: "discovery_soothing",
  },
  discovery_soothing: {
    id: "discovery_soothing",
    phase: "gameplay",
    allowedActions: ["feed", "rock", "sing", "shush", "hold", "check_diaper", "adjust_temperature", "reposition", "wait"],
    entryEffects: [{ type: "SET_CAPTION", text: "Watch how the baby reacts. The right response depends on hidden traits." }],
    exitConditions: ["cry_resolved"],
    possibleNextBeats: ["time_jump_evening"],
    timeoutMs: 14000,
    fallbackBeat: "time_jump_evening",
  },
  time_jump_evening: {
    id: "time_jump_evening",
    phase: "gameplay",
    allowedActions: ["answer_intake"],
    entryEffects: [
      { type: "STOP_AUDIO", channel: "baby" },
      { type: "ADVANCE_TIME", hours: 8 },
      { type: "SET_CAPTION", text: "Hours pass. Hunger, sleep, and fatigue keep moving." },
    ],
    exitConditions: ["time_jump_complete"],
    possibleNextBeats: ["night_cry"],
    timeoutMs: 6000,
    fallbackBeat: "night_cry",
  },
  night_cry: {
    id: "night_cry",
    phase: "night",
    allowedActions: ["get_up", "shirk", "wake_partner", "wait"],
    entryEffects: [
      { type: "PLAY_AUDIO", channel: "baby", assetId: "babyAudio.tired", loop: true },
      { type: "SET_CAPTION", text: "2:07 AM. The baby is crying. Your partner is asleep." },
    ],
    exitConditions: ["night_responsibility_chosen"],
    possibleNextBeats: ["shirk_or_wake", "night_soothe"],
    timeoutMs: 9000,
    fallbackBeat: "shirk_or_wake",
  },
  shirk_or_wake: {
    id: "shirk_or_wake",
    phase: "night",
    allowedActions: ["get_up", "shirk", "wake_partner", "wait"],
    entryEffects: [{ type: "SET_CAPTION", text: "Your choice is now part of the ledger." }],
    exitConditions: ["argument_started", "shift_accepted"],
    possibleNextBeats: ["argument_start", "night_soothe"],
    timeoutMs: 8000,
    fallbackBeat: "argument_start",
  },
  argument_start: {
    id: "argument_start",
    phase: "argument",
    allowedActions: ["get_up", "comfort_partner", "shirk"],
    entryEffects: [
      { type: "STOP_AUDIO", channel: "baby" },
      { type: "SET_CAPTION", text: "The argument starts. The baby still needs care." },
    ],
    exitConditions: ["argument_line_delivered"],
    possibleNextBeats: ["argument_resolution"],
  },
  argument_resolution: {
    id: "argument_resolution",
    phase: "argument",
    allowedActions: ["get_up", "comfort_partner", "shirk"],
    entryEffects: [{ type: "SET_CAPTION", text: "Someone has to take the shift." }],
    exitConditions: ["conceder_selected", "shift_logged"],
    possibleNextBeats: ["night_soothe"],
    timeoutMs: 12000,
    fallbackBeat: "night_soothe",
  },
  night_soothe: {
    id: "night_soothe",
    phase: "night",
    allowedActions: ["feed", "rock", "sing", "shush", "hold", "check_diaper", "adjust_temperature", "reposition"],
    entryEffects: [
      { type: "PLAY_AUDIO", channel: "baby", assetId: "babyAudio.hunger", loop: true },
      { type: "SET_CAPTION", text: "Now soothe the baby." },
    ],
    exitConditions: ["night_cry_resolved"],
    possibleNextBeats: ["cute_payoff"],
    timeoutMs: 12000,
    fallbackBeat: "cute_payoff",
  },
  cute_payoff: {
    id: "cute_payoff",
    phase: "cute",
    allowedActions: ["answer_intake"],
    entryEffects: [
      { type: "STOP_AUDIO", channel: "baby" },
      { type: "SET_CAPTION", text: "She smiled at you." },
    ],
    exitConditions: ["cute_acknowledged"],
    possibleNextBeats: ["verdict"],
    timeoutMs: 6000,
    fallbackBeat: "verdict",
  },
  verdict: {
    id: "verdict",
    phase: "verdict",
    allowedActions: ["answer_intake"],
    entryEffects: [{ type: "SET_CAPTION", text: "Officer verdict is being prepared." }],
    exitConditions: ["verdict_complete"],
    possibleNextBeats: ["debrief_card"],
    timeoutMs: 10000,
    fallbackBeat: "debrief_card",
  },
  debrief_card: {
    id: "debrief_card",
    phase: "debrief",
    allowedActions: ["start_game"],
    entryEffects: [{ type: "SET_CAPTION", text: "Your probation card is ready." }],
    exitConditions: ["replay_requested"],
    possibleNextBeats: ["home"],
  },
};

