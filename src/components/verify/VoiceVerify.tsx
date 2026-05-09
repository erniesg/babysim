import { useCallback, useEffect, useRef, useState } from "react";
import "./VoiceVerify.css";

interface ChallengeProps {
  officerName: string;
  onPass: () => void;
  onFail: () => void;
  onSkip: (reason: string) => void;
}

const PHRASES = [
  "I will not yell at this baby",
  "I will sleep when the baby sleeps",
  "I will ask for help when I need it",
];

/** Levenshtein distance between two strings (word-level). */
function wordSimilarity(a: string, b: string): number {
  const aWords = a.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  const bWords = b.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (bWords.length === 0) return 0;
  const matched = aWords.filter((w) => bWords.includes(w)).length;
  return matched / bWords.length;
}

// Extend Window for SpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResult {
  readonly [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResult;
  length: number;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

type Phase = "waiting" | "listening" | "done-pass" | "done-fail" | "retry" | "no-api";

export function VoiceVerify({ officerName, onPass, onSkip }: ChallengeProps) {
  const [phrase] = useState<string>(() => PHRASES[Math.floor(Math.random() * PHRASES.length)]);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [transcript, setTranscript] = useState<string>("");
  const [similarity, setSimilarity] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [retryUsed, setRetryUsed] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const SpeechAPI =
    typeof window !== "undefined"
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
      : undefined;

  useEffect(() => {
    if (!SpeechAPI) {
      setPhase("no-api");
    }
  }, [SpeechAPI]);

  const startListening = useCallback(() => {
    if (!SpeechAPI) return;
    setTranscript("");
    setSimilarity(0);
    setStatusMsg("Speak clearly…");
    setPhase("listening");

    const rec = new SpeechAPI();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) {
          final += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      const combined = (final + interim).trim();
      setTranscript(combined);
      const sim = wordSimilarity(combined, phrase);
      setSimilarity(sim);
    };

    rec.onerror = () => {
      setStatusMsg("Could not pick up audio. Try again.");
      setPhase("done-fail");
    };

    rec.onend = () => {
      const currentTranscript = recognitionRef.current ? transcript : "";
      // Compute similarity once more at end for the final transcript
      setTranscript((t) => {
        const sim = wordSimilarity(t, phrase);
        setSimilarity(sim);
        if (sim >= 0.7) {
          setStatusMsg("Phrase accepted.");
          setPhase("done-pass");
        } else {
          setStatusMsg(
            `Similarity too low (${Math.round(sim * 100)}%). ` +
            (retryUsed ? "Moving on." : "You have one retry.")
          );
          setPhase("done-fail");
        }
        return t;
      });
      void currentTranscript;
    };

    rec.start();
  }, [SpeechAPI, phrase, retryUsed, transcript]);

  const handleRetry = () => {
    setRetryUsed(true);
    startListening();
  };

  // Auto-advance after pass
  useEffect(() => {
    if (phase !== "done-pass") return;
    const t = setTimeout(() => onPass(), 1600);
    return () => clearTimeout(t);
  }, [phase, onPass]);

  // Auto-skip after second fail
  useEffect(() => {
    if (phase !== "done-fail" || !retryUsed) return;
    const t = setTimeout(() => onSkip("Failed voice verification after retry"), 2000);
    return () => clearTimeout(t);
  }, [phase, retryUsed, onSkip]);

  if (phase === "no-api") {
    return (
      <div className="voice-challenge">
        <p className="voice-skip-note">
          Voice recognition unavailable in this browser. Skipping voice challenge.
        </p>
        <div className="voice-actions">
          <button onClick={() => onSkip("Web Speech API not supported")}>
            Skip to next challenge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-challenge">
      <div className="voice-phrase-box">
        <div className="voice-phrase-label">{officerName} demands you confirm:</div>
        <div>"{phrase}"</div>
      </div>

      <div className="voice-transcript">
        <div className="voice-transcript-label">
          {phase === "listening" && <span><span className="voice-listening-dot" />Listening…</span>}
          {phase !== "listening" && "Your transcript"}
        </div>
        {transcript || (phase === "listening" ? "" : "—")}
      </div>

      {(phase === "listening" || phase === "done-pass" || phase === "done-fail") && (
        <div className="voice-similarity-bar">
          <div className="voice-similarity-label">
            <span>Phrase match</span>
            <span>{Math.round(similarity * 100)}%</span>
          </div>
          <div className="voice-similarity-track">
            <div
              className="voice-similarity-fill"
              style={{ width: `${Math.min(100, similarity * 100)}%` }}
            />
          </div>
        </div>
      )}

      <p className={`voice-status ${phase === "done-pass" ? "good" : phase === "done-fail" ? "warn" : ""}`}>
        {statusMsg}
      </p>

      <div className="voice-actions">
        {phase === "waiting" && (
          <button className="primary" onClick={startListening}>
            Begin Speaking
          </button>
        )}
        {phase === "done-fail" && !retryUsed && (
          <button onClick={handleRetry}>Retry</button>
        )}
        {phase === "done-fail" && retryUsed && (
          <button onClick={() => onSkip("Failed voice verification after retry")}>
            Proceed
          </button>
        )}
        {phase === "listening" && (
          <button onClick={() => recognitionRef.current?.stop()}>Done Speaking</button>
        )}
      </div>
    </div>
  );
}
