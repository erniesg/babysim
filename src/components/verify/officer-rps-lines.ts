import type { MuppetCharacter, MuppetExpression, MuppetGesture } from "../../muppet/muppet-engine";

/**
 * In-character lines the officer voices while orchestrating RPS.
 *
 * Each line is { text, expression, gesture } so MuppetStage.say() can play
 * the audio (ElevenLabs) AND drive the rig pose. We keep these scripted
 * (not LLM) because they fire on tight 700 ms tick boundaries during the
 * countdown — round-tripping to gpt-5.5 would miss the cue. The officer
 * agent's own intro/warning/verdict beats remain LLM-driven.
 *
 * Three voices, three flavours:
 *   - Ernest: dry-mischievous UK lilt
 *   - Bern: severe, clipped declaratives
 *   - Crumb: Singlish-chaotic, kopitiam uncle
 */

export type OfficerLine = { text: string; expression: MuppetExpression; gesture: MuppetGesture };

// ── Lead-in: spoken once when RPS starts ──────────────────────────────────────
export function rpsLeadIn(character: MuppetCharacter): OfficerLine {
  switch (character) {
    case "Ernest":
      return { text: "Hand gesture identification. Best of three. Try not to overthink it.", expression: "skeptical", gesture: "lean" };
    case "Bern":
      return { text: "Hand gesture identification. Three rounds. Show your hand.", expression: "strict", gesture: "stamp" };
    case "Crumb":
      return { text: "Eh, this one easy lah — best of three. Show your hand to camera, can?", expression: "warm", gesture: "wave" };
  }
}

// ── Countdown: 3 / 2 / 1 / SHOOT ─────────────────────────────────────────────
// Tight, monosyllabic so they don't bleed into each other on 700 ms ticks.
export function rpsCountdown(character: MuppetCharacter, tick: "3" | "2" | "1" | "SHOOT!"): OfficerLine {
  if (character === "Crumb") {
    return tick === "SHOOT!"
      ? { text: "Show!", expression: "delighted", gesture: "point" }
      : { text: tick, expression: "skeptical", gesture: "none" };
  }
  if (character === "Bern") {
    return tick === "SHOOT!"
      ? { text: "Now.", expression: "strict", gesture: "stamp" }
      : { text: tick, expression: "strict", gesture: "none" };
  }
  return tick === "SHOOT!"
    ? { text: "Shoot.", expression: "skeptical", gesture: "point" }
    : { text: tick, expression: "skeptical", gesture: "none" };
}

// ── Round outcome reaction ──────────────────────────────────────────────────
// Three variants per outcome × character so consecutive rounds don't repeat.
const REACTIONS: Record<MuppetCharacter, Record<"win" | "loss" | "draw", string[]>> = {
  Ernest: {
    win: [
      "Point to you. Don't get used to it.",
      "Granted. The Ministry permits one small smugness.",
      "Yours. Filed.",
    ],
    loss: [
      "Mine, I'm afraid.",
      "The Ministry takes that one.",
      "Closer than I'd hoped. Still mine.",
    ],
    draw: [
      "A draw. Curious.",
      "Mirrored. Suspicious of you, mildly.",
      "Same. Again.",
    ],
  },
  Bern: {
    win: [
      "Yours.",
      "Granted.",
      "Logged.",
    ],
    loss: [
      "Mine.",
      "The Ministry's.",
      "I take that.",
    ],
    draw: [
      "Draw.",
      "Mirrored.",
      "Same hand. Again.",
    ],
  },
  Crumb: {
    win: [
      "Wah, you got me lah.",
      "Eh, point to you. Bonus already.",
      "Can lah, you keep this up.",
    ],
    loss: [
      "Aiyoh, this round mine sia.",
      "Cannot lah, you better next time.",
      "Lost lor, never mind.",
    ],
    draw: [
      "Same hand! Steady eh.",
      "Draw lor. Two minds, one gesture.",
      "Wah, like-mind. Suspicious.",
    ],
  },
};

export function rpsRoundReaction(
  character: MuppetCharacter,
  outcome: "win" | "loss" | "draw",
  roundIdx: number,
): OfficerLine {
  const pool = REACTIONS[character][outcome];
  const text = pool[roundIdx % pool.length];
  const expression: MuppetExpression =
    outcome === "win" ? "warm" : outcome === "loss" ? "strict" : "skeptical";
  const gesture: MuppetGesture =
    outcome === "win" ? "nod" : outcome === "loss" ? "stamp" : "lean";
  return { text, expression, gesture };
}

// ── Final verdict on RPS challenge ────────────────────────────────────────────
export function rpsFinalLine(
  character: MuppetCharacter,
  playerWins: number,
  officerWins: number,
): OfficerLine {
  const passed = playerWins >= officerWins;
  if (character === "Crumb") {
    return passed
      ? { text: "Pass lah, your reflex still got. Next challenge.", expression: "delighted", gesture: "wave" }
      : { text: "Aiyoh, lost. Never mind, baby will test you harder.", expression: "warm", gesture: "lean" };
  }
  if (character === "Bern") {
    return passed
      ? { text: "Verification passed. Proceed.", expression: "warm", gesture: "stamp" }
      : { text: "You were bested. Proceeding regardless.", expression: "strict", gesture: "stamp" };
  }
  return passed
    ? { text: "Verification passed. You have reflexes.", expression: "delighted", gesture: "nod" }
    : { text: "Bested. The baby will test you harder than I did.", expression: "skeptical", gesture: "lean" };
}
