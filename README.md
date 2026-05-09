# BabySim

**Co-parenting rehearsal · Generative AI baby · Fairness ledger · Multi-agent improv.**

> Most generative AI tries to please you. This one cries until you guess what it wants.

The Ministry of Family and Human Development pairs you with a generative-AI newborn. A cast of LLM agents — officer, partner, baby, GM — calls tools in real time to render a 120-second co-parenting rehearsal.

Hidden baby traits. A tired partner. A fairness ledger between parents. A verdict that quotes you back with names and numbers.

| Live | URL |
|---|---|
| Production (custom domain) | https://babysim.berlayar.ai |
| Workers fallback | https://babysim.erniesg.workers.dev |
| Local | http://localhost:8787 |

## The demo loop

| t | beat | what happens |
|---|---|---|
| 0s | home | New game / Join room (room = stub today) |
| 3s | probation splash | "Welcome to Probation" overlay |
| 5s | officer intro (muppet) | gpt-5.5 generates an in-character line referencing your seeded officer (Ernest / Bern / Crumb, each with a distinct voice profile); muppet speaks it via ElevenLabs; pause; finger snap; pause; Lyria probation theme kicks in |
| 12s | photo intake | Webcam capture / file upload / skip; partner photo or system-match |
| 18s | verification + generation | Rock-paper-scissors via continuous MediaPipe `HandLandmarker` (1.5 s majority-vote sampling, landmark overlay) while a progress bar runs |
| 32s | ominous warning | Officer reminds you the ledger is recorded |
| 38s | baby roll + naming + Adopt-or-Generate | Seeded baby (gender, soothing trait, feeding pattern, sleep type, temperament); player names the baby; **Adopt** loads the canonical 2.5D rig at `/puppets/baby/`; **Generate** kicks off live `gpt-image-2` via `/api/baby/portrait`. Partner reacts in character. |
| 45s | first cry → soothe discovery | Player tries `feed`/`rock`/`sing`/`shush`/`hold` — only the action matching the hidden `soothing` trait calms the baby. **Sing** opens a 3.5s mic capture with Web Audio analysis (volume + rhythm) |
| 60s | time jump → night cry | Screen darkens; partner shown asleep |
| 65s | wake / shirk / wake-partner | Choice updates the fairness ledger live |
| 75s | argument scene | Partner avatar enlarges; **realtime voice session** opens (Gemini Flash Live default; OpenAI Realtime swappable); partner can call `take_night_shift` / `refuse_night_shift` / `concede_argument` / `raise_resentment` tools that mutate the game state |
| 85s | get up + soothe | Cry resolves |
| 90s | "She smiled at you" cute moment | CSS payoff animation today; Veo-3.1 video via `/api/cute-payoff/video` (LRO) wired and live |
| 95s | muppet verdict | gpt-5.5 reads your ledger and renders a verdict that quotes specific numbers |
| 105s | gacha debrief card | Player archetype (Night Shifter / Co-Pilot / Strategic Sleeper / Overfunctioner / Mixed Performer); baby traits revealed; replay |

The full beat graph (21 beats, with `timeoutMs` + `fallbackBeat` for every cinematic beat) lives in [`contracts/beats.ts`](contracts/beats.ts).

## Quick start

```bash
npm install

# Full stack locally — Worker + assets + /api/* — at http://localhost:8787
npm run dev:worker

# Vite-only HMR (frontend only, no /api/*) — at http://localhost:5173
npm run dev

# Build + deploy to Cloudflare Workers
npm run deploy

# Stream live Worker logs (correlate with browser console UUIDs)
npm run tail

# Generate baby cry SFX, music, officer/partner avatars
npm run gen:baby-sounds
npm run gen:officer-avatar
npm run gen:partner-avatars
```

Copy `.env.example` to `.env` and fill keys you actually need. The deterministic loop runs end-to-end with no AI keys.

## Architecture

