import { useCallback, useEffect, useRef, useState } from "react";
import { emitRpsTrace } from "../DebugOverlay";
import { rpsLeadIn, rpsCountdown, rpsRoundReaction, rpsFinalLine, type OfficerLine } from "./officer-rps-lines";
import type { MuppetCharacter } from "../../muppet/muppet-engine";
import "./RockPaperScissors.css";

type Gesture = "rock" | "paper" | "scissors";
type RoundOutcome = "win" | "loss" | "draw";

interface ChallengeProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
  /** Optional — Game.tsx wires this to muppet.say() so the officer voices the
   *  lead-in / countdown / per-round reaction in character. No-op if absent. */
  onOfficerSay?: (line: OfficerLine) => void;
}

function characterFromName(name: string): MuppetCharacter {
  if (name.includes("Bern")) return "Bern";
  if (name.includes("Crumb")) return "Crumb";
  return "Ernest";
}

const GESTURE_EMOJI: Record<Gesture, string> = {
  rock: "✊",
  paper: "✋",
  scissors: "✌️",
};

const GESTURES: Gesture[] = ["rock", "paper", "scissors"];

function randomGesture(): Gesture {
  return GESTURES[Math.floor(Math.random() * 3)];
}

function evaluateRound(player: Gesture, officer: Gesture): RoundOutcome {
  if (player === officer) return "draw";
  if (
    (player === "rock" && officer === "scissors") ||
    (player === "scissors" && officer === "paper") ||
    (player === "paper" && officer === "rock")
  )
    return "win";
  return "loss";
}

type Landmark = { x: number; y: number; z: number };

/** Finger-extension classifier from 21 MediaPipe hand landmarks.
 *  Returns the gesture or null if ambiguous.
 *
 *  Image coordinates: x and y are normalized [0..1]; y increases downward.
 *  We measure each finger's tip-to-MCP vector against the palm-up axis to
 *  decide "extended" — robust to rotated hands. */
function classifyGesture(lm: Landmark[]): Gesture | null {
  if (!lm || lm.length < 21) return null;

  // Palm-up axis: from wrist (0) toward mid of MCP joints (5,9,13,17).
  const wrist = lm[0];
  const palmCenter = {
    x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4,
    y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4,
  };
  const palmDx = palmCenter.x - wrist.x;
  const palmDy = palmCenter.y - wrist.y;
  const palmLen = Math.hypot(palmDx, palmDy) || 1;

  // For each non-thumb finger, check whether tip is farther from palm than PIP joint
  // along the palm-up axis. This works for hands held vertically OR sideways.
  const fingers: Array<[number, number]> = [
    [8, 6],   // index: tip 8, pip 6
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ];
  const extended = fingers.map(([tip, pip]) => {
    const dxTip = (lm[tip].x - wrist.x) * palmDx + (lm[tip].y - wrist.y) * palmDy;
    const dxPip = (lm[pip].x - wrist.x) * palmDx + (lm[pip].y - wrist.y) * palmDy;
    return dxTip > dxPip + palmLen * 0.05;
  });
  const extCount = extended.filter(Boolean).length;

  // Thumb extended: distance from thumb tip (4) to index MCP (5) larger than
  // the palm half-length (i.e., thumb sticks out from the side).
  const thumbDist = Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y);
  const thumbExtended = thumbDist > palmLen * 0.55;

  // Rock: closed fist — no fingers extended (thumb may or may not be tucked).
  if (extCount === 0) return "rock";

  // Paper: 4 fingers extended (thumb optional).
  if (extCount === 4) return "paper";

  // Scissors: only index + middle extended.
  if (extended[0] && extended[1] && !extended[2] && !extended[3]) return "scissors";

  // Sometimes only index is extended cleanly while middle is partial — accept
  // as scissors if 2 fingers are mostly extended but ring + pinky are clearly down.
  if (extCount === 2 && extended[0] && extended[1]) return "scissors";

  // 1 extended (just index) — looks like pointing — treat as scissors-ish only if
  // very clear; otherwise null. Helps disambiguate ambiguous frames.
  if (extCount === 1 && extended[0] && !thumbExtended) return null;

  return null;
}

