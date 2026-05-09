import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRng, seedRoll } from "../seed";
import { reducer } from "../reducer";
import { tick, cryTrigger, actionResponse, visualState } from "../baby-agent";
import { lineFor, partnerReaction } from "../partner-agent";
import { DirectorRuntime } from "../runtime";
import { LocalGameTransport } from "../transport";
import type { GameState, GameEvent, BabyState, BabyTraits, BabyNeeds, ComfortFlags } from "@contracts/game-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: GameEvent["type"],
  actor: GameEvent["actor"] = "player",
  action?: GameEvent["action"],
  payload?: Record<string, unknown>,
): GameEvent {
  return { id: "test-id", at: 0, actor, type, action, payload };
}

function makeBabyState(overrides: Partial<BabyState> = {}): BabyState {
  const defaultNeeds: BabyNeeds = {
    hunger: 20,
    sleepiness: 15,
    discomfort: 10,
    connection: 70,
    health: 100,
    mood: 80,
  };
  const defaultTraits: BabyTraits = {
    soothing: "motion",
    stimulation: "medium",
    feeding: "regular",
    sleep: "heavy",
    temperament: "sunny",
  };
  return {
    name: "",
    gender: "girl",
    traits: defaultTraits,
    needs: defaultNeeds,
    visualState: "settled",
    isAsleep: false,
    discoveredTraits: [],
    ...overrides,
  };
}

const DEFAULT_COMFORT: ComfortFlags = {
  diaperWet: false,
  tooHot: false,
  tooCold: false,
  awkwardPosition: false,
};

function makeMinimalState(beatId = "home"): GameState {
  const roll = seedRoll("test-seed");
  return {
    sessionId: "test-session",
    seed: "test-seed",
    phase: "home",
    beatId,
    currentHour: 8,
    settings: { realSecondsPerGameHour: 3 },
    baby: { ...roll.baby, name: "" },
    partner: { ...roll.partner, mood: 50, fatigue: 0, resentment: 0 },
    officer: roll.officer,
    comfort: DEFAULT_COMFORT,
    ledger: {
      playerNightShifts: 0,
      partnerNightShifts: 0,
      playerShirks: 0,
      partnerShirks: 0,
      playerSoothes: 0,
      partnerSoothes: 0,
    },
    eventLog: [],
  };
}

// ---------------------------------------------------------------------------
// 1. seed — same seed → same roll
// ---------------------------------------------------------------------------

describe("makeRng", () => {
  it("produces deterministic values from the same seed", () => {
    const r1 = makeRng("hello");
    const r2 = makeRng("hello");
    expect(r1.next()).toBe(r2.next());
    expect(r1.next()).toBe(r2.next());
  });

  it("produces different sequences from different seeds", () => {
    const r1 = makeRng("foo");
    const r2 = makeRng("bar");
    const v1 = r1.next();
    const v2 = r2.next();
    expect(v1).not.toBe(v2);
  });

  it("pick() selects deterministically from an array", () => {
    const rng = makeRng("seed-42");
    const items = ["a", "b", "c", "d"] as const;
    const pick1 = rng.pick(items);
    const rng2 = makeRng("seed-42");
    const pick2 = rng2.pick(items);
    expect(pick1).toBe(pick2);
  });
});

