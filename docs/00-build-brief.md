# Build Brief

## Goal

Create a complete BabySim demo that can be handed to autonomous agents for implementation. The demo must be playable end to end before live AI services are added.

## Product Shape

BabySim is a short, seeded newborn-care simulator. It tests care labor, communication, shirking, and soothing discovery across a compressed first-day or first-weekend scenario.

The player experiences:

- Bureaucratic probation framing through one of the seeded officers (Ernest / Bern / Crumb) with a static fallback.
- Photo-theater intake and fake generation progress.
- A randomized baby with hidden traits.
- A randomized partner with fatigue, resentment, and conflict behavior.
- Baby state management through hunger, sleepiness, discomfort, connection, health, and mood.
- Care labor tracking through a fairness ledger.
- A night argument if the player shirks or wakes the partner under stress.
- A verdict and gacha-style debrief.

## First Build Target

Build a browser-local demo first:

- Local Director Runtime
- Seeded rolls
- Pure BabyAgent and PartnerAgent logic
- Full beat graph
- Existing/placeholder assets
- AudioDirector with panic
- Event log and ledger

Only after the local loop lands should the Worker + Durable Object transport replace the local transport.

## Definition Of Complete

The demo is complete when a fresh session reaches debrief in 2-3 minutes and remains playable without OpenAI, Gemini, Realtime, generated videos, or mic access.

## Current state (live)

The local loop has shipped. The deployed Worker now wires three live LLM agents (Officer / Baby / Partner) on top of the deterministic engine — the reducer remains authoritative; agent tool calls are consultative. Durable Objects are NOT yet introduced; multiplayer/`GameSessionDO` is still pending. See `docs/HANDOFF.md` for the current state.

