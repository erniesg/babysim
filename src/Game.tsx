import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, RenderState, ServerMessage } from "@contracts/messages";
import type { GameState } from "@contracts/game-state";
import type { GameAction } from "@contracts/actions";
import type { BeatId } from "@contracts/beats";
import { LocalGameTransport } from "@engine/transport";
import { MuppetStage, type MuppetStageHandle } from "./muppet/MuppetStage";
import { BabyVisual } from "./components/BabyVisual";
import { ActionBar } from "./components/ActionBar";
import { NeedsPanel } from "./components/NeedsPanel";
import { LedgerPanel } from "./components/LedgerPanel";
import { PartnerLine } from "./components/PartnerLine";
import { DebriefCard } from "./components/DebriefCard";
import { PhotoIntake } from "./components/PhotoIntake";
import { CutePayoff } from "./components/CutePayoff";
import { SingMicCapture } from "./components/SingMicCapture";
import { VerificationGames } from "./components/VerificationGames";
import { LogoStrip } from "./components/LogoStrip";
import { TimeProgressBar } from "./components/TimeProgressBar";
import { OfficerWarning } from "./components/OfficerWarning";
import { AdoptOrGenerate, type BabyKind } from "./components/AdoptOrGenerate";
import { DebugOverlay } from "./components/DebugOverlay";
import { AudioDirector } from "./audio/AudioDirector";
import type { MuppetCharacter, MuppetExpression, MuppetGesture, OfficerVoiceProfile } from "./muppet/muppet-engine";
import { llmOfficerBeat, isOfficerAgentEnabled, type OfficerToolCall } from "./llm/officer-agent";
import { fetchOfficerVoiceUrl, isElevenLabsOfficerVoiceEnabled } from "./llm/officer-voice";
import { callBabyAgent, isBabyAgentEnabled, isGameplayBeat } from "./llm/baby-agent";
import { callPartnerAgent, isPartnerLiveTextEnabled, isPartnerLiveBeat } from "./llm/partner-agent";
import { RealtimePartner } from "./components/RealtimePartner";
import type { PartnerToolCall } from "./realtime/types";

type OfficerBeat = "officer_intro" | "ominous_warning" | "verdict";

// Beats where the muppet (3D Three.js officer rig) is mounted on stage.
// Officer beats = officer is delivering a line.
// Verification beats = officer is interrogating the player; muppet reacts to challenge results.
const OFFICER_BEATS: ReadonlySet<OfficerBeat> = new Set(["officer_intro", "ominous_warning", "verdict"]);
const MUPPET_STAGE_BEATS: ReadonlySet<string> = new Set([
  "officer_intro",
  "ominous_warning",
  "verdict",
  "verification_games",
  "generation_progress",
]);

type ChallengeOutcome = "waiting" | "pass" | "fail" | "skip";

const CHALLENGE_EXPRESSION: Record<ChallengeOutcome, MuppetExpression> = {
  waiting: "skeptical",
  pass: "delighted",
  fail: "strict",
  skip: "strict",
};

function makeSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function makeSeed() {
  return `seed-${Math.random().toString(36).slice(2, 10)}`;
}

function officerProfileFromName(name: string): MuppetCharacter {
  if (name.includes("Bern")) return "Bern";
  if (name.includes("Crumb")) return "Crumb";
  return "Ernest";
}

// Each officer carries a slightly distinct rhetorical voice; voices differentiated via
// pitch/rate profile in muppet-engine. Swap to Gemini Flash voice (Live API) later.
//
// Intro is split into two beats: a snappy first-person identification, then
// (after the snap + music cue) a longer setup line. Helps the cinematic land:
// short hook → snap → music → longer reveal.
const OFFICER_INTRO_LINE1: Record<MuppetCharacter, (name: string) => string> = {
  Ernest: (n) => `I am ${n}. Ministry of Family and Human Development.`,
  Bern:   (n) => `Sit. I am ${n}. Ministry of Family and Human Development.`,
  Crumb:  (n) => `${n}. Intake desk, Ministry of Family and Human Development.`,
};

const OFFICER_INTRO_LINE2: Record<MuppetCharacter, string> = {
  Ernest: "This is a rehearsal for chaos under supervision. Confirm you understand.",
  Bern:   "We will simulate your unfitness, document your reactions, rule on your readiness.",
  Crumb:  "The Ministry has paired you with one tiny citizen and one slightly tired adult. Begin.",
};

const OFFICER_WARNINGS: Record<MuppetCharacter, string> = {
  Ernest: "Care labor, shirking, and night shifts will be recorded. The Ministry sees what you do at two oh seven in the morning.",
  Bern: "We are not interested in your intentions. Only your distribution of responsibility, measured in minutes.",
  Crumb: "The fairness ledger updates in real time. Be candid; we are already auditing.",
};

function officerLineFor(beatId: BeatId, state: GameState): { text: string; expression: MuppetExpression; gesture: MuppetGesture } {
  const officerName = state.officer.name;
  const profile = officerProfileFromName(officerName);

  if (beatId === "officer_intro") {
    return {
      text: OFFICER_INTRO_LINE1[profile](officerName),
      expression: profile === "Crumb" ? "warm" : "strict",
      gesture: "stamp",
    };
  }
  if (beatId === "ominous_warning") {
    return {
      text: OFFICER_WARNINGS[profile],
      expression: "skeptical",
      gesture: "lean",
    };
  }
  if (beatId === "verdict") {
    const { ledger } = state;
    if (ledger.playerShirks >= 3) {
      return {
        text: profile === "Bern"
          ? "The file shows theatrical breathing. We will reconvene when you are honest."
          : "The file shows theatrical breathing. Your application is held for further review.",
        expression: "skeptical",
        gesture: "stamp",
      };
    }
    if (ledger.playerNightShifts >= 2 && ledger.playerSoothes >= 4) {
      return {
        text: profile === "Crumb"
          ? "Eyes ringed with policy. Quietly impressive. Provisional approval, on the record."
          : "Eyes ringed with policy. The Ministry recognizes service. Provisional approval.",
        expression: "delighted",
        gesture: "stamp",
      };
    }
    return {
      text: profile === "Bern"
        ? "Reviewable. Not yet alarming. Approval with reservations."
        : "Reviewable. Not yet alarming. Provisional approval, with notes.",
      expression: "warm",
      gesture: "nod",
    };
  }
  return { text: "", expression: "strict", gesture: "none" };
}

