# Parallel Worktrees

## Main First

Land these in the main repo before splitting worktrees:

1. Contracts
2. Asset manifest
3. Seeded roll generator
4. Local Director Runtime
5. BabyAgent and PartnerAgent as pure functions
6. Full local demo loop
7. AudioDirector and panic behavior
8. Event log and fairness ledger

This gives every parallel task a working integration target.

## Worktrees After Main Loop

| Worktree | Scope | Constraint | Status |
| --- | --- | --- | --- |
| `codex/do-session-adapter` | Worker, `GameSessionDO`, WebSocket transport, `/api/session`. | Must preserve local transport behavior. | Pending (no DO wired) |
| `codex/voice-analysis` | Mic permission, volume/rhythm/pitch-ish features, `voice_input`. | Must keep button fallback. | Shipped (`SingMicCapture`, RPS via MediaPipe `HandLandmarker`) |
| `codex/partner-agent` | Partner archetypes, scripted line variants, Realtime fallback path. | No beat graph rewrites. | Shipped (`/api/partner/line` Gemini Flash Lite + scripted fallback) |
| `codex/muppet-scene` | Integrate Officer muppet rig and patch mic cleanup. | Static officer fallback remains. | Shipped (Three.js muppet, ElevenLabs voice path, badge logo cycle) |
| `codex/baby-2p5d-runtime` | Replace preview PNG swaps with the 2.5D puppet runtime. | Preview PNG fallback remains. | Shipped (`src/baby-rig/PuppetCanvas.tsx`, 14-layer rig, vignette + cross-fade) |
| `codex/debrief-card` | Dynamic gacha card from event log; GPT optional. | Template fallback required. | Shipped template path; GPT live-debrief still optional |
| `codex/director-agent` | LLM GM emits validated `DirectorCommand`s. | Cannot mutate state directly. | Shipped (`/api/gm`, server-side `BEAT_GRAPH` validation) |

## Do Not Parallelize Early

Keep these in the main running loop until they feel good:

- Beat pacing
- Cry and argument timing
- Audio handoffs
- Baby reaction tuning
- Shirking consequences
- Officer tone
- Demo pitch/script

These are taste and integration work, not isolated engineering tasks.

