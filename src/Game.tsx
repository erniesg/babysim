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
import { AudioDirector } from "./audio/AudioDirector";
import type { MuppetCharacter, MuppetExpression, MuppetGesture, OfficerVoiceProfile } from "./muppet/muppet-engine";
import { llmOfficerLine, isOfficerAgentEnabled } from "./llm/officer-agent";
import { fetchOfficerVoiceUrl, isElevenLabsOfficerVoiceEnabled } from "./llm/officer-voice";
import { callBabyAgent, isBabyAgentEnabled, isGameplayBeat } from "./llm/baby-agent";
import { RealtimePartner } from "./components/RealtimePartner";
import type { PartnerToolCall } from "./realtime/types";

type OfficerBeat = "officer_intro" | "ominous_warning" | "verdict";

const OFFICER_BEATS: ReadonlySet<OfficerBeat> = new Set(["officer_intro", "ominous_warning", "verdict"]);

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
const OFFICER_INTROS: Record<MuppetCharacter, (name: string) => string> = {
  Ernest: (n) =>
    `Welcome to Probation. I am ${n}. Confirm you understand this is a rehearsal for chaos under supervision.`,
  Bern: (n) =>
    `Sit. I am ${n}. We will simulate your unfitness, document your reactions, and rule on your readiness.`,
  Crumb: (n) =>
    `${n}, intake desk. The Ministry has paired you with one tiny citizen and one slightly tired adult. Begin.`,
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
      text: OFFICER_INTROS[profile](officerName),
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

  const onAction = useCallback(
    (action: GameAction) => {
      audioRef.current?.unlock();
      muppetRef.current?.unlockSpeech();
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
            if (tool.name === "play_audio") {
              audioRef.current?.handle({
                type: "play_audio",
                channel: "baby",
                assetId: tool.args.assetId,
                loop: Boolean(tool.args.loop),
              });
            } else if (tool.name === "set_caption") {
              setBabyHint(tool.args.text);
              // Auto-clear after 6s so the next action can replace cleanly.
              setTimeout(() => setBabyHint((cur) => (cur === tool.args.text ? null : cur)), 6000);
            }
          }
        });
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

      // Mode-C path: gpt-5.5 generates the line, ElevenLabs renders the voice, muppet plays it.
      // If either provider fails, fall through (LLM line + browser TTS, or scripted + browser TTS).
      const scripted = officerLineFor(beat as BeatId, state);
      setLiveOfficerText(null);
      const sayPromise = (async () => {
        let line = scripted;
        if (isOfficerAgentEnabled()) {
          const llm = await llmOfficerLine(beat as OfficerBeat, state);
          if (llm) line = llm;
        }
        // Surface the live transcript the moment we know the line, BEFORE audio starts streaming.
        setLiveOfficerText(line.text);
        if (isElevenLabsOfficerVoiceEnabled()) {
          const officerKey = officerProfileFromName(state.officer.name);
          const audioUrl = await fetchOfficerVoiceUrl(line.text, officerKey);
          if (audioUrl) return muppet.say({ ...line, audioUrl });
        }
        return muppet.say(line);
      })();
      sayPromise.then(async () => {
        // Cinematic sequencing for officer_intro: line → pause → snap → pause → music.
        if (beat === "officer_intro") {
          await new Promise((r) => setTimeout(r, 850));   // beat 1: hang on the line
          muppet.playGesture("wave");
          audioRef.current?.playOneShot("sfx.snap", 0.95);
          await new Promise((r) => setTimeout(r, 1200));  // beat 2: snap echoes alone, room held
          audioRef.current?.handle({
            type: "play_audio",
            channel: "ambient",
            assetId: "music.probation_theme",
            loop: true,
          });
          await new Promise((r) => setTimeout(r, 900));   // beat 3: let the music establish
          send({ type: "scene_ack", beatId: beat });
          return;
        }
        if (beat === "ominous_warning" || beat === "verdict") {
          await new Promise((r) => setTimeout(r, 600));
          send({ type: "action", action: "answer_intake" });
        }
      });
    } else {
      // Stop any in-flight officer speech when leaving an officer beat.
      muppetRef.current?.panicStop();
      setLiveOfficerText(null);
    }
  }, [render?.beatId, state, send]);

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
  const showBaby = !isOfficerBeat && !isHome && !isDebrief && !isPhoto && !isCute && !isVerif;

  return (
    <main className="app-shell">
      <header className="app-bar">
        <span className="kicker">Ministry of Family and Human Development</span>
        <h1>BabySim — {render.timeLabel}</h1>
      </header>

      {/* Muppet stays mounted across every beat so its WebGL canvas + ref are warm. Visibility flipped per beat. */}
      <div style={{ display: isOfficerBeat ? "block" : "none" }} aria-hidden={!isOfficerBeat}>
        <MuppetStage ref={muppetRef} />
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

            {render.partner.visible && (
              <PartnerLine
                name={render.partner.name}
                line={render.partner.currentLine}
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

            {isReveal && (
              <NameBabyForm
                value={babyName}
                onChange={setBabyName}
                onSubmit={(name) => {
                  audioRef.current?.unlock();
                  send({ type: "name_baby", name });
                }}
              />
            )}

            {!isReveal && !isPhoto && <ActionBar actions={render.availableActions} onAction={onAction} />}
          </>
        )}
      </section>

      {/* HUD only shows once we're actually playing — hide on cinematic / pre-baby beats. */}
      {!isHome && !isDebrief && !isOfficerBeat && !isPhoto && !isVerif && !isCute && !isReveal && (
        <aside className="hud">
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