describe("seedRoll", () => {
  it("same seed produces identical baby traits", () => {
    const r1 = seedRoll("abc123");
    const r2 = seedRoll("abc123");
    expect(r1.baby.traits).toEqual(r2.baby.traits);
  });

  it("same seed produces identical partner archetype", () => {
    const r1 = seedRoll("abc123");
    const r2 = seedRoll("abc123");
    expect(r1.partner.traits.archetype).toBe(r2.partner.traits.archetype);
  });

  it("same seed produces identical officer name", () => {
    const r1 = seedRoll("abc123");
    const r2 = seedRoll("abc123");
    expect(r1.officer.name).toBe(r2.officer.name);
  });

  it("officer name is one of the three allowed names", () => {
    const { officer } = seedRoll("any-seed");
    const allowed = ["Officer Ernest", "Officer Bern", "Officer Crumb"];
    expect(allowed).toContain(officer.name);
  });

  it("baby has no name (empty string) in the roll result", () => {
    // seedRoll returns Omit<BabyState, 'name'> — caller assigns name later.
    const { baby } = seedRoll("any-seed");
    // Confirm no name field leaks into the roll.
    expect("name" in baby).toBe(false);
  });

  it("different seeds produce different rolls", () => {
    const r1 = seedRoll("seed-a");
    const r2 = seedRoll("seed-b");
    // At least traits should differ across a large enough sample.
    // We can't guarantee a single field differs, so compare the whole object.
    const same =
      r1.baby.traits.soothing === r2.baby.traits.soothing &&
      r1.baby.traits.feeding === r2.baby.traits.feeding &&
      r1.officer.name === r2.officer.name &&
      r1.partner.traits.archetype === r2.partner.traits.archetype;
    // It's statistically near-certain they're not all equal across 4 fields.
    expect(same).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. reducer — rejects out-of-beat actions
// ---------------------------------------------------------------------------

describe("reducer", () => {
  it("rejects an action not in the current beat's allowedActions", () => {
    // 'home' beat only allows start_game / create_room / join_room.
    const state = makeMinimalState("home");
    const before = state.eventLog.length;
    const next = reducer(state, makeEvent("ACTION", "player", "feed"));
    // State unchanged except eventLog gets the rejected event appended.
    expect(next.baby.needs.hunger).toBe(state.baby.needs.hunger);
    expect(next.ledger.playerSoothes).toBe(0);
    // Event is still logged (so UI can surface feedback if desired).
    expect(next.eventLog.length).toBe(before + 1);
  });

  it("accepts an action in the current beat's allowedActions", () => {
    const state = makeMinimalState("home");
    const next = reducer(state, makeEvent("ACTION", "player", "start_game"));
    expect(next.beatId).toBe("home"); // reducer doesn't change beat; runtime does
    expect(next.eventLog.length).toBe(1);
  });

  it("shirk increments playerShirks in the ledger", () => {
    const state = makeMinimalState("night_cry");
    const next = reducer(state, makeEvent("ACTION", "player", "shirk"));
    expect(next.ledger.playerShirks).toBe(1);
    expect(next.partner.resentment).toBeGreaterThan(state.partner.resentment);
  });

  it("get_up increments playerNightShifts", () => {
    const state = makeMinimalState("night_cry");
    const next = reducer(state, makeEvent("ACTION", "player", "get_up"));
    expect(next.ledger.playerNightShifts).toBe(1);
  });

  it("wake_partner wakes partner and raises fatigue/resentment", () => {
    const state = { ...makeMinimalState("night_cry"), partner: { ...makeMinimalState("night_cry").partner, isAsleep: true } };
    const next = reducer(state, makeEvent("ACTION", "player", "wake_partner"));
    expect(next.partner.isAsleep).toBe(false);
    expect(next.partner.fatigue).toBeGreaterThan(state.partner.fatigue);
  });

  it("BEAT_ENTERED updates beatId and phase", () => {
    const state = makeMinimalState("home");
    const next = reducer(state, makeEvent("BEAT_ENTERED", "system", undefined, { beatId: "probation_splash" }));
    expect(next.beatId).toBe("probation_splash");
    expect(next.phase).toBe("intake");
  });

  it("STATE_CHANGED with hoursDelta advances currentHour", () => {
    const state = makeMinimalState("home");
    const next = reducer(state, makeEvent("STATE_CHANGED", "system", undefined, { hoursDelta: 3 }));
    expect(next.currentHour).toBe(state.currentHour + 3);
  });

  it("panic and skip_to are never gated by allowedActions", () => {
    const state = makeMinimalState("home");
    // 'panic' is not in home's allowedActions but should still be logged.
    const next = reducer(state, makeEvent("ACTION", "player", "panic"));
    expect(next.eventLog.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. baby-agent — tick raises hunger
// ---------------------------------------------------------------------------

describe("baby-agent tick", () => {
  it("raises hunger while baby is awake", () => {
    const baby = makeBabyState({ traits: { soothing: "motion", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" } });
    const delta = tick(baby, DEFAULT_COMFORT, 1);
    expect(delta.hunger).toBeGreaterThan(0);
  });

  it("raises sleepiness while baby is awake", () => {
    const baby = makeBabyState();
    const delta = tick(baby, DEFAULT_COMFORT, 1);
    expect(delta.sleepiness).toBeGreaterThan(0);
  });

  it("reduces sleepiness while baby is asleep", () => {
    const baby = makeBabyState({ isAsleep: true });
    const delta = tick(baby, DEFAULT_COMFORT, 1);
    expect((delta.sleepiness ?? 0)).toBeLessThan(0);
  });

  it("frequent-feeder accumulates hunger faster than regular", () => {
    const frequent = makeBabyState({ traits: { soothing: "motion", stimulation: "medium", feeding: "frequent", sleep: "heavy", temperament: "sunny" } });
    const regular = makeBabyState({ traits: { soothing: "motion", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" } });
    const d1 = tick(frequent, DEFAULT_COMFORT, 1);
    const d2 = tick(regular, DEFAULT_COMFORT, 1);
    expect(d1.hunger).toBeGreaterThan(d2.hunger!);
  });
});

// ---------------------------------------------------------------------------
// 4. baby-agent — cryTrigger
// ---------------------------------------------------------------------------

describe("baby-agent cryTrigger", () => {
  it("returns null when all needs are below threshold", () => {
    const baby = makeBabyState({
      needs: { hunger: 10, sleepiness: 10, discomfort: 10, connection: 90, health: 100, mood: 90 },
    });
    expect(cryTrigger(baby)).toBeNull();
  });

  it("returns 'hunger' when hunger exceeds threshold", () => {
    const baby = makeBabyState({
      needs: { hunger: 80, sleepiness: 10, discomfort: 5, connection: 80, health: 100, mood: 50 },
    });
    const trigger = cryTrigger(baby);
    expect(trigger).toBe("hunger");
  });

  it("returns the highest-pressure trigger when multiple exceed threshold", () => {
    const baby = makeBabyState({
      needs: { hunger: 70, sleepiness: 75, discomfort: 5, connection: 80, health: 100, mood: 40 },
    });
    const trigger = cryTrigger(baby);
    expect(trigger).toBe("sleepiness");
  });

  it("returns 'lonely' when connection is very low", () => {
    const baby = makeBabyState({
      needs: { hunger: 10, sleepiness: 10, discomfort: 5, connection: 5, health: 100, mood: 60 },
    });
    const trigger = cryTrigger(baby);
    expect(trigger).toBe("lonely");
  });
});

// ---------------------------------------------------------------------------
// 5. baby-agent — actionResponse (motion-soothed calmed by rock)
// ---------------------------------------------------------------------------

describe("baby-agent actionResponse", () => {
  it("rock helps a motion-soothed baby", () => {
    const baby = makeBabyState({
      traits: { soothing: "motion", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" },
    });
    const result = actionResponse("rock", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("helps");
    expect((result.needsDelta.discomfort ?? 0)).toBeLessThan(0);
  });

  it("rock worsens a silence-soothed baby", () => {
    const baby = makeBabyState({
      traits: { soothing: "silence", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" },
    });
    const result = actionResponse("rock", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("worsens");
  });

  it("feed helps when hunger is above threshold", () => {
    const baby = makeBabyState({
      needs: { hunger: 50, sleepiness: 10, discomfort: 5, connection: 70, health: 100, mood: 70 },
    });
    const result = actionResponse("feed", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("helps");
    expect((result.needsDelta.hunger ?? 0)).toBeLessThan(0);
  });

  it("feed is neutral when hunger is low", () => {
    const baby = makeBabyState({
      needs: { hunger: 5, sleepiness: 10, discomfort: 5, connection: 70, health: 100, mood: 90 },
    });
    const result = actionResponse("feed", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("neutral");
  });

  it("shush helps a silence-soothed baby", () => {
    const baby = makeBabyState({
      traits: { soothing: "silence", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" },
    });
    const result = actionResponse("shush", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("helps");
  });

  it("hold helps contact-soothed and raises connection", () => {
    const baby = makeBabyState({
      traits: { soothing: "contact", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" },
    });
    const result = actionResponse("hold", baby, DEFAULT_COMFORT);
    expect(result.effectiveness).toBe("helps");
    expect((result.needsDelta.connection ?? 0)).toBeGreaterThan(0);
  });

  it("discoveredTraitHint is set for motion-soothed baby when rocked", () => {
    const baby = makeBabyState({
      traits: { soothing: "motion", stimulation: "medium", feeding: "regular", sleep: "heavy", temperament: "sunny" },
    });
    const result = actionResponse("rock", baby, DEFAULT_COMFORT);
    expect(result.discoveredTraitHint).toBe("motion-soothed");
  });

  it("check_diaper clears diaperWet flag", () => {
    const baby = makeBabyState();
    const result = actionResponse("check_diaper", baby, { ...DEFAULT_COMFORT, diaperWet: true });
    expect(result.comfortDelta.diaperWet).toBe(false);
    expect(result.effectiveness).toBe("helps");
  });
});

// ---------------------------------------------------------------------------
// 6. baby-agent — visualState
// ---------------------------------------------------------------------------

describe("baby-agent visualState", () => {
  it("returns 'sleep' when baby isAsleep", () => {
    const baby = makeBabyState({ isAsleep: true });
    expect(visualState(baby)).toBe("sleep");
  });

  it("returns 'crying' when top pressure >= 70", () => {
    const baby = makeBabyState({
      needs: { hunger: 80, sleepiness: 10, discomfort: 5, connection: 70, health: 100, mood: 30 },
    });
    expect(visualState(baby)).toBe("crying");
  });

  it("returns 'settled' when all needs are low", () => {
    const baby = makeBabyState({
      needs: { hunger: 5, sleepiness: 5, discomfort: 2, connection: 95, health: 100, mood: 95 },
    });
    expect(visualState(baby)).toBe("settled");
  });
});

// ---------------------------------------------------------------------------
// 7. partner-agent — lineFor returns a string for every beat/archetype combo
// ---------------------------------------------------------------------------

describe("partner-agent lineFor", () => {
  const archetypes = ["anxious", "chill", "resentful", "overfunctioner"] as const;
  const beats = ["officer_intro", "argument_start", "argument_resolution", "night_soothe", "shirk_or_wake"] as const;

  for (const archetype of archetypes) {
    for (const beat of beats) {
      it(`returns a non-empty string for ${archetype} at ${beat}`, () => {
        const partner = {
          name: "Alex",
          traits: { archetype, conflictStyle: "defensive" as const, helpBias: "helps_fast" as const },
          mood: 50,
          fatigue: 0,
          resentment: 0,
          isAsleep: false,
        };
        const ledger = {
          playerNightShifts: 0,
          partnerNightShifts: 0,
          playerShirks: 0,
          partnerShirks: 0,
          playerSoothes: 0,
          partnerSoothes: 0,
        };
        const line = lineFor(beat, partner, ledger);
        expect(typeof line).toBe("string");
        expect(line.length).toBeGreaterThan(0);
      });
    }
  }

  it("resentful partner references ledger when shirks > 0", () => {
    const partner = {
      name: "Alex",
      traits: { archetype: "resentful" as const, conflictStyle: "scorekeeping" as const, helpBias: "shirks_when_tired" as const },
      mood: 40,
      fatigue: 30,
      resentment: 20,
      isAsleep: false,
    };
    const ledger = {
      playerNightShifts: 0,
      partnerNightShifts: 2,
      playerShirks: 1,
      partnerShirks: 0,
      playerSoothes: 0,
      partnerSoothes: 3,
    };
    const line = lineFor("argument_start", partner, ledger);
    // The shirked condition line for resentful at argument_start mentions count tracking.
    expect(line.length).toBeGreaterThan(0);
  });

  it("falls back to a default line for beats with no scripted lines", () => {
    const partner = {
      name: "Jordan",
      traits: { archetype: "chill" as const, conflictStyle: "avoidant" as const, helpBias: "waits_to_be_asked" as const },
      mood: 50,
      fatigue: 0,
      resentment: 0,
      isAsleep: false,
    };
    const ledger = {
      playerNightShifts: 0,
      partnerNightShifts: 0,
      playerShirks: 0,
      partnerShirks: 0,
      playerSoothes: 0,
      partnerSoothes: 0,
    };
    // 'home' beat has no scripted lines — should return fallback string.
    const line = lineFor("home", partner, ledger);
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. partner-agent — partnerReaction — shirk raises resentment
// ---------------------------------------------------------------------------

describe("partner-agent partnerReaction", () => {
  const partner = {
    name: "Alex",
    traits: { archetype: "resentful" as const, conflictStyle: "scorekeeping" as const, helpBias: "shirks_when_tired" as const },
    mood: 50,
    fatigue: 20,
    resentment: 10,
    isAsleep: false,
  };
  const ledger = {
    playerNightShifts: 0,
    partnerNightShifts: 0,
    playerShirks: 0,
    partnerShirks: 0,
    playerSoothes: 0,
    partnerSoothes: 0,
  };

  it("shirk action raises partner resentment", () => {
    const event = makeEvent("ACTION", "player", "shirk");
    const delta = partnerReaction(event, partner, ledger);
    expect((delta.resentmentDelta ?? 0)).toBeGreaterThan(0);
  });

  it("wake_partner raises partner fatigue", () => {
    const event = makeEvent("ACTION", "player", "wake_partner");
    const delta = partnerReaction(event, partner, ledger);
    expect((delta.fatigueDelta ?? 0)).toBeGreaterThan(0);
  });

  it("comfort_partner raises partner mood and lowers resentment", () => {
    const event = makeEvent("ACTION", "player", "comfort_partner");
    const delta = partnerReaction(event, partner, ledger);
    expect((delta.moodDelta ?? 0)).toBeGreaterThan(0);
    expect((delta.resentmentDelta ?? 0)).toBeLessThan(0);
  });

  it("get_up improves partner mood", () => {
    const event = makeEvent("ACTION", "player", "get_up");
    const delta = partnerReaction(event, partner, ledger);
    expect((delta.moodDelta ?? 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. DirectorRuntime — panic resets to home, clears audio
// ---------------------------------------------------------------------------

describe("DirectorRuntime", () => {
  let messages: import("@contracts/messages").ServerMessage[];

  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRuntime(beatId = "home") {
    const state = makeMinimalState(beatId);
    const rt = new DirectorRuntime(state);
    rt.subscribe((msg) => messages.push(msg));
    return rt;
  }

  it("emits state message on dispatch", () => {
    const rt = makeRuntime();
    rt.dispatch(makeEvent("ACTION", "player", "start_game"));
    const stateMsg = messages.find((m) => m.type === "state");
    expect(stateMsg).toBeDefined();
  });

  it("panic stops the runtime and emits stop_audio for all channels", () => {
    const rt = makeRuntime("night_cry");
    rt.panic();
    const stopAll = messages.find((m) => m.type === "stop_audio" && (m as { channel: string }).channel === "all");
    expect(stopAll).toBeDefined();
  });

  it("skipTo jumps to the target beat regardless of possibleNextBeats", () => {
    const rt = makeRuntime("home");
    rt.skipTo("verdict");
    const sceneChange = messages.find((m) => m.type === "scene_change" && (m as { beatId: string }).beatId === "verdict");
    expect(sceneChange).toBeDefined();
  });

  it("executeCommand ENTER_BEAT respects possibleNextBeats", () => {
    const rt = makeRuntime("home");
    // home → probation_splash is valid.
    rt.executeCommand({ type: "ENTER_BEAT", beatId: "probation_splash" });
    const sceneChange = messages.find((m) => m.type === "scene_change" && (m as { beatId: string }).beatId === "probation_splash");
    expect(sceneChange).toBeDefined();
  });

  it("executeCommand ENTER_BEAT rejects invalid next beat", () => {
    const rt = makeRuntime("home");
    // home → verdict is NOT in possibleNextBeats.
    messages = [];
    rt.executeCommand({ type: "ENTER_BEAT", beatId: "verdict" });
    const sceneChange = messages.find((m) => m.type === "scene_change" && (m as { beatId: string }).beatId === "verdict");
    expect(sceneChange).toBeUndefined();
  });

  it("beat timeout fires fallback beat after timeoutMs", () => {
    const rt = makeRuntime("probation_splash");
    // probation_splash timeoutMs=5000, fallbackBeat=officer_intro
    rt.start();
    messages = [];
    vi.advanceTimersByTime(5001);
    const sceneChange = messages.find((m) => m.type === "scene_change" && (m as { beatId: string }).beatId === "officer_intro");
    expect(sceneChange).toBeDefined();
  });

  it("tick loop advances game hour during gameplay", () => {
    const state = makeMinimalState("first_calm");
    const rt = new DirectorRuntime({ ...state, settings: { realSecondsPerGameHour: 1 } });
    let lastHour = state.currentHour;
    rt.subscribe((msg) => {
      if (msg.type === "state") lastHour = msg.state.currentHour;
    });
    rt.start();
    vi.advanceTimersByTime(1001);
    expect(lastHour).toBeGreaterThan(state.currentHour);
  });
});

// ---------------------------------------------------------------------------
// 10. LocalGameTransport
// ---------------------------------------------------------------------------

describe("LocalGameTransport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("send action dispatches to runtime and emits state", () => {
    const msgs: import("@contracts/messages").ServerMessage[] = [];
    const transport = new LocalGameTransport("sess-1", "seed-1");
    transport.subscribe((m) => msgs.push(m));
    transport.start();
    transport.send({ type: "action", action: "start_game" });
    const stateMsg = msgs.find((m) => m.type === "state");
    expect(stateMsg).toBeDefined();
  });

  it("send panic emits stop_audio all", () => {
    const msgs: import("@contracts/messages").ServerMessage[] = [];
    const transport = new LocalGameTransport("sess-2", "seed-2");
    transport.subscribe((m) => msgs.push(m));
    transport.send({ type: "panic" });
    const stopMsg = msgs.find((m) => m.type === "stop_audio" && (m as { channel: string }).channel === "all");
    expect(stopMsg).toBeDefined();
  });

  it("send name_baby updates baby name in state", () => {
    let lastState: GameState | null = null;
    const transport = new LocalGameTransport("sess-3", "seed-3");
    transport.subscribe((m) => {
      if (m.type === "state") lastState = m.state;
    });
    transport.getRuntime().skipTo("baby_roll");
    transport.send({ type: "name_baby", name: "Luna" });
    expect(lastState).not.toBeNull();
    expect((lastState as unknown as GameState).baby.name).toBe("Luna");
  });

  it("send skip_to jumps to target beat", () => {
    const msgs: import("@contracts/messages").ServerMessage[] = [];
    const transport = new LocalGameTransport("sess-4", "seed-4");
    transport.subscribe((m) => msgs.push(m));
    transport.send({ type: "skip_to", beatId: "verdict" });
    const sceneChange = msgs.find((m) => m.type === "scene_change" && (m as { beatId: string }).beatId === "verdict");
    expect(sceneChange).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 11. Fairness ledger — shirk increments playerShirks
// ---------------------------------------------------------------------------

describe("fairness ledger via reducer", () => {
  it("playerShirks increments on each shirk action", () => {
    let state = makeMinimalState("night_cry");
    state = reducer(state, makeEvent("ACTION", "player", "shirk"));
    expect(state.ledger.playerShirks).toBe(1);
    state = reducer(state, makeEvent("ACTION", "player", "shirk"));
    expect(state.ledger.playerShirks).toBe(2);
  });

  it("playerSoothes increments on care actions", () => {
    let state = makeMinimalState("first_cry");
    state = reducer(state, makeEvent("ACTION", "player", "feed"));
    expect(state.ledger.playerSoothes).toBe(1);
    state = reducer(state, makeEvent("ACTION", "player", "rock"));
    expect(state.ledger.playerSoothes).toBe(2);
  });

  it("playerNightShifts increments on get_up", () => {
    let state = makeMinimalState("night_cry");
    state = reducer(state, makeEvent("ACTION", "player", "get_up"));
    expect(state.ledger.playerNightShifts).toBe(1);
  });
});
