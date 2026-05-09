import type { GameState } from "@contracts/game-state";
import "./DebriefCard.css";

function archetypeFor(state: GameState): { name: string; tagline: string } {
  const { ledger } = state;
  const playerNet = ledger.playerNightShifts + ledger.playerSoothes - ledger.playerShirks * 2;
  const partnerNet = ledger.partnerNightShifts + ledger.partnerSoothes - ledger.partnerShirks * 2;

  if (ledger.playerShirks >= 3 && playerNet < partnerNet) {
    return { name: "Strategic Sleeper", tagline: "Theatrical breathing detected. Officer Tan is taking notes." };
  }
  if (ledger.playerNightShifts >= 2 && ledger.playerSoothes >= 4) {
    return { name: "Night Shifter", tagline: "Eyes ringed with policy. The Ministry recognizes your service." };
  }
  if (Math.abs(ledger.playerNightShifts - ledger.partnerNightShifts) <= 1 && ledger.playerSoothes >= 2) {
    return { name: "Co-Pilot", tagline: "An equitable distribution of small disasters." };
  }
  if (ledger.playerSoothes >= 5 && ledger.playerShirks === 0) {
    return { name: "Overfunctioner", tagline: "Filed under: cannot help themselves help." };
  }
  return { name: "Mixed Performer", tagline: "Reviewable. Not yet alarming." };
}

function babyTraitsRevealed(state: GameState): string[] {
  const out: string[] = [];
  out.push(`soothing: ${state.baby.traits.soothing}`);
  out.push(`temperament: ${state.baby.traits.temperament}`);
  out.push(`feeding: ${state.baby.traits.feeding}`);
  return out;
}

type Props = {
  state: GameState;
  onReplay: () => void;
};

export function DebriefCard({ state, onReplay }: Props) {
  const arch = archetypeFor(state);
  const traits = babyTraitsRevealed(state);
  const partnerArch = state.partner.traits.archetype;
  return (
    <div className="debrief-card">
      <div className="debrief-stamp">PROBATION FILE · {state.officer.name.toUpperCase()}</div>
      <h2 className="debrief-archetype">{arch.name}</h2>
      <p className="debrief-tagline">{arch.tagline}</p>

      <div className="debrief-section">
        <span className="kicker">Your child</span>
        <div className="debrief-traits">
          <strong>{state.baby.name || "Unnamed"}</strong>
          <ul>
            {traits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="debrief-section">
        <span className="kicker">Co-parent</span>
        <p>
          <strong>{state.partner.name}</strong> · archetype: {partnerArch} · final fatigue {Math.round(state.partner.fatigue)} · resentment {Math.round(state.partner.resentment)}
        </p>
      </div>

      <div className="debrief-section">
        <span className="kicker">Final ledger</span>
        <div className="debrief-ledger">
          <div>
            <span>Night shifts</span>
            <strong>You {state.ledger.playerNightShifts} · {state.partner.name} {state.ledger.partnerNightShifts}</strong>
          </div>
          <div>
            <span>Soothes</span>
            <strong>You {state.ledger.playerSoothes} · {state.partner.name} {state.ledger.partnerSoothes}</strong>
          </div>
          <div>
            <span>Shirks</span>
            <strong>You {state.ledger.playerShirks} · {state.partner.name} {state.ledger.partnerShirks}</strong>
          </div>
        </div>
      </div>

      <button className="primary debrief-replay" onClick={onReplay}>
        File another rehearsal
      </button>
    </div>
  );
}
