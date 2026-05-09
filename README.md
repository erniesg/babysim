# BabySim

BabySim is a seeded, beat-driven newborn-care and co-parenting simulator. It turns a short first-days-with-baby scenario into a playable stress rehearsal: caring for a randomized baby, negotiating night duties, tracking shirking, and receiving a verdict/debrief at the end.

The current build target is a 2-3 minute hackathon demo.

## Core Gameplay

The first complete loop is:

1. BabySim intro
2. Start New Game or Join Room
3. "Welcome to Probation" splash
4. Officer intro and photo-theater intake
5. Generation progress with verification checks
6. Baby reveal and naming
7. First calm state
8. First cry
9. Soothing discovery through feed, rock, sing, shush, hold, wait
10. Time jump into night
11. Night cry with get-up, shirk, and wake-partner choices
12. Partner argument
13. Night soothe
14. Cute payoff
15. Officer verdict
16. Gacha-style debrief card

## Build Philosophy

The first playable loop should run with local deterministic logic and placeholder assets. It should not require live AI calls. Model-backed features are enhancements that must fall back to the local loop.

## Infrastructure

- Runtime state: Cloudflare Worker + Durable Object
- Local-first development: `LocalGameTransport`
- Remote transport: `WebSocketGameTransport`
- No Convex for the hackathon demo

## Assets

No binary assets are committed in this planning repo yet. Placeholder manifests point to the intended in-app asset paths, while source references document where existing generated Baby Steps artifacts currently live.