/** 21-landmark connection list for MediaPipe hand model. */
const HAND_CONNECTIONS: Array<[number, number]> = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // palm
  [0, 17],
];

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  width: number,
  height: number,
  flipX: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  if (!lm || lm.length === 0) return;

  const px = (p: Landmark) => (flipX ? (1 - p.x) : p.x) * width;
  const py = (p: Landmark) => p.y * height;

  // Connections
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(245, 220, 140, 0.85)";
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!lm[a] || !lm[b]) continue;
    ctx.moveTo(px(lm[a]), py(lm[a]));
    ctx.lineTo(px(lm[b]), py(lm[b]));
  }
  ctx.stroke();

  // Joint dots
  for (let i = 0; i < lm.length; i++) {
    const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
    ctx.fillStyle = isTip ? "rgba(238, 108, 77, 0.95)" : "rgba(255, 255, 255, 0.92)";
    ctx.beginPath();
    ctx.arc(px(lm[i]), py(lm[i]), isTip ? 4.2 : 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

type Phase =
  | "loading"       // loading mediapipe
  | "ready"         // mediapipe loaded, waiting to start first round
  | "countdown"     // 3-2-1-Shoot!
  | "sampling"      // sampling gesture across N frames
  | "round-result"  // showing round result
  | "final"         // game over
  | "no-webcam"     // permission denied
  | "mp-failed";    // mediapipe load failed

// Webcam frame is sized as a corner overlay during RPS — the muppet stays the
// primary visual on stage. Internal canvas resolution stays a touch higher
// than the display so landmark overlay edges look crisp.
const VIDEO_W = 240;
const VIDEO_H = 180;
const SAMPLING_WINDOW_MS = 1500;

interface HandLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, t: number): {
    landmarks: Landmark[][];
  };
  close?: () => void;
}

