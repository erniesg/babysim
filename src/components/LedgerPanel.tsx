import type { FairnessLedger } from "@contracts/game-state";
import "./LedgerPanel.css";

export function LedgerPanel({ ledger, partnerName }: { ledger: FairnessLedger; partnerName: string }) {
  const playerScore = ledger.playerNightShifts + ledger.playerSoothes - ledger.playerShirks;
  const partnerScore = ledger.partnerNightShifts + ledger.partnerSoothes - ledger.partnerShirks;
  return (
    <div className="ledger-panel">
      <span className="kicker">Fairness ledger</span>
      <div className="ledger-grid">
        <div className="ledger-row">
          <span>You</span>
          <span className="dim">night {ledger.playerNightShifts} · soothe {ledger.playerSoothes} · shirk {ledger.playerShirks}</span>
          <span className={`score ${playerScore >= partnerScore ? "win" : "loss"}`}>{playerScore >= 0 ? `+${playerScore}` : playerScore}</span>
        </div>
        <div className="ledger-row">
          <span>{partnerName || "Partner"}</span>
          <span className="dim">night {ledger.partnerNightShifts} · soothe {ledger.partnerSoothes} · shirk {ledger.partnerShirks}</span>
          <span className={`score ${partnerScore >= playerScore ? "win" : "loss"}`}>{partnerScore >= 0 ? `+${partnerScore}` : partnerScore}</span>
        </div>
      </div>
    </div>
  );
}
