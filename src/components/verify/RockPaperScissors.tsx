import { useCallback, useEffect, useRef, useState } from "react";
import "./RockPaperScissors.css";

type Gesture = "rock" | "paper" | "scissors";
type RoundOutcome = "win" | "loss" | "draw";

interface ChallengeProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
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

/** Rough finger-extension classifier from 21 MediaPipe hand landmarks.
 *  Returns the gesture or null if ambiguous. */
function classifyGesture(
  landmarks: Array<{ x: number; y: number; z: number }>
): Gesture | null {
  // Fingertips: thumb=4, index=8, middle=12, ring=16, pinky=20
  // PIP joints:          index=6, middle=10, ring=14, pinky=18
  // MCP joints:          index=5, middle=9,  ring=13, pinky=17
  // Thumb CMC=1, MCP=2, IP=3, TIP=4

  const tipIds = [8, 12, 16, 20]; // index through pinky
  const pipIds = [6, 10, 14, 18];

  // Count extended fingers (tip y < pip y in image coords — y increases down)
  const extended = tipIds.map((tip, i) => landmarks[tip].y < landmarks[pipIds[i]].y);
  const extCount = extended.filter(Boolean).length;

  // Thumb: compare tip x to IP joint x (left hand heuristic)
  const thumbExtended = Math.abs(landmarks[4].x - landmarks[2].x) > 0.06;

  if (extCount === 0 && !thumbExtended) return "rock";
  if (extCount >= 4) return "paper";
  if (extended[0] && extended[1] && !extended[2] && !extended[3]) return "scissors";
  return null;
}

type Phase =
  | "loading"       // loading mediapipe
  | "countdown"     // 3-2-1-Shoot!
  | "sampling"      // sampling gesture
  | "round-result"  // showing round result
  | "final"         // game over
  | "no-webcam"     // permission denied
  | "mp-failed";    // mediapipe load failed

export function RockPaperScissors({ officerName, onPass, onSkip }: ChallengeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handsRef = useRef<unknown>(null); // MediaPipe HandLandmarker instance
  const rafRef = useRef<number>(0);
  const animFrameActive = useRef(false);

  const [phase, setPhase] = useState<Phase>("loading");
  const [countdownTick, setCountdownTick] = useState<string>("");
  const [playerGesture, setPlayerGesture] = useState<Gesture | null>(null);
  const [officerGesture, setOfficerGesture] = useState<Gesture | null>(null);
  const [rounds, setRounds] = useState<RoundOutcome[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");

  // Detect best-of-3 game end
  const playerWins = rounds.filter((r) => r === "win").length;
  const officerWins = rounds.filter((r) => r === "loss").length;
  const roundCount = rounds.length;

  const stopWebcam = useCallback(() => {
    animFrameActive.current = false;
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Load MediaPipe and open webcam
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // Request webcam first
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Dynamically import MediaPipe to avoid breaking environments without it
        const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        if (cancelled) return;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) { handLandmarker.close(); return; }
        handsRef.current = handLandmarker;
        setPhase("countdown");
        setStatusMsg("Get your hand ready!");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("not allowed")) {
          setPhase("no-webcam");
        } else {
          console.warn("[RPS] MediaPipe failed:", err);
          setPhase("mp-failed");
        }
      }
    }
    init();
    return () => { cancelled = true; stopWebcam(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run countdown then sample
  const runRound = useCallback(() => {
    setPlayerGesture(null);
    setOfficerGesture(null);
    setPhase("countdown");
    const ticks = ["3", "2", "1", "SHOOT!"];
    let i = 0;
    const interval = setInterval(() => {
      setCountdownTick(ticks[i]);
      i++;
      if (i >= ticks.length) {
        clearInterval(interval);
        setPhase("sampling");
      }
    }, 700);
  }, []);

  // Sample gesture when entering sampling phase
  useEffect(() => {
    if (phase !== "sampling") return;
    const mp = handsRef.current as { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: Array<Array<{ x: number; y: number; z: number }>> } } | null;
    if (!mp || !videoRef.current) {
      // fallback: random gesture for player
      finalizeRound(randomGesture());
      return;
    }
    const video = videoRef.current;
    let detected = false;
    const deadline = performance.now() + 1200;

    const tick = () => {
      if (detected) return;
      if (performance.now() > deadline) {
        finalizeRound(randomGesture());
        return;
      }
      try {
        const result = mp.detectForVideo(video, performance.now());
        if (result.landmarks && result.landmarks.length > 0) {
          const gesture = classifyGesture(result.landmarks[0]);
          if (gesture) {
            detected = true;
            finalizeRound(gesture);
            return;
          }
        }
      } catch {
        // ignore per-frame errors
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

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

    setPhase("round-result");

    // Check game-end conditions
    const bestOf3Done = pWins >= 2 || oWins >= 2 || newRounds.length >= 3;
    if (bestOf3Done) {
      setTimeout(() => {
        setPhase("final");
        if (pWins >= oWins) {
          setStatusMsg("Verification passed. You have reflexes.");
        } else {
          setStatusMsg("You were bested. Proceeding anyway — the baby will test you harder.");
        }
      }, 1200);
    } else {
      setTimeout(() => runRound(), 1500);
    }
  }

  // Game end: always pass (player wins or ties are covered; even a loss proceeds per spec)
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
        <video ref={videoRef} autoPlay playsInline muted aria-label="Your webcam feed" />
      </div>

      {phase === "loading" && (
        <p className="rps-skip-note">Initializing hand landmarker…</p>
      )}

      {(phase === "countdown") && (
        <div className="rps-countdown" key={countdownTick}>{countdownTick}</div>
      )}

      {(phase === "sampling" || phase === "round-result" || phase === "final") && (
        <div className="rps-arena">
          <div className="rps-player-side">
            <span className="rps-label">You</span>
            <span className={`rps-gesture ${phase === "round-result" ? "rps-reveal" : ""}`}>
              {playerGesture ? GESTURE_EMOJI[playerGesture] : "❓"}
            </span>
          </div>
          <span className="rps-vs">VS</span>
          <div className="rps-officer-side">
            <span className="rps-label">{officerName}</span>
            <span className={`rps-gesture ${phase === "round-result" ? "rps-reveal" : ""}`}>
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
              className={`rps-pip ${r === "win" ? "rps-win" : r === "loss" ? "rps-loss" : r === "draw" ? "rps-draw" : ""}`}
            />
          );
        })}
      </div>

      <p className={`rps-status ${playerWins >= officerWins && phase === "final" ? "good" : phase === "final" ? "warn" : ""}`}>
        {statusMsg || (phase === "sampling" ? "Detecting…" : "")}
        {phase !== "final" && roundCount > 0 && phase !== "round-result"
          ? ` | Round ${roundCount + 1} / 3`
          : ""}
      </p>
    </div>
  );
}