export function RockPaperScissors({ officerName, onPass, onSkip, onOfficerSay }: ChallengeProps) {
  const character = characterFromName(officerName);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handsRef = useRef<HandLandmarkerLike | null>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("loading");

  // Per-frame samples accumulated during sampling phase.
  const sampleBufRef = useRef<Array<Gesture | null>>([]);
  const samplingDeadlineRef = useRef<number>(0);

  const [phase, setPhaseState] = useState<Phase>("loading");
  const [countdownTick, setCountdownTick] = useState<string>("");
  const [playerGesture, setPlayerGesture] = useState<Gesture | null>(null);
  const [officerGesture, setOfficerGesture] = useState<Gesture | null>(null);
  const [rounds, setRounds] = useState<RoundOutcome[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");
  // Live gesture readout — what MediaPipe currently sees.
  const [liveGesture, setLiveGesture] = useState<Gesture | null>(null);
  const [handVisible, setHandVisible] = useState(false);

  function setPhase(p: Phase) {
    phaseRef.current = p;
    setPhaseState(p);
  }

  const playerWins = rounds.filter((r) => r === "win").length;
  const officerWins = rounds.filter((r) => r === "loss").length;

  const stopWebcam = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (handsRef.current?.close) {
      try { handsRef.current.close(); } catch { /* noop */ }
    }
    handsRef.current = null;
  }, []);

  // ── Init: webcam + MediaPipe + start the always-on detection loop ─────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const { HandLandmarker, FilesetResolver } = await import(
          "@mediapipe/tasks-vision"
        );
        if (cancelled) return;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm",
        );
        const handLandmarker = await HandLandmarker.createFromOptions(
          filesetResolver,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          },
        );
        if (cancelled) {
          handLandmarker.close();
          return;
        }
        handsRef.current = handLandmarker as HandLandmarkerLike;

        setPhase("ready");
        setStatusMsg("Show your hand. Detection is live.");
        emitRpsTrace({ phase: "ready", handVisible: false, msg: "MediaPipe loaded" });
        startDetectionLoop();

        // Officer voices the lead-in. Player hears "Hand gesture identification.
        // Best of three." in character before the countdown starts.
        onOfficerSay?.(rpsLeadIn(character));

        // Auto-start first round 2.4 s after MediaPipe ready — gives the lead-in
        // line time to land + lets the user bring their hand into frame.
        setTimeout(() => {
          if (cancelled) return;
          if (phaseRef.current === "ready") runRound();
        }, 2400);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("not allowed")
        ) {
          emitRpsTrace({ phase: "no-webcam", handVisible: false, msg });
          setPhase("no-webcam");
        } else {
          console.warn("[RPS] MediaPipe failed:", err);
          emitRpsTrace({ phase: "mp-failed", handVisible: false, msg });
          setPhase("mp-failed");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      stopWebcam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Always-on detection loop: draws landmarks + updates liveGesture ──────
  const startDetectionLoop = useCallback(() => {
    let lastTimestamp = -1;
    let frameCount = 0;
    let lastTraceAt = 0;

    const tick = () => {
      const mp = handsRef.current;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!mp || !video || !overlay) return;

      const ctx = overlay.getContext("2d");
      if (!ctx) return;

      // detectForVideo requires monotonically increasing timestamps.
      const t = performance.now();
      const ts = t > lastTimestamp ? t : lastTimestamp + 1;
      lastTimestamp = ts;

      try {
        const result = mp.detectForVideo(video, ts);
        frameCount++;
        if (result.landmarks && result.landmarks.length > 0) {
          const lm = result.landmarks[0];
          drawLandmarks(ctx, lm, VIDEO_W, VIDEO_H, true /* flipX for mirrored video */);
          const g = classifyGesture(lm);
          setLiveGesture(g);
          setHandVisible(true);

          // While sampling, accumulate frames for majority voting.
          if (phaseRef.current === "sampling") {
            sampleBufRef.current.push(g);
          }

          // Throttled debug trace ~ every 500 ms while detecting.
          if (t - lastTraceAt > 500) {
            lastTraceAt = t;
            emitRpsTrace({
              phase: phaseRef.current,
              handVisible: true,
              liveGesture: g ?? "ambiguous",
              sampleCount: phaseRef.current === "sampling" ? sampleBufRef.current.length : undefined,
            });
          }
        } else {
          ctx.clearRect(0, 0, VIDEO_W, VIDEO_H);
          setLiveGesture(null);
          setHandVisible(false);
          if (phaseRef.current === "sampling") {
            sampleBufRef.current.push(null);
          }
          if (t - lastTraceAt > 1500) {
            lastTraceAt = t;
            emitRpsTrace({
              phase: phaseRef.current,
              handVisible: false,
              msg: `frames=${frameCount} no hand`,
            });
          }
        }
      } catch (err) {
        emitRpsTrace({
          phase: phaseRef.current,
          handVisible: false,
          msg: `detect err: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // End sampling once the deadline elapses.
      if (
        phaseRef.current === "sampling" &&
        performance.now() >= samplingDeadlineRef.current
      ) {
        finalizeSampling();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Round flow: countdown → sampling → result ───────────────────────────
  const runRound = useCallback(() => {
    setPlayerGesture(null);
    setOfficerGesture(null);
    setStatusMsg("Get ready…");
    setPhase("countdown");
    const ticks: Array<"3" | "2" | "1" | "SHOOT!"> = ["3", "2", "1", "SHOOT!"];
    let i = 0;
    setCountdownTick(ticks[i]);
    // Officer voices the first tick alongside the visual.
    onOfficerSay?.(rpsCountdown(character, ticks[0]));
    const interval = setInterval(() => {
      i++;
      if (i < ticks.length) {
        setCountdownTick(ticks[i]);
        onOfficerSay?.(rpsCountdown(character, ticks[i]));
      } else {
        clearInterval(interval);
        // Begin sampling: accumulate frames for SAMPLING_WINDOW_MS, then take majority.
        sampleBufRef.current = [];
        samplingDeadlineRef.current = performance.now() + SAMPLING_WINDOW_MS;
        setStatusMsg("Hold your gesture steady…");
        setPhase("sampling");
      }
    }, 700);
  }, [character, onOfficerSay]);

  function finalizeSampling() {
    const buf = sampleBufRef.current;
    sampleBufRef.current = [];
    samplingDeadlineRef.current = 0;
    emitRpsTrace({
      phase: "sampling-end",
      handVisible: false,
      sampleCount: buf.length,
      msg: `samples: rock=${buf.filter(g => g === "rock").length} paper=${buf.filter(g => g === "paper").length} scissors=${buf.filter(g => g === "scissors").length} null=${buf.filter(g => g === null).length}`,
    });

    // Tally non-null gestures from the last ~600 ms of the window
    // — early frames may catch a transitioning hand.
    const lateBuf = buf.slice(Math.floor(buf.length * 0.4));
    const counts: Record<Gesture, number> = { rock: 0, paper: 0, scissors: 0 };
    for (const g of lateBuf) {
      if (g) counts[g]++;
    }
    const totalDetected = counts.rock + counts.paper + counts.scissors;

    let playerG: Gesture;
    if (totalDetected === 0) {
      // No hand detected at all during sampling — fall back to random + warn.
      playerG = randomGesture();
      setStatusMsg("No hand detected — random play.");
    } else {
      // Majority vote.
      let bestCount = -1;
      let bestG: Gesture = "rock";
      for (const g of GESTURES) {
        if (counts[g] > bestCount) {
          bestCount = counts[g];
          bestG = g;
        }
      }
      playerG = bestG;
    }

    finalizeRound(playerG);
  }

  function finalizeRound(playerG: Gesture) {
    const offG = randomGesture();
    const outcome = evaluateRound(playerG, offG);
    setPlayerGesture(playerG);
    setOfficerGesture(offG);
    const newRounds = [...rounds, outcome];
    setRounds(newRounds);

    const pWins = newRounds.filter((r) => r === "win").length;
    const oWins = newRounds.filter((r) => r === "loss").length;

    if (outcome === "win") setStatusMsg("Point to you.");
    else if (outcome === "loss") setStatusMsg(`${officerName} takes the round.`);
    else setStatusMsg("A draw. Curious.");

    // Officer reacts in character. roundIdx ensures a different line each round.
    onOfficerSay?.(rpsRoundReaction(character, outcome, newRounds.length - 1));

    setPhase("round-result");

    const bestOf3Done = pWins >= 2 || oWins >= 2 || newRounds.length >= 3;
    if (bestOf3Done) {
      setTimeout(() => {
        setPhase("final");
        if (pWins >= oWins) {
          setStatusMsg("Verification passed. You have reflexes.");
        } else {
          setStatusMsg("You were bested. Proceeding anyway — the baby will test you harder.");
        }
        // Final voiced verdict — voiced before stopWebcam fires (which happens
        // after a 2.4 s delay in the final useEffect, giving the line time to play).
        onOfficerSay?.(rpsFinalLine(character, pWins, oWins));
      }, 1200);
    } else {
      // Wait for the reaction line to land before kicking off the next countdown.
      setTimeout(() => runRound(), 1900);
    }
  }

  // Final → pass.
  useEffect(() => {
    if (phase !== "final") return;
    const t = setTimeout(() => {
      stopWebcam();
      onPass();
    }, 2400);
    return () => clearTimeout(t);
  }, [phase, stopWebcam, onPass]);

  if (phase === "no-webcam" || phase === "mp-failed") {
    const reason = phase === "no-webcam"
      ? "Webcam access denied"
      : "Hand tracking unavailable in this environment";
    return (
      <div className="rps-challenge">
        <p className="rps-skip-note">
          {reason}. Skipping hand-gesture challenge and proceeding to next verification.
        </p>
        <div className="rps-actions">
          <button onClick={() => onSkip(reason)}>Skip to next challenge</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rps-challenge">
      <p className="rps-brief">
        Best of 3. Show your hand to the camera. {officerName} will respond.
      </p>

      <div className="rps-webcam">
        <div className="rps-webcam-frame" style={{ width: VIDEO_W, height: VIDEO_H }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Your webcam feed"
          />
          <canvas
            ref={overlayRef}
            width={VIDEO_W}
            height={VIDEO_H}
            className="rps-overlay"
          />
          <div className={`rps-live-readout ${handVisible ? "visible" : "hidden"}`}>
            <span className="rps-live-label">Live</span>
            <span className="rps-live-icon">
              {liveGesture ? GESTURE_EMOJI[liveGesture] : "—"}
            </span>
            <span className="rps-live-name">
              {liveGesture ?? (handVisible ? "ambiguous" : "no hand")}
            </span>
          </div>
        </div>
      </div>

      {phase === "loading" && (
        <p className="rps-skip-note">Initializing hand landmarker…</p>
      )}

      {phase === "countdown" && (
        <div className="rps-countdown" key={countdownTick}>
          {countdownTick}
        </div>
      )}

      {(phase === "sampling" || phase === "round-result" || phase === "final") && (
        <div className="rps-arena">
          <div className="rps-player-side">
            <span className="rps-label">You</span>
            <span
              className={`rps-gesture ${
                phase === "round-result" || phase === "final" ? "rps-reveal" : ""
              }`}
            >
              {phase === "sampling"
                ? (liveGesture ? GESTURE_EMOJI[liveGesture] : "❓")
                : (playerGesture ? GESTURE_EMOJI[playerGesture] : "❓")}
            </span>
          </div>
          <span className="rps-vs">VS</span>
          <div className="rps-officer-side">
            <span className="rps-label">{officerName}</span>
            <span
              className={`rps-gesture ${
                phase === "round-result" || phase === "final" ? "rps-reveal" : ""
              }`}
            >
              {officerGesture ? GESTURE_EMOJI[officerGesture] : "❓"}
            </span>
          </div>
        </div>
      )}

      <div className="rps-rounds">
        {Array.from({ length: 3 }).map((_, i) => {
          const r = rounds[i];
          return (
            <div
              key={i}
              className={`rps-pip ${
                r === "win"
                  ? "rps-win"
                  : r === "loss"
                    ? "rps-loss"
                    : r === "draw"
                      ? "rps-draw"
                      : ""
              }`}
            />
          );
        })}
      </div>

      <p
        className={`rps-status ${
          playerWins >= officerWins && phase === "final"
            ? "good"
            : phase === "final"
              ? "warn"
              : ""
        }`}
      >
        {statusMsg || (phase === "sampling" ? "Detecting…" : "")}
      </p>

      {phase !== "final" && (
        <div className="rps-actions">
          <button
            onClick={() => {
              stopWebcam();
              onSkip("Player skipped");
            }}
          >
            Skip challenge
          </button>
        </div>
      )}
    </div>
  );
}