export function Game() {
  const transportRef = useRef<LocalGameTransport | null>(null);
  const muppetRef = useRef<MuppetStageHandle>(null);
  const audioRef = useRef<AudioDirector | null>(null);
  const lastSpokenBeatRef = useRef<string>("");

  const [render, setRender] = useState<RenderState | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [babyName, setBabyName] = useState("");
  const [singOpen, setSingOpen] = useState(false);
  const [realtimeOpen, setRealtimeOpen] = useState(false);
  // Live transcript of whatever the officer (or any speaker) is saying right now.
  // Replaces the static beat caption during cinematic officer beats.
  const [liveOfficerText, setLiveOfficerText] = useState<string | null>(null);
  // Live caption-hint from the Baby agent (gpt-5.5) — surfaced near the baby visual.
  const [babyHint, setBabyHint] = useState<string | null>(null);
  // Attention signal from the baby agent request_attention tool.
  const [attentionSignal, setAttentionSignal] = useState<{ kind: "cry" | "fuss" | "coo"; intensity: number } | null>(null);
  // Floating feedback badge from acknowledge_action — "+5 matched" / "-2 mismatch".
  const [actionBadge, setActionBadge] = useState<string | null>(null);
  // Officer warning banner — fires on threshold crossings during gameplay.
  const [officerWarning, setOfficerWarning] = useState<string | null>(null);
  const officerWarningFiredRef = useRef<Set<string>>(new Set());
  // Throttle: last beat for which baby agent was called on BEAT_ENTERED (one call per beat).
  const lastAgentBeatRef = useRef<string>("");
  // Live partner line from Gemini text — overrides scripted line when present.
  const [livePartnerLine, setLivePartnerLine] = useState<string | null>(null);
  // Throttle: track last beat where we fired partner line to fire exactly once per beat entry.
  const lastPartnerLineBeatRef = useRef<string>("");
  // Player-input modal requested by the officer via request_player_input tool.
  const [playerInputModal, setPlayerInputModal] = useState<{ kind: "confirm" | "choice" | "text"; prompt: string } | null>(null);
  // Adopt-vs-generate choice — now made IN-STAGE during officer_intro
  // (after line 2, before scene_ack). adopt → use canonical /puppets/baby/
  // rig; generate → kick off /api/baby/portrait. Survives through baby_roll.
  const [babyKind, setBabyKind] = useState<BabyKind | null>(null);
  // Toggle for the in-stage chooser overlay. Set true when officer_intro line 2
  // finishes; cleared the moment the player picks (officer then voices a
  // transition line and we send scene_ack to advance to verification).
  const [intakeChoiceOpen, setIntakeChoiceOpen] = useState(false);
  // Game-clock anchor — captured at start_game so we can enforce a hard
  // 90 s deadline regardless of which beat we're in. At the deadline we
  // skip_to verdict so every play ends with a Ministry ruling.
  const gameStartedAtRef = useRef<number | null>(null);

  // Bootstrap transport + audio.
  useEffect(() => {
    const transport = new LocalGameTransport(makeSessionId(), makeSeed());
    transportRef.current = transport;
    const audio = new AudioDirector();
    audioRef.current = audio;

    const unsubServer = transport.subscribe((msg: ServerMessage) => {
      audio.handle(msg);
      if (msg.type === "state") {
        setRender(msg.render);
        setState(msg.state);
      }
    });

    transport.start();
    setRender(transport.renderState());
    setState(transport.getRuntime().getState());

    return () => {
      unsubServer();
      audio.dispose();
      transportRef.current = null;
      audioRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    transportRef.current?.send(msg);
  }, []);

  // ── Baby agent tool dispatcher ────────────────────────────────────────────
  // Accepts a single BabyToolCall and routes it to the appropriate handler.
  // Called from both the action-triggered path and the BEAT_ENTERED path.
  // Deterministic engine remains authoritative; these are consultative deltas.
  const dispatchBabyTool = useCallback(
    (tool: import("./llm/baby-agent").BabyToolCall) => {
      if (tool.name === "play_audio") {
        audioRef.current?.handle({
          type: "play_audio",
          channel: "baby",
          assetId: tool.args.assetId,
          loop: Boolean((tool.args as { loop?: boolean }).loop),
        });
      } else if (tool.name === "set_caption") {
        const text = (tool.args as { text: string }).text;
        setBabyHint(text);
        setTimeout(() => setBabyHint((cur) => (cur === text ? null : cur)), 6000);
      } else if (tool.name === "set_visual_state") {
        const vs = (tool.args as { state: import("@contracts/game-state").BabyVisualState }).state;
        send({ type: "agent_set_visual_state", state: vs });
      } else if (tool.name === "set_mood_delta") {
        const delta = (tool.args as { delta: number }).delta;
        send({ type: "agent_set_mood_delta", delta });
      } else if (tool.name === "set_need_delta") {
        const { need, delta } = tool.args as { need: "hunger" | "sleepiness" | "discomfort" | "connection" | "health"; delta: number };
        send({ type: "agent_set_need_delta", need, delta });
      } else if (tool.name === "request_attention") {
        const { kind, intensity } = tool.args as { kind: "cry" | "fuss" | "coo"; intensity: number };
        setAttentionSignal({ kind, intensity });
        // Auto-clear after 4s so it doesn't pile up.
        setTimeout(() => setAttentionSignal((cur) => (cur?.kind === kind ? null : cur)), 4000);
      } else if (tool.name === "acknowledge_action") {
        const { action: ackAction, success } = tool.args as { action: string; success: boolean };
        const badge = success ? `+matched: ${ackAction}` : `-mismatch: ${ackAction}`;
        setActionBadge(badge);
        setTimeout(() => setActionBadge((cur) => (cur === badge ? null : cur)), 2500);
      }
      // trigger_fallback: no-op in the UI — deterministic engine continues unchanged.
    },
    [send],
  );

  const onAction = useCallback(
    (action: GameAction) => {
      audioRef.current?.unlock();
      muppetRef.current?.unlockSpeech();

      // The moment the player commits to a new game, kick off the Lyria music
      // generation in the background. Lyria takes 20-60 s — by the time the
      // snap fires (~3 s after splash) the cached blob is partway baked. Falls
      // back silently to /audio/music/probation-theme.mp3 if the call fails.
      // Also anchor the 90 s game deadline timer.
      if (action === "start_game") {
        void audioRef.current?.prefetch("music.probation_theme");
        gameStartedAtRef.current = performance.now();
      }

      if (action === "sing") {
        setSingOpen(true);
        return;
      }
      send({ type: "action", action });

      // Fire the Baby agent in parallel during gameplay beats — gpt-5.5 reads
      // the player action vs the hidden traits and emits play_audio / set_caption tool calls.
      // The deterministic engine has already dispatched its own state delta.
      const liveState = transportRef.current?.getRuntime().getState();
      if (
        isBabyAgentEnabled() &&
        liveState &&
        isGameplayBeat(liveState.beatId) &&
        ["feed", "rock", "shush", "hold", "check_diaper", "adjust_temperature", "reposition", "wait"].includes(action)
      ) {
        callBabyAgent(liveState.baby, liveState.beatId, liveState.eventLog, action).then((resp) => {
          if (!resp || !resp.tools?.length) return;
          for (const tool of resp.tools) {
            dispatchBabyTool(tool);
          }
        });
      }
    },
    [send, dispatchBabyTool],
  );

  // ── Officer tool dispatcher ────────────────────────────────────────────────────
  // Executes a single OfficerToolCall returned by the LLM. Called in sequence
  // for each tool in the response array. The `say` tool is awaited (blocks until
  // audio/speech finishes); all others are fire-and-forget within the sequence.
  const executeOfficerTool = useCallback(
    async (tool: OfficerToolCall, muppet: MuppetStageHandle, beatId: string, liveState: GameState): Promise<void> => {
      switch (tool.name) {
        case "say": {
          const { text, expression, gesture } = tool.args;
          if (!text) return;
          setLiveOfficerText(text);
          const line = { text, expression, gesture: gesture as MuppetGesture };
          if (isElevenLabsOfficerVoiceEnabled()) {
            const officerKey = officerProfileFromName(liveState.officer.name);
            const audioUrl = await fetchOfficerVoiceUrl(text, officerKey);
            if (audioUrl) {
              await muppet.say({ ...line, audioUrl });
              return;
            }
          }
          await muppet.say(line);
          return;
        }
        case "set_expression": {
          muppet.setExpression(tool.args.expression);
          return;
        }
        case "play_gesture": {
          muppet.playGesture(tool.args.gesture as MuppetGesture);
          return;
        }
        case "warn_player": {
          const { text } = tool.args;
          setOfficerWarning(text);
          // Voice the warning through the muppet (audio still plays off-camera during gameplay).
          void (async () => {
            const profile = officerProfileFromName(liveState.officer.name);
            muppet.setVoiceProfile(profile);
            if (isElevenLabsOfficerVoiceEnabled()) {
              const audioUrl = await fetchOfficerVoiceUrl(text, profile);
              if (audioUrl) {
                await muppet.say({ text, expression: "skeptical", gesture: "lean", audioUrl });
                return;
              }
            }
            await muppet.say({ text, expression: "skeptical", gesture: "lean" });
          })();
          // Auto-clear banner after a hold.
          setTimeout(() => setOfficerWarning((cur) => (cur === text ? null : cur)), 5500);
          return;
        }
        case "start_challenge": {
          // The challenge beat is driven by VerificationGames; send the engine
          // into verification_games if we are not already there.
          if (beatId !== "verification_games") {
            send({ type: "skip_to", beatId: "verification_games" });
          }
          return;
        }
        case "advance_phase": {
          const { to } = tool.args;
          // Engine-level validation: only allow beats listed in possibleNextBeats
          // for the current beat. Silently reject illegal transitions.
          const { BEAT_GRAPH } = await import("@contracts/beats");
          const currentSpec = BEAT_GRAPH[beatId as keyof typeof BEAT_GRAPH];
          if (!currentSpec) return;
          const allowed = currentSpec.possibleNextBeats as string[];
          if (!allowed.includes(to)) {
            console.warn(`[officer] advance_phase rejected: "${to}" not in possibleNextBeats for "${beatId}"`);
            return;
          }
          send({ type: "skip_to", beatId: to });
          return;
        }
        case "request_player_input": {
          setPlayerInputModal({ kind: tool.args.kind, prompt: tool.args.prompt });
          return;
        }
        default:
          return;
      }
    },
    [send],
  );

  // Officer-beat dialog: speak the line via muppet, then auto-advance via scene_ack.
  useEffect(() => {
    if (!render || !state) return;
    const beat = render.beatId;
    if (lastSpokenBeatRef.current === beat) return;
    lastSpokenBeatRef.current = beat;

    if (OFFICER_BEATS.has(beat as OfficerBeat)) {
      const muppet = muppetRef.current;
      if (!muppet) return;
      muppet.setVoiceProfile(officerProfileFromName(state.officer.name));
      muppet.unlockSpeech();
      audioRef.current?.unlock();

      // Kick off Lyria music gen in the background the moment officer_intro
      // begins, so by the time the snap fires (~1.4 s later) the cached blob
      // is hot. AudioDirector falls back to pre-baked MP3 if the live path is
      // disabled or the call fails — never blocks the cinematic.
      if (beat === "officer_intro") {
        void audioRef.current?.prefetch("music.probation_theme");
      }

      // Snapshot state at effect time to avoid stale closure inside the async chain.
      const snapState = state;

      setLiveOfficerText(null);

      // Mode-C path: gpt-5.5 returns `tools[]`; we execute each in sequence.
      // Fallback: scripted line + browser TTS if LLM unavailable.
      const scripted = officerLineFor(beat as BeatId, state);

      const sayPromise = (async () => {
        let usedLlm = false;

        if (isOfficerAgentEnabled()) {
          const tools = await llmOfficerBeat(beat as OfficerBeat, snapState);
          if (tools && tools.length > 0) {
            usedLlm = true;
            for (const tool of tools) {
              await executeOfficerTool(tool, muppet, beat, snapState);
            }
          }
        }

        if (!usedLlm) {
          // Scripted fallback: surface text + speak via muppet.
          setLiveOfficerText(scripted.text);
          if (isElevenLabsOfficerVoiceEnabled()) {
            const officerKey = officerProfileFromName(snapState.officer.name);
            const audioUrl = await fetchOfficerVoiceUrl(scripted.text, officerKey);
            if (audioUrl) {
              await muppet.say({ ...scripted, audioUrl });
              return;
            }
          }
          await muppet.say(scripted);
        }
      })();

      sayPromise.then(async () => {
        // Cinematic sequencing for officer_intro:
        //   line 1 (short identification) → pause → snap → music cue → line 2 (longer setup) → scene_ack.
        if (beat === "officer_intro") {
          const profile = officerProfileFromName(snapState.officer.name);

          await new Promise((r) => setTimeout(r, 250));        // hold on line 1
          muppet.playGesture("wave");
          audioRef.current?.playOneShot("sfx.snap", 0.95);
          await new Promise((r) => setTimeout(r, 650));        // snap echoes
          audioRef.current?.handle({
            type: "play_audio",
            channel: "ambient",
            assetId: "music.probation_theme",
            loop: true,
          });
          await new Promise((r) => setTimeout(r, 450));        // music establishes

          // Line 2 — longer simulation-setup line. Voice via ElevenLabs if enabled.
          const line2: { text: string; expression: MuppetExpression; gesture: MuppetGesture } = {
            text: OFFICER_INTRO_LINE2[profile],
            expression: "skeptical",
            gesture: "lean",
          };
          setLiveOfficerText(line2.text);
          if (isElevenLabsOfficerVoiceEnabled()) {
            const audioUrl = await fetchOfficerVoiceUrl(line2.text, profile);
            if (audioUrl) {
              await muppet.say({ ...line2, audioUrl });
            } else {
              await muppet.say(line2);
            }
          } else {
            await muppet.say(line2);
          }

          await new Promise((r) => setTimeout(r, 350));        // hold on line 2
          // Pop the in-stage Adopt/Generate chooser INSIDE the muppet stage.
          // We do NOT send scene_ack yet — gating the intro completion on the
          // player's choice. Once they pick, onChooseIntake() voices a
          // transition line and sends the ack so the engine advances into
          // verification (officer_intro → verification_games per transport.ts).
          if (babyKind === null) {
            setIntakeChoiceOpen(true);
          } else {
            send({ type: "scene_ack", beatId: beat });
          }
          return;
        }
        if (beat === "ominous_warning" || beat === "verdict") {
          await new Promise((r) => setTimeout(r, 600));
          send({ type: "action", action: "answer_intake" });
        }
      });
    } else if (beat === "verification_games" || beat === "generation_progress") {
      // Officer is interrogating during verification — muppet stays on stage,
      // expression flips to skeptical (waiting), warm (between checks).
      const muppet = muppetRef.current;
      if (!muppet) return;
      muppet.setCharacter(officerProfileFromName(state.officer.name));
      muppet.setExpression(beat === "generation_progress" ? "warm" : "skeptical");
      setLiveOfficerText(null);
    } else {
      // Stop any in-flight officer speech when leaving an officer beat.
      muppetRef.current?.panicStop();
      setLiveOfficerText(null);
    }
  }, [render?.beatId, state, send, executeOfficerTool]);

  // ── 90 s game deadline ─────────────────────────────────────────────────────
  // Once the player has started a game, force a verdict at the 90 s mark
  // regardless of beat. The hard deadline keeps every demo playthrough
  // bounded and guarantees a Ministry ruling on the file. Idempotent —
  // skipping to a beat we're already in is a no-op via runtime.skipTo.
  useEffect(() => {
    if (!render || !state) return;
    if (gameStartedAtRef.current === null) return;
    // Already past gameplay — don't preempt the verdict / debrief screens.
    if (
      render.beatId === "verdict" ||
      render.beatId === "debrief_card" ||
      render.beatId === "home"
    ) return;

    const elapsed = performance.now() - gameStartedAtRef.current;
    const deadlineMs = 90_000;
    const remainingMs = deadlineMs - elapsed;
    if (remainingMs <= 0) {
      // Already past — skip immediately.
      send({ type: "skip_to", beatId: "verdict" });
      return;
    }
    const t = setTimeout(() => {
      send({ type: "skip_to", beatId: "verdict" });
    }, remainingMs);
    return () => clearTimeout(t);
  }, [render?.beatId, state, send]);

  // ── Officer warnings during gameplay ───────────────────────────────────────
  // Watches ledger + baby health for threshold crossings and pops a banner +
  // muppet voice line. Each warning key fires at most once per session so the
  // player isn't badgered. Visually surfaces via <OfficerWarning>.
  useEffect(() => {
    if (!state || !render) return;
    const beat = render.beatId;
    const inGameplay = ["first_calm", "first_cry", "discovery_soothing", "night_cry", "shirk_or_wake", "night_soothe"].includes(beat);
    if (!inGameplay) return;

    const fired = officerWarningFiredRef.current;
    const warnings: Array<{ key: string; trigger: boolean; line: string }> = [
      {
        key: "shirks_2",
        trigger: state.ledger.playerShirks >= 2,
        line: "The Ministry sees this. Shirks logged. Adjust accordingly.",
      },
      {
        key: "health_low",
        trigger: state.baby.needs.health < 55,
        line: "The child's vitals are degrading. Intervention is required.",
      },
      {
        key: "discomfort_sustained",
        trigger: state.baby.needs.discomfort > 80,
        line: "Persistent distress noted. The Ministry is watching how you respond.",
      },
      {
        key: "connection_low",
        trigger: state.baby.needs.connection < 30,
        line: "Connection is collapsing. The bond is part of the file.",
      },
    ];

    for (const w of warnings) {
      if (!w.trigger || fired.has(w.key)) continue;
      fired.add(w.key);
      setOfficerWarning(w.line);

      // Voice the warning via the muppet (canvas hidden during gameplay; audio still plays).
      void (async () => {
        const muppet = muppetRef.current;
        if (!muppet) return;
        const profile = officerProfileFromName(state.officer.name);
        muppet.setVoiceProfile(profile);
        muppet.unlockSpeech();
        if (isElevenLabsOfficerVoiceEnabled()) {
          const audioUrl = await fetchOfficerVoiceUrl(w.line, profile);
          if (audioUrl) {
            await muppet.say({ text: w.line, expression: "skeptical", gesture: "lean", audioUrl });
            return;
          }
        }
        await muppet.say({ text: w.line, expression: "skeptical", gesture: "lean" });
      })();

      // Auto-clear the banner after a hold so it doesn't pile up.
      setTimeout(() => setOfficerWarning((cur) => (cur === w.line ? null : cur)), 5500);
      break; // Only fire one per render cycle.
    }
  }, [state, render]);

  // ── Live partner line (Gemini text) ──────────────────────────────────────
  // Fires once per beat entry when the partner is visible and NOT on an argument beat
  // (those use RealtimePartner mic instead). The live line overrides the scripted
  // currentLine from the engine; scripted remains the fallback when this is null or
  // the flag is off.
  // Throttle: lastPartnerLineBeatRef ensures we fire at most once per beat entry even
  // if render re-renders for other reasons mid-beat.
  useEffect(() => {
    if (!render || !state) return;
    if (!isPartnerLiveTextEnabled()) return;
    if (!render.partner.visible) return;

    const beat = render.beatId;
    // Skip argument beats — those use the Realtime mic path.
    if (!isPartnerLiveBeat(beat)) return;
    // Throttle: only fire once per beat entry.
    if (lastPartnerLineBeatRef.current === beat) return;
    lastPartnerLineBeatRef.current = beat;
    // Reset previous live line so the scripted fallback shows immediately while we wait.
    setLivePartnerLine(null);

    const snapState = state;
    callPartnerAgent(beat, snapState, snapState.eventLog).then((resp) => {
      if (!resp?.tools?.length) return;
      for (const tool of resp.tools) {
        if (tool.name === "say_line" && tool.args.text) {
          setLivePartnerLine(tool.args.text);
        }
      }
    });
  }, [render?.beatId, render?.partner.visible, state]);


  // ── Baby agent BEAT_ENTERED trigger ───────────────────────────────────────
  // Calls the baby agent once whenever the game enters a gameplay beat.
  // Throttled to one call per beat (lastAgentBeatRef) to prevent LLM spam.
  // This fires without a playerLastAction so the agent uses request_attention
  // to announce the baby's current state and set an initial visual.
  useEffect(() => {
    if (!state || !render) return;
    const beat = render.beatId;
    if (!isGameplayBeat(beat)) return;
    if (!isBabyAgentEnabled()) return;
    // Throttle: skip if we already called the agent for this beat entry.
    if (lastAgentBeatRef.current === beat) return;
    lastAgentBeatRef.current = beat;

    const liveState = transportRef.current?.getRuntime().getState();
    if (!liveState) return;

    callBabyAgent(liveState.baby, beat, liveState.eventLog).then((resp) => {
      if (!resp || !resp.tools?.length) return;
      for (const tool of resp.tools) {
        dispatchBabyTool(tool);
      }
    });
  // Depend on beatId only — we want exactly one call per beat, not on every state tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render?.beatId]);

  // ── Intake-choice handler ───────────────────────────────────────────────────
  // Fires when the player picks adopt/generate from the in-stage chooser.
  // Voices a transition line in the officer's character, kicks off the live
  // portrait fetch if generate, then sends scene_ack to advance to verification.
  const onChooseIntake = useCallback(
    async (kind: BabyKind) => {
      audioRef.current?.unlock();
      setBabyKind(kind);
      setIntakeChoiceOpen(false);
      if (!state) return;

      // Generate path: kick off /api/baby/portrait in the background.
      // Adopt path: nothing to fetch — the canonical rig is already cached.
      if (kind === "generate") {
        void fetch("/api/baby/portrait", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gender: state.baby.gender,
            traits: state.baby.traits,
            state: "settled",
          }),
        }).catch(() => { /* fallback to canonical rig */ });
      }

      // Officer voices the transition into verification. In-character per profile.
      const muppet = muppetRef.current;
      if (muppet) {
        const profile = officerProfileFromName(state.officer.name);
        const partnerName = state.partner.name;
        const transitionLines: Record<MuppetCharacter, string> = {
          Ernest: kind === "adopt"
            ? `Right. ${partnerName} is in the file as your co-parent. Now your reflexes — show me.`
            : `Generating. ${partnerName} stays as your co-parent. While that renders — your reflexes.`,
          Bern: kind === "adopt"
            ? `Adopted. ${partnerName} on the record. Reflex assessment. Now.`
            : `Generating. ${partnerName} stays. Reflex assessment in the meantime.`,
          Crumb: kind === "adopt"
            ? `Can lah, adopt. ${partnerName} on the file already. Eh, show your hand to camera.`
            : `Generating ah, takes a while. ${partnerName} still your partner. Meanwhile, show your hand to camera.`,
        };
        const line = {
          text: transitionLines[profile],
          expression: "skeptical" as MuppetExpression,
          gesture: "lean" as MuppetGesture,
        };
        muppet.unlockSpeech();
        if (isElevenLabsOfficerVoiceEnabled()) {
          const audioUrl = await fetchOfficerVoiceUrl(line.text, profile);
          if (audioUrl) {
            await muppet.say({ ...line, audioUrl });
          } else {
            await muppet.say(line);
          }
        } else {
          await muppet.say(line);
        }
      }

      send({ type: "scene_ack", beatId: "officer_intro" });
    },
    [state, send],
  );

  // Officer voices RPS orchestration — lead-in, countdown ticks, per-round
  // reactions, final verdict. Lines come from `officer-rps-lines.ts` (scripted
  // because countdown ticks fire on 700 ms boundaries, too fast for an LLM
  // round-trip). Voice via ElevenLabs if enabled, else browser TTS fallback.
  const onOfficerSayRps = useCallback(
    async (line: { text: string; expression: import("./muppet/muppet-engine").MuppetExpression; gesture: import("./muppet/muppet-engine").MuppetGesture }) => {
      const muppet = muppetRef.current;
      if (!muppet || !state) return;
      muppet.unlockSpeech();
      const profile = officerProfileFromName(state.officer.name);
      if (isElevenLabsOfficerVoiceEnabled()) {
        const audioUrl = await fetchOfficerVoiceUrl(line.text, profile);
        if (audioUrl) {
          await muppet.say({ ...line, audioUrl });
          return;
        }
      }
      await muppet.say(line);
    },
    [state],
  );

  // Push challenge outcomes into muppet expression: pass → delighted, fail/skip → strict.
  // Reverts to skeptical for the next challenge so each round feels reactive.
  const onChallengeOutcome = useCallback(
    (outcome: ChallengeOutcome) => {
      const muppet = muppetRef.current;
      if (!muppet) return;
      muppet.setExpression(CHALLENGE_EXPRESSION[outcome]);
      if (outcome !== "waiting") {
        // Hold the result expression briefly, then snap back to skeptical for the next round.
        setTimeout(() => muppetRef.current?.setExpression("skeptical"), 1200);
      }
    },
    [],
  );

  // Auto-advance scene_ack beats that aren't gated by user click (the simplest no-AI path).
  // verification_games and generation_progress are driven by VerificationGames' onComplete.
  // cute_payoff lingers ~3.4s so the CSS animation can land.
  useEffect(() => {
    if (!render) return;
    const autoAckTiming: Partial<Record<BeatId, number>> = {
      probation_splash: 1200,
      time_jump_evening: 1500,
      cute_payoff: 3400,
    };
    const ms = autoAckTiming[render.beatId as BeatId];
    if (ms != null) {
      const t = setTimeout(() => send({ type: "scene_ack", beatId: render.beatId }), ms);
      return () => clearTimeout(t);
    }
  }, [render?.beatId, send]);

  if (!render || !state) {
    return (
      <main className="app-shell">
        <p className="caption dim">Booting probation intake…</p>
      </main>
    );
  }

  const isOfficerBeat = OFFICER_BEATS.has(render.beatId as OfficerBeat);
  const isHome = render.beatId === "home";
  const isDebrief = render.beatId === "debrief_card";
  const isReveal = render.beatId === "baby_roll";
  const isPhoto = render.beatId === "photo_intake";
  const isVerif = render.beatId === "verification_games" || render.beatId === "generation_progress";
  const isCute = render.beatId === "cute_payoff";
  // Baby visibility — whitelist instead of blacklist so we never accidentally
  // flash the baby during pre-baby beats (probation_splash / officer_intro
  // / photo_intake / verifications / ominous_warning / baby_roll).
  const BABY_BEATS = new Set<string>([
    "baby_arrival",
    "first_calm",
    "first_cry",
    "discovery_soothing",
    "time_jump_evening",
    "night_cry",
    "shirk_or_wake",
    "argument_start",
    "argument_resolution",
    "night_soothe",
    "cute_payoff",
  ]);
  const showBaby = BABY_BEATS.has(render.beatId);

  // Partner visibility follows the "matched-then-action" rule:
  //   1. Before photo_intake completes there is NO partner (player hasn't been
  //      matched yet — home / probation_splash / officer_intro / photo_intake).
  //   2. After matching (verification_games → baby_roll) the partner can
  //      comment but the engine doesn't take partner-driven actions.
  //   3. After baby_arrival the partner is fully reactive — comments + tool
  //      calls (take_night_shift / concede_argument / etc. via realtime mic).
  const PARTNER_VISIBLE_BEATS = new Set<string>([
    "verification_games", "generation_progress", "ominous_warning", "baby_roll",
    "baby_arrival", "first_calm", "first_cry", "discovery_soothing",
    "time_jump_evening", "night_cry", "shirk_or_wake",
    "argument_start", "argument_resolution", "night_soothe", "cute_payoff", "verdict",
  ]);
  const showPartner = PARTNER_VISIBLE_BEATS.has(render.beatId) && render.partner.visible;
  // Action-capable beats — only after the baby is on stage do we let the
  // partner's tool calls land in the engine ledger.
  const PARTNER_ACTION_BEATS = new Set<string>([
    "baby_arrival", "first_calm", "first_cry", "discovery_soothing",
    "time_jump_evening", "night_cry", "shirk_or_wake",
    "argument_start", "argument_resolution", "night_soothe", "cute_payoff",
  ]);
  const partnerCanAct = PARTNER_ACTION_BEATS.has(render.beatId);

  return (
    <main className="app-shell">
      <header className="app-bar">
        <span className="kicker">Ministry of Family and Human Development</span>
        {/* Logos now cycle on the muppet's chest badge (see muppet-engine.ts).
            Header marquee removed per redesign. */}
        <h1>BabySim — {render.timeLabel}</h1>
      </header>

      {/* Muppet stays mounted across every beat so its WebGL canvas + ref are warm. Visible during officer beats AND verification (issue #7). */}
      <div
        className="muppet-stage-wrap"
        style={{ display: MUPPET_STAGE_BEATS.has(render.beatId) ? "block" : "none", position: "relative" }}
        aria-hidden={!MUPPET_STAGE_BEATS.has(render.beatId)}
      >
        <MuppetStage ref={muppetRef} className={isVerif ? "compact" : undefined} />
        {/* In-stage Adopt/Generate chooser — pops over the muppet at the end of officer_intro. */}
        {intakeChoiceOpen && (
          <div className="intake-choice-overlay">
            <AdoptOrGenerate
              officerName={state.officer.name}
              partnerName={state.partner.name}
              onChoose={(kind) => { void onChooseIntake(kind); }}
            />
          </div>
        )}
      </div>

      <section className="stage">
        {isHome && <HomePanel onStart={() => onAction("start_game")} />}

        {isDebrief && (
          <DebriefCard
            state={state}
            onReplay={() => {
              // Restart with a fresh seed.
              lastSpokenBeatRef.current = "";
              transportRef.current = new LocalGameTransport(makeSessionId(), makeSeed());
              const t = transportRef.current;
              t.subscribe((m) => {
                audioRef.current?.handle(m);
                if (m.type === "state") {
                  setRender(m.render);
                  setState(m.state);
                }
              });
              t.start();
              setRender(t.renderState());
              setState(t.getRuntime().getState());
              setBabyName("");
              setBabyKind(null);
              setIntakeChoiceOpen(false);
              gameStartedAtRef.current = null;
              setOfficerWarning(null);
              officerWarningFiredRef.current = new Set();
              setLivePartnerLine(null);
              lastPartnerLineBeatRef.current = "";
            }}
          />
        )}

        {!isHome && !isDebrief && (
          <>
            {isCute && <CutePayoff babyName={render.baby.name} />}

            {isVerif && (
              <VerificationGames
                officerName={state.officer.name}
                durationMs={11000}
                onComplete={() => send({ type: "scene_ack", beatId: render.beatId })}
                onChallengeOutcome={onChallengeOutcome}
                onOfficerSay={onOfficerSayRps}
              />
            )}

            {showBaby && (
              <>
                <BabyVisual
                  visualState={render.baby.visualState}
                  name={render.baby.name}
                  mood={render.baby.mood}
                />
                {babyHint && (
                  <p className="baby-hint" aria-live="polite">{babyHint}</p>
                )}
                {attentionSignal && (
                  <p
                    className="baby-attention"
                    aria-live="assertive"
                    style={{ opacity: attentionSignal.intensity / 10 }}
                  >
                    {attentionSignal.kind === "cry" ? "⚠" : attentionSignal.kind === "fuss" ? "!" : "♪"}
                    {" "}{attentionSignal.kind}
                  </p>
                )}
                {actionBadge && (
                  <p className="baby-action-badge" aria-live="polite">{actionBadge}</p>
                )}
              </>
            )}

            {/* Live officer transcript replaces the static beat caption during officer beats. */}
            {isOfficerBeat ? (
              liveOfficerText && (
                <div className="officer-subtitle" aria-live="polite">
                  <span className="officer-subtitle-tag">{state.officer.name} · live</span>
                  <p>"{liveOfficerText}"</p>
                </div>
              )
            ) : (
              render.caption && <p className="caption">{render.caption}</p>
            )}

            {showPartner && (
              <PartnerLine
                name={render.partner.name}
                line={livePartnerLine ?? render.partner.currentLine}
                fatigue={render.partner.fatigue}
                resentment={render.partner.resentment}
                isAsleep={render.partner.isAsleep}
                archetype={state.partner.traits.archetype}
                enlarged={render.beatId === "argument_start" || render.beatId === "argument_resolution"}
              />
            )}

            {(render.beatId === "argument_start" || render.beatId === "argument_resolution") && !realtimeOpen && (
              <button
                className="primary"
                onClick={() => setRealtimeOpen(true)}
                style={{ alignSelf: "flex-start" }}
              >
                Talk to {state.partner.name} live (mic)
              </button>
            )}

            {realtimeOpen && (render.beatId === "argument_start" || render.beatId === "argument_resolution") && (
              <RealtimePartner
                state={state}
                beatId={render.beatId}
                onClose={() => setRealtimeOpen(false)}
                onToolCall={(call: PartnerToolCall) => {
                  // Map partner tool calls back into game actions.
                  if (call.name === "concede_argument" || call.name === "take_night_shift") {
                    setRealtimeOpen(false);
                    send({ type: "action", action: "comfort_partner" });
                  } else if (call.name === "refuse_night_shift") {
                    // Player still has to get up.
                    setRealtimeOpen(false);
                    send({ type: "action", action: "get_up" });
                  }
                }}
              />
            )}

            {isPhoto && (
              <PhotoIntake
                onSubmitted={(kind) => {
                  audioRef.current?.unlock();
                  send({ type: "photo_event", kind });
                }}
              />
            )}

            {/* Adopt/Generate is now chosen IN-STAGE during officer_intro completion.
                If for some reason the player reaches baby_roll without a choice
                (e.g., session restored from scratch), the chooser pops here as a
                fallback so the game never stalls. */}
            {isReveal && babyKind === null && (
              <AdoptOrGenerate
                officerName={state.officer.name}
                partnerName={state.partner.name}
                onChoose={(kind) => { void onChooseIntake(kind); }}
              />
            )}

            {isReveal && babyKind !== null && (
              <NameBabyForm
                value={babyName}
                onChange={setBabyName}
                onSubmit={(name) => {
                  audioRef.current?.unlock();
                  send({ type: "name_baby", name });
                }}
              />
            )}

            {!isReveal && !isPhoto && (
              <ActionBar
                actions={render.availableActions}
                onAction={onAction}
                actionPoints={
                  render.beatId === "shirk_or_wake" ||
                  render.beatId === "argument_start" ||
                  render.beatId === "argument_resolution"
                    ? 3
                    : undefined
                }
              />
            )}
          </>
        )}
      </section>

      {/* HUD only shows once we're actually playing — hide on cinematic / pre-baby beats. */}
      {!isHome && !isDebrief && !isOfficerBeat && !isPhoto && !isVerif && !isCute && !isReveal && (
        <aside className="hud">
          <TimeProgressBar
            currentHour={render.currentHour}
            timeLabel={render.timeLabel}
          />
          <NeedsPanel baby={render.baby} />
          <LedgerPanel ledger={render.ledger} partnerName={render.partner.name} />
        </aside>
      )}

      {!isHome && !isDebrief && (
        <footer className="footer">
          <button onClick={() => send({ type: "panic" })}>Panic</button>
          {new URLSearchParams(window.location.search).get("debug") === "1" && (
            <span className="dim">Beat: {render.beatId} · Phase: {render.phase}</span>
          )}
        </footer>
      )}

      <OfficerWarning text={officerWarning} officerName={state.officer.name} />

      <DebugOverlay beatId={render.beatId} phase={render.phase} />

      {playerInputModal && (
        <PlayerInputModal
          kind={playerInputModal.kind}
          prompt={playerInputModal.prompt}
          officerName={state.officer.name}
          onDismiss={() => setPlayerInputModal(null)}
        />
      )}

      {singOpen && (
        <SingMicCapture
          onCancel={() => setSingOpen(false)}
          onComplete={(features) => {
            setSingOpen(false);
            send({ type: "voice_input", ...features });
            send({ type: "action", action: "sing" });
          }}
        />
      )}
    </main>
  );
}

