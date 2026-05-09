import { useEffect, useState } from "react";
import "./DebugOverlay.css";

/**
 * DebugOverlay — visible diagnostic panel surfaced when `?debug=1` is in the URL.
 *
 * Listens to global `agent-trace` and `rps-trace` CustomEvents emitted by the
 * agent clients + RPS component. Anyone with the URL flag can see whether
 * gpt-5.5 / Gemini calls are actually firing, what tools they returned, and
 * whether MediaPipe is detecting hand landmarks per frame.
 *
 * No-op outside debug mode (returns null).
 */

export type AgentTrace = {
  ts: number;
  agent: "officer" | "baby" | "partner";
  status: "called" | "ok" | "fallback" | "error";
  detail?: string;
  tools?: string[];
};

export type RpsTrace = {
  ts: number;
  phase: string;
  handVisible: boolean;
  liveGesture?: string | null;
  sampleCount?: number;
  msg?: string;
};

declare global {
  interface WindowEventMap {
    "agent-trace": CustomEvent<AgentTrace>;
    "rps-trace": CustomEvent<RpsTrace>;
  }
}

export function emitAgentTrace(t: Omit<AgentTrace, "ts">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-trace", { detail: { ...t, ts: Date.now() } }),
  );
}

export function emitRpsTrace(t: Omit<RpsTrace, "ts">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("rps-trace", { detail: { ...t, ts: Date.now() } }),
  );
}

function isDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

const MAX_AGENT_LOG = 30;
const MAX_RPS_LOG = 12;

export function DebugOverlay({ beatId, phase }: { beatId: string; phase: string }) {
  const [debug] = useState(isDebugMode());
  const [agentLog, setAgentLog] = useState<AgentTrace[]>([]);
  const [rpsLog, setRpsLog] = useState<RpsTrace[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!debug) return;

    const onAgent = (e: CustomEvent<AgentTrace>) => {
      setAgentLog((prev) => [e.detail, ...prev].slice(0, MAX_AGENT_LOG));
    };
    const onRps = (e: CustomEvent<RpsTrace>) => {
      setRpsLog((prev) => [e.detail, ...prev].slice(0, MAX_RPS_LOG));
    };
    window.addEventListener("agent-trace", onAgent);
    window.addEventListener("rps-trace", onRps);
    return () => {
      window.removeEventListener("agent-trace", onAgent);
      window.removeEventListener("rps-trace", onRps);
    };
  }, [debug]);

  if (!debug) return null;

  return (
    <div className={`debug-overlay ${collapsed ? "collapsed" : ""}`}>
      <button
        className="debug-toggle"
        onClick={() => setCollapsed((c) => !c)}
        title="Toggle debug overlay"
      >
        {collapsed ? "▼ DEBUG" : "▲ DEBUG"}
      </button>

      {!collapsed && (
        <>
          <div className="debug-section">
            <span className="debug-section-title">State</span>
            <div className="debug-state-line">
              <span>beat:</span> <strong>{beatId}</strong>
              {" · "}
              <span>phase:</span> <strong>{phase}</strong>
            </div>
          </div>

          <div className="debug-section">
            <span className="debug-section-title">
              Agent calls ({agentLog.length})
            </span>
            <ul className="debug-list">
              {agentLog.length === 0 && (
                <li className="debug-empty">no calls yet</li>
              )}
              {agentLog.map((t, i) => (
                <li key={i} className={`debug-entry debug-${t.status}`}>
                  <span className="debug-time">
                    {new Date(t.ts).toLocaleTimeString().slice(0, 8)}
                  </span>
                  <span className="debug-agent-name">{t.agent}</span>
                  <span className="debug-agent-status">{t.status}</span>
                  {t.tools && t.tools.length > 0 && (
                    <span className="debug-agent-tools">
                      → {t.tools.join(" · ")}
                    </span>
                  )}
                  {t.detail && (
                    <span className="debug-agent-detail">{t.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="debug-section">
            <span className="debug-section-title">
              RPS / MediaPipe ({rpsLog.length})
            </span>
            <ul className="debug-list">
              {rpsLog.length === 0 && (
                <li className="debug-empty">no rps activity</li>
              )}
              {rpsLog.map((t, i) => (
                <li key={i} className="debug-entry">
                  <span className="debug-time">
                    {new Date(t.ts).toLocaleTimeString().slice(0, 8)}
                  </span>
                  <span className="debug-rps-phase">{t.phase}</span>
                  <span
                    className={`debug-rps-hand ${t.handVisible ? "ok" : "off"}`}
                  >
                    hand {t.handVisible ? "✓" : "—"}
                  </span>
                  {t.liveGesture && (
                    <span className="debug-rps-gesture">{t.liveGesture}</span>
                  )}
                  {t.sampleCount != null && (
                    <span className="debug-rps-count">n={t.sampleCount}</span>
                  )}
                  {t.msg && <span className="debug-rps-msg">{t.msg}</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
