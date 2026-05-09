# BabySim Autonomous Build Instructions

## Mission

Build BabySim, a seeded, beat-driven newborn-care and co-parenting simulator. The first shippable target is a 2-3 minute hackathon demo that works without live AI calls, generated videos, mic access, or remote services.

## Non-Negotiables

- Build the static/local playable loop first.
- Do not depend on live AI calls for the demo.
- Do not copy binary assets unless explicitly asked.
- Use Cloudflare Worker + Durable Object for runtime state, not Convex.
- Use `LocalGameTransport` first, then `WebSocketGameTransport`.
- Keep all model names env-configured.
- Keep every model-backed feature behind a deterministic fallback.
- Preserve the beat graph contract.
- Do not let the GM/LLM mutate state directly.
- Keep the reducer authoritative.

## Build Order

1. Define contracts, asset manifest, and beat graph.
2. Implement seeded roll generation for baby, partner, and officer.
3. Implement local Director Runtime with pure BabyAgent and PartnerAgent functions.
4. Build the full local demo loop with placeholder/static assets.
5. Add AudioDirector, panic behavior, event log, and fairness ledger.
6. Only after the local loop works, add Worker + Durable Object transport.
7. Add model-backed features one at a time with fallbacks.

## Existing Asset References

Do not copy these until explicitly requested.

- Baby PNG source: `../internal-pipeline/artifacts/ai-baby-simulator/2p5d-puppet/upload-derived-photoreal-avatar-rig-latest/previews/`
- Baby audio source: `../internal-pipeline/artifacts/ai-baby-simulator/live-same-baby-pack-20260509/`
- Muppet prototype: `../internal-rig/prototype/muppet-onboarding.*`

## Runtime Safety

The app must remain demoable if:

- OpenAI is unavailable.
- Gemini is unavailable.
- Realtime voice fails.
- Mic permission is blocked.
- Generated video assets are missing.
- Durable Objects are not running in local development.

Fallbacks are part of the product, not optional cleanup.