function HomePanel({ onStart }: { onStart: () => void }) {
  return (
    <div className="home-panel">
      <img
        src="/img/officer-ernest-strict.png"
        alt="Officer Ernest portrait"
        className="officer-portrait"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="home-copy">
        <span className="kicker">Co-parenting rehearsal · Generative AI baby · Fairness ledger · Multi-agent improv</span>
        <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>
          File a new probation case.
        </h2>
        <p className="dim" style={{ margin: 0, maxWidth: 540, fontStyle: "italic" }}>
          Most generative AI tries to please you. This one cries until you guess what it wants.
        </p>
        <p className="dim" style={{ margin: 0, maxWidth: 540 }}>
          A cast of LLM agents — officer, partner, baby, GM — calls tools in real time across 120 seconds of newborn care. Hidden traits. A tired AI partner. A fairness ledger between parents. A verdict that quotes you back.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="primary" onClick={onStart}>
            Start new game
          </button>
          <button
            onClick={() => alert("Join Room: multiplayer (Cloudflare Durable Object) lands post-deploy. The single-player loop is ready now.")}
            title="Multiplayer co-parenting via Durable Object"
          >
            Join a room
          </button>
        </div>
      </div>
    </div>
  );
}

function NameBabyForm({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (name: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
      }}
      style={{ display: "flex", gap: 10, alignItems: "center" }}
    >
      <input
        autoFocus
        type="text"
        placeholder="Name your baby"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid #3a2722",
          background: "#1a0e0c",
          color: "#f6efe2",
          fontSize: 14,
        }}
      />
      <button className="primary" type="submit" disabled={!value.trim()}>
        Confirm name
      </button>
    </form>
  );
}

// ── PlayerInputModal ───────────────────────────────────────────────────────────
// Renders a simple overlay modal when the officer agent calls request_player_input().
// The player dismisses it with "Acknowledged" (confirm/text) or any button (choice).
// Intentionally minimal — the officer controls framing via the prompt text.

function PlayerInputModal({
  kind,
  prompt,
  officerName,
  onDismiss,
}: {
  kind: "confirm" | "choice" | "text";
  prompt: string;
  officerName: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 4, 2, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
    >
      <div
        style={{
          background: "#1a0e0c",
          border: "1px solid #3a2722",
          borderRadius: 8,
          padding: "24px 28px",
          maxWidth: 440,
          width: "90%",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <span className="kicker">{officerName} · inquiry</span>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#f6efe2" }}>{prompt}</p>
        {kind === "confirm" || kind === "text" ? (
          <button className="primary" onClick={onDismiss}>
            Acknowledged
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="primary" onClick={onDismiss}>
              Yes
            </button>
            <button onClick={onDismiss}>No</button>
          </div>
        )}
      </div>
    </div>
  );
}
