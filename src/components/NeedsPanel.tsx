import type { RenderState } from "@contracts/messages";
import "./NeedsPanel.css";

const NEEDS: Array<{ key: keyof RenderState["baby"]; label: string; inverted?: boolean }> = [
  { key: "hunger", label: "Hunger" },
  { key: "sleepiness", label: "Sleep need" },
  { key: "discomfort", label: "Discomfort" },
  { key: "connection", label: "Connection", inverted: true },
];

export function NeedsPanel({ baby }: { baby: RenderState["baby"] }) {
  return (
    <div className="needs-panel">
      <div className="needs-header">
        <span className="kicker">Baby state</span>
      </div>
      <div className="needs-grid">
        {NEEDS.map(({ key, label, inverted }) => {
          const value = Math.round(baby[key] as number);
          // For pressure meters, high = bad. For connection, high = good.
          const ratio = inverted ? value / 100 : 1 - value / 100;
          const color = ratio > 0.66 ? "#6cae75" : ratio > 0.33 ? "#e9c46a" : "#ee6c4d";
          return (
            <div className="need-row" key={key}>
              <span className="need-label">{label}</span>
              <div className="need-track">
                <div
                  className="need-fill"
                  style={{ width: `${value}%`, background: color }}
                />
              </div>
              <span className="need-value">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
