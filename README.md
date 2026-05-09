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
| 0s | home | New game / Join room |
| 3s | probation splash | "Welcome to Probation" overlay |
| 5s | officer intro (muppet) | gpt-5.5 generates an in-character line referencing your seeded officer; muppet speaks it; pause; finger snap; pause; Lyria probation theme kicks in |
| 12s | photo intake | Webcam capture / file upload / skip; partner photo or system-match |
| 18s | verification + generation | Bureaucratic intake questions (planned: rock-paper-scissors via hand-tracking, "parenting requires fast reflexes") while a progress bar fakes "compositing puppet rig / synthesizing cry pack / generating partner profile" |
| 32s | ominous warning | Officer reminds you the ledger is recorded |
| 38s | baby roll + naming | Seeded baby (gender, soothing trait, feeding pattern, sleep type, temperament); player names the baby; partner reacts in character |
| 45s | first cry → soothe discovery | Player tries `feed`/`rock`/`sing`/`shush`/`hold` — only the action matching the hidden `soothing` trait calms the baby. **Sing** opens a 3.5s mic capture with Web Audio analysis (volume + rhythm) |
| 60s | time jump → night cry | Screen darkens; partner shown asleep |
| 65s | wake / shirk / wake-partner | Choice updates the fairness ledger live |
| 75s | argument scene | Partner avatar enlarges; **realtime voice session** opens (Gemini Flash Live default; OpenAI Realtime swappable); partner can call `take_night_shift` / `refuse_night_shift` / `concede_argument` / `raise_resentment` tools that mutate the game state |
| 85s | get up + soothe | Cry resolves |
| 90s | "She smiled at you" cute moment | 3.4s CSS payoff animation today; Veo-3.1 video planned |
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
                                   ┌──────────────────────────────────┐
                                   │     Cloudflare Worker (V8)       │
                                   │   src/worker/index.ts            │
   ┌─────────────────┐             │                                  │
   │  Browser SPA    │             │   Static-asset binding (ASSETS)  │
   │  Vite + React   │ <─── GET /  │     serves dist/ as the SPA      │
   │  Three.js       │             │                                  │
   │                 │             │   /api/healthz                   │
   │  Engine:        │ <─── /api ─>│   /api/officer    → gpt-5.5      │
   │   reducer       │             │   /api/officer/say → ElevenLabs  │
   │   runtime       │             │   /api/realtime/gemini/token     │
   │   beat graph    │             │   /api/realtime/openai/token     │
   │                 │             │                                  │
   │  Muppet (3D)    │             │   Secrets: OPENAI / GEMINI /     │
   │  AudioDirector  │             │            GOOGLE / ELEVENLABS / │
   │  RealtimePartner│             │            ANTHROPIC             │
   └─────────────────┘             └────┬───────────┬──────────┬──────┘
        │                               │           │          │
        │ WebSocket / WebRTC            │           │          │
        │  (mic + audio streaming)      │           │          │
        ▼                               ▼           ▼          ▼
  ┌──────────────┐                ┌─────────┐  ┌────────┐ ┌──────────┐
  │ Gemini Flash │                │ OpenAI  │  │ Gemini │ │ElevenLabs│
  │ Live (3.1)   │                │ gpt-5.5 │  │  Live  │ │   TTS    │
  │  realtime    │                │ + tools │  │  3.1   │ │ + SFX    │
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
| Edge | Cloudflare Workers (V8 isolates, Static Assets binding) |
| Frontend | Vite 5 + React 18 + TypeScript 5 (no Next.js) |
| 3D officer | Three.js (custom muppet rig: expression, gesture, mouth-sync) |
| Audio | Web Audio API (mic capture + analysis + queue), SpeechSynthesis (per-officer voice profile) |
| Officer agent | OpenAI gpt-5.5 (function calling); ElevenLabs TTS as voice tool |
| Realtime partner | Gemini 3.1 Flash Live Preview (default); OpenAI gpt-realtime (swap) |
| Music | Lyria-002 (pre-generated 32s probation theme) |
| Cry pack | Gemini 3.1 Flash TTS (Charon / Puck / Kore voices speaking onomatopoeia); ElevenLabs `text_to_sound_v2` as fallback |
| Officer + partner avatars | Gemini 3 Pro Image (1024×1024, cinematic 1970s state-drama style) |
| State / RNG | mulberry32 seeded from a string; same seed always produces the same baby/partner/officer roll |
| Testing | vitest (76 engine tests, all green) |

## Agents

Three modes, all swappable behind one interface:

| Mode | Officer voice | Officer text | Partner voice |
|---|---|---|---|
| **A: Gemini Flash** | Gemini Flash Live native audio | Gemini Flash Live | Gemini Flash Live |
| **B: OpenAI Realtime** | gpt-realtime native audio | gpt-realtime | gpt-realtime |
| **C: gpt-5.5 + tools** *(default today)* | ElevenLabs TTS via tool call | gpt-5.5 with `say()` + `elevenlabs_tts()` tools | Gemini Flash Live (or OpenAI Realtime) |

Mode C is the default because it gives the most flexibility — the same gpt-5.5 agent can also call SFX generation, music generation, image-asset generation tools without swapping providers. The realtime modes are visible-on-stage features for the partner argument scene.

Per-agent tool allow-list, system prompts, wiring map: see [`docs/agents.md`](docs/agents.md).

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

- **TDD-first for the engine**: `npm test` runs 76 tests covering seed reproducibility, reducer validation, baby tick math, cry-trigger selection, action effectiveness across all soothing archetypes, partner reactions, runtime beat transitions, ledger accumulation, and panic recovery.
- **Two dev modes**: `npm run dev` (Vite-only, fast HMR, no `/api/*`) for frontend iteration; `npm run dev:worker` (full stack at port 8787) when touching Worker handlers.
- **Live debug**: every Worker request gets a UUID logged on entry + on every upstream fetch (status + body head). Browser console `[GeminiLive]`, `[Muppet]` lines correlate with Worker `[officer <uuid>]`. `npm run tail` streams the production Worker.
- **Debug overlay**: append `?debug=1` to the URL to see the current beat/phase indicator.

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

- [ ] **Officer voice via ElevenLabs tool call** — gpt-5.5 emits `elevenlabs_tts(text, voice_id)` alongside `say(text, expression, gesture)`; muppet plays the returned audio URL
- [ ] **Verification rock-paper-scissors** — webcam hand-tracking via MediaPipe Tasks Vision, in-character "parenting requires fast reflexes" framing, GM-orchestrated gate
- [ ] **Baby agent** — gpt-5.5 with `play_audio` (baby channel only) + `set_caption` for trait-discovery hints
- [ ] **GM agent** — gpt-5.5 emits `DirectorCommand[]` per beat; reducer validates against `BEAT_GRAPH`
- [ ] **Multiplayer via Durable Object** — `GameSessionDO` holds shared state; partner can be a real second player
- [ ] **Veo-3.1 cute payoff video** — pre-gen pipeline already exists for music + images
- [ ] **Pre-recorded muppet verdict MP3** — Gemini Flash voice TTS at game start, played at verdict
- [ ] **Cloudflare Agents SDK migration** — when GA, replace the `/api/officer` Worker handler with an Agents SDK agent

## Credits

Built as a hackathon multi-agent improv simulator on Cloudflare Workers, with gpt-5.5, Gemini Flash Live, OpenAI Realtime, ElevenLabs, Lyria-002, Seedance 2.0, Veo-3.1-fast, and Replicate's `openai/gpt-image-2`.