```
                                   ┌────────────────────────────────────┐
                                   │     Cloudflare Worker (V8)         │
                                   │   src/worker/index.ts              │
   ┌─────────────────┐             │                                    │
   │  Browser SPA    │             │   Static-asset binding (ASSETS)    │
   │  Vite + React   │ <─── GET /  │     serves dist/ as the SPA        │
   │  Three.js       │             │                                    │
   │                 │             │   /api/healthz                     │
   │  Engine:        │ <─── /api ─>│   /api/officer    → gpt-5.5 (7 tools) │
   │   reducer       │             │   /api/baby      → gpt-5.5 (7 tools) │
   │   runtime       │             │   /api/gm        → gpt-5.5         │
   │   beat graph    │             │   /api/partner/line → gemini-3.1-flash-lite │
   │                 │             │   /api/officer/say  → ElevenLabs   │
   │  Muppet (3D)    │             │   /api/baby/sfx     → ElevenLabs   │
   │  PuppetCanvas   │             │   /api/baby/portrait → Replicate gpt-image-2 │
   │  AudioDirector  │             │   /api/officer/avatar → Replicate gpt-image-2 │
   │  RealtimePartner│             │   /api/music/probation-theme → Lyria-002 │
   │  DebugOverlay   │             │   /api/cute-payoff/video → Veo-3.1 (LRO) │
   │                 │             │   /api/cinematic       → Replicate / fal │
   │                 │             │   /api/realtime/{gemini,openai}/token │
   └─────────────────┘             └────┬───────────┬──────────┬────────┘
        │                               │           │          │
        │ WebSocket / WebRTC            │           │          │
        │  (mic + audio streaming;      │           │          │
        │   arguments only)             │           │          │
        ▼                               ▼           ▼          ▼
  ┌──────────────┐                ┌─────────┐  ┌────────┐ ┌──────────┐
  │ Gemini Flash │                │ OpenAI  │  │ Gemini │ │ElevenLabs│
  │ Live (3.1)   │                │ gpt-5.5 │  │  Flash │ │   TTS    │
  │  realtime    │                │ + tools │  │  Lite  │ │ + SFX    │
  └──────────────┘                └─────────┘  └────────┘ └──────────┘
```

Three layers, strict separation:
- **Director Runtime** (`src/engine/runtime.ts`) — deterministic, authoritative. Owns beat transitions, timers, fallbacks, reducer validation. Always works without any LLM.
- **Agents** (Officer / Baby / Partner / GM) — model-augmented decision makers. Emit `DirectorCommand[]` (i.e., tool calls). Cannot mutate state directly; the reducer rejects invalid commands.
- **Presenters** (Muppet / AudioDirector / BabyVisual / PartnerLine) — pure rendering. Receive validated commands.

The `DirectorCommand` schema (`contracts/director-commands.ts`) IS a tool-call schema. An LLM agent and a deterministic agent share the same output shape — swap one for the other behind a feature flag.

## Tech stack

| Layer | Stack |
|---|---|
| Edge | Cloudflare Workers (V8 isolates, Static Assets binding); no Durable Object yet |
| Frontend | Vite + React 18 + TypeScript 5 (no Next.js) |
| 3D officer | Three.js custom muppet rig (expression, gesture, mouth-sync, badge logo cycle) |
| 2.5D baby | Layered-PNG `PuppetCanvas` rig at `public/puppets/baby/` (1 canonical rig + 14 layer PNGs); vignette + cross-fade + per-state idle motion |
| Audio | Web Audio API (mic capture + analysis + queue); ElevenLabs TTS for officer voice; `SpeechSynthesis` fallback |
| Officer agent | OpenAI `gpt-5.5` (chat completions tool calling; 7 tools); per-character voice profiles (Ernest / Bern / Crumb) |
| Baby agent | OpenAI `gpt-5.5` (7 consultative tools + `trigger_fallback`); reducer clamps deltas via `dispatchAgentEvent` |
| Partner per-beat text | Gemini `gemini-3.1-flash-lite` with `say_line` function-calling |
| Realtime partner mic (arguments only) | Gemini Flash Live Preview (default); OpenAI `gpt-realtime` swap via `VITE_REALTIME_PARTNER_PROVIDER=openai` |
| Music | Lyria-002 via Vertex AI (default ON); pre-baked `public/audio/music/probation-theme.mp3` fallback |
| Cry pack | Real recordings from the donateacry public dataset, 4 categories (`hunger`, `tired`, `discomfort`, `coo`); ElevenLabs `text_to_sound_v2` is the live alternative |
| Officer + baby portraits | Replicate `openai/gpt-image-2`; fal.ai `flux-pro` selectable for the baby path |
| Cinematic | Replicate `seedance` / `veo` and fal `kling-v3-pro` (cute_payoff uses Veo-3.1 LRO; pass `provider: "veo"` for any baby cinematic) |
| State / RNG | mulberry32 seeded from a string; same seed always produces the same baby/partner/officer roll |
| Testing | vitest (152 engine tests, all green) |

## Agents

Three live LLM agents share the stage today, all swappable via env flags:

| Agent | Where | Default model | Tool surface |
|---|---|---|---|
| Officer | `/api/officer` | OpenAI `gpt-5.5` | `say`, `set_expression`, `play_gesture`, `warn_player`, `start_challenge`, `advance_phase`, `request_player_input` |
| Baby | `/api/baby` | OpenAI `gpt-5.5` | `play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action` (+ `trigger_fallback`) |
| Partner per-beat text | `/api/partner/line` | Gemini `gemini-3.1-flash-lite` | `say_line` |
| Partner realtime mic (arguments only) | browser → Gemini Live | `gemini-3.1-flash-live-preview` | `take_night_shift`, `refuse_night_shift`, `concede_argument`, `raise_resentment` |
| GM (Director) | `/api/gm` | OpenAI `gpt-5.5` | full `DirectorCommand[]`; `enter_beat` server-side validated against `BEAT_GRAPH` |

Officer voice defaults to ElevenLabs TTS via `/api/officer/say` (browser `SpeechSynthesis` is the fallback). The reducer remains authoritative — agent tool calls are CONSULTATIVE and dispatched through `dispatchAgentEvent`. The handlers are minimal hand-rolled implementations; the published Cloudflare Agents SDK package and Durable Objects are not yet in use.

Per-agent tool allow-list, system prompts, wiring map: see [`docs/agents.md`](docs/agents.md). Current state + gotchas: see [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Repo layout

```
babysim/
├─ contracts/                 TypeScript types — source of truth
│  ├─ beats.ts                21-beat graph with allowedActions + timeouts + fallbacks
│  ├─ game-state.ts           BabyState, PartnerState, ledger, traits, render projection
│  ├─ actions.ts              Player actions (start_game, feed, sing, shirk, …)
│  ├─ director-commands.ts    Agent → runtime tool-call schema
│  └─ messages.ts             ClientMessage / ServerMessage transport types
├─ src/
│  ├─ engine/                 Pure-function reducer + Director Runtime + transports
│  │   └─ __tests__/          76 vitest tests
│  ├─ realtime/               Gemini Live + OpenAI Realtime adapters behind one interface
│  ├─ llm/                    Officer agent (browser → Worker)
│  ├─ muppet/                 Three.js officer puppet rig (Ernest/Bern/Crumb characters)
│  ├─ audio/                  AudioDirector — channel-keyed playback, music + SFX one-shots
│  ├─ components/             BabyVisual, NeedsPanel, LedgerPanel, ActionBar, DebriefCard,
│  │                           PhotoIntake, SingMicCapture, VerificationGames,
│  │                           CutePayoff, PartnerLine, RealtimePartner
│  └─ worker/                 Pure Cloudflare Workers handlers
│      ├─ index.ts            /api/* router + assets fall-through
│      └─ handlers/           officer.ts, realtime-gemini-token.ts, realtime-openai-token.ts
├─ public/
│  ├─ audio/baby/             4 cry clips (hunger, tired, discomfort, coo)
│  ├─ audio/sfx/snap.mp3
│  ├─ audio/music/probation-theme.mp3
│  └─ img/                    officer-tan{,-strict,-warm}.png · partner-{anxious,chill,resentful,overfunctioner}.png
├─ scripts/                   Idempotent generation pipelines
├─ docs/
│  ├─ 00-build-brief.md  01-demo-loop.md  02-architecture.md
│  ├─ 03-models-and-services.md  04-parallel-worktrees.md
│  ├─ 05-acceptance-tests.md  06-tool-calling-agents.md
│  └─ agents.md               Inventory + tool allow-list + wiring status
├─ AGENTS.md                  Build non-negotiables (NOT the inventory)
├─ wrangler.toml              Worker config + assets binding + vars
└─ vite.config.ts
```

## Development workflow

- **TDD-first for the engine**: `npx vitest run` runs 152 tests covering seed reproducibility, reducer validation, baby tick math, cry-trigger selection, action effectiveness across all soothing archetypes, partner reactions, runtime beat transitions, ledger accumulation, and panic recovery.
- **Two dev modes**: `npm run dev` (Vite-only, fast HMR, no `/api/*`) for frontend iteration; `npm run dev:worker` (full stack at port 8787) when touching Worker handlers.
- **Live debug**: every Worker request gets a UUID logged on entry + on every upstream fetch (status + body head). Browser console `[GeminiLive]`, `[Muppet]` lines correlate with Worker `[officer <uuid>]`. `npm run tail` streams the production Worker.
- **Debug overlay**: append `?debug=1` to the URL to see the current beat / phase indicator and live agent tool calls (officer / baby) plus RPS sampling state.

## Deploy

```bash
# One-liner
npm run deploy

# Manual
npm run build
npx wrangler deploy

# Push secrets (per-Worker, not in wrangler.toml)
echo "$KEY" | npx wrangler secret put OPENAI_API_KEY
echo "$KEY" | npx wrangler secret put GEMINI_API_KEY
echo "$KEY" | npx wrangler secret put ELEVENLABS_API_KEY
```

Custom domain `babysim.berlayar.ai` is registered as a Workers Custom Domain — Cloudflare auto-routes the hostname to the Worker via a special "Worker" DNS record (no manual CNAME needed once attached).

## Baby puppet rig

The animated baby is a 2.5D layered-PNG puppet composited on a single `<canvas>`. `public/puppets/baby/puppet.json` declares one ordered layer set per `BabyVisualState` — typically a clean face backplate plus landmark-aligned eye + mouth overlays. `src/baby-rig/PuppetCanvas.tsx` preloads every PNG once, then on each state change calls `ctx.drawImage` for the new layer set in z-order without remounting. A `requestAnimationFrame` loop drives an idle vertical bob (~0.16 Hz) and an eye-layer blink every 3–5 s. A `setMouthOpen(open: number)` ref method is exposed for future audio-reactive lip-sync. The component degrades gracefully: if `puppet.json` 404s, `BabyVisual` falls through to `<video>` state-transition clips, then to the static PNG.

## Build philosophy

1. **The fully dynamic game is the product.** Every officer line, baby reaction, partner argument, asset, and beat decision is intended to come from a generative provider — gpt-5.5 / Gemini Flash Live / OpenAI Realtime / ElevenLabs / Lyria / Veo. The deterministic implementations exist as testing harnesses and graceful-degradation fallbacks when a model is slow, rate-limited, or unreachable.
2. **Every component is independently swappable** between deterministic and probabilistic via a uniform interface. Officer voice (browser TTS / ElevenLabs / Gemini Live native), baby SFX (bundled / ElevenLabs SFX / Gemini TTS), partner (scripted lines / Gemini Flash Live / OpenAI Realtime), GM (switch statement / gpt-5.5 emitting `DirectorCommand[]`), debrief (template / gpt-5.5). Each is one env flag away.
3. **Reducer is authoritative regardless of mode.** Whether an agent is a `switch` statement or gpt-5.5, both emit the same `DirectorCommand[]` shape and the reducer validates. Direct state mutation is forbidden in either mode. This is what makes (1) and (2) trivially safe.
4. **Generation is on the critical path,** not decoration. Music, cries, avatars, videos: pre-generated when demo timing demands it (Lyria probation theme at boot, baby cries at build time, partner avatars per archetype), generated live when latency allows (officer line per beat, partner voice per turn).
5. **The beat graph is the contract for both modes.** Whether the GM is deterministic or LLM-driven, beats are added to `contracts/beats.ts` with explicit `allowedActions`, `timeoutMs`, and `fallbackBeat`. The runtime rejects out-of-graph transitions even if a model proposes them.

See [`AGENTS.md`](AGENTS.md) for the full non-negotiables list.

## Roadmap

- [x] **Officer voice via ElevenLabs** — `/api/officer/say` plays the returned audio through the muppet
- [x] **Verification rock-paper-scissors** — webcam hand-tracking via MediaPipe `HandLandmarker` with landmark overlay + 1.5 s majority-vote sampling
- [x] **Baby agent** — gpt-5.5 with 7 consultative tools (`play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`) + `trigger_fallback`; deltas clamped via reducer's `dispatchAgentEvent`
- [x] **GM agent** — gpt-5.5 emits `DirectorCommand[]` per beat; server-side `BEAT_GRAPH` validation
- [x] **Partner per-beat text agent** — Gemini Flash Lite at `/api/partner/line` (`say_line`); behind `VITE_PARTNER_LIVE_TEXT=1`
- [x] **Veo-3.1 cute payoff video** — `/api/cute-payoff/video` (initiate + poll LRO)
- [x] **Replicate `gpt-image-2` baby + officer portraits** — `/api/baby/portrait`, `/api/officer/avatar`
- [x] **Adopt-or-Generate at baby_roll** — pick canonical rig OR live `gpt-image-2`
- [ ] **Adopt rig pool > 1** — clone `/puppets/baby/` into trait-themed sibling dirs and append to the chooser
- [ ] **Generate path → full 14-layer rig** — port the landmark + segmentation pipeline server-side; today Generate yields a flat portrait
- [ ] **Multiplayer via Durable Object** — `GameSessionDO` holds shared state; partner becomes a real second player. "Join a Room" is a stub today
- [ ] **Pre-recorded muppet verdict MP3** — TTS at game start, played at verdict
- [ ] **Cloudflare Agents SDK migration** — replace the hand-rolled handlers when there's a reason to

## Credits

Built as a hackathon multi-agent improv simulator on Cloudflare Workers, with gpt-5.5, Gemini Flash Live, OpenAI Realtime, ElevenLabs, Lyria-002, Seedance 2.0, Veo-3.1-fast, and Replicate's `openai/gpt-image-2`.
