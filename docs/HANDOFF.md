# BabySim handoff prompt

> Drop this on a fresh agent and they should be able to pick up the project end-to-end. Last updated: 2026-05-09 12:55 SGT.

## What you're inheriting

A multi-agent improv simulator deployed live on Cloudflare Workers. The core loop is playable end-to-end at:

- **https://babysim.berlayar.ai** (custom domain, prod)
- **https://babysim.erniesg.workers.dev** (workers.dev fallback)
- **`npm run dev:worker`** for full-stack local on port 8787

GitHub: https://github.com/erniesg/babysim — `main` is what's deployed.

The pitch: **"Most generative AI tries to please you. This one cries until you guess what it wants."** Player goes through 120 seconds of bureaucratic-theater newborn care; a cast of LLM agents (officer, partner, baby, GM) calls tools to render every line live; a fairness ledger tracks shifts/soothes/shirks between the player and their AI co-parent and the verdict reads it back at them with names and numbers.

## ✅ Done & deployed (verified working in production)

| Layer | Status | Notes |
|---|---|---|
| **Engine** (deterministic) | ✅ 76/76 tests | `src/engine/` — beat graph, reducer, runtime, seed, transports |
| **Officer agent** (gpt-5.5) | ✅ live | `/api/officer` returns `say` tool calls referencing the ledger by number; per-officer prompt skips self-naming |
| **Officer voice** (ElevenLabs) | ✅ live | `/api/officer/say` streams MP3, muppet plays it with mouth-sync; per-officer voice IDs (Tan/Lim/Wong) |
| **Baby agent** (gpt-5.5) | ✅ live | `/api/baby` returns `play_audio` + `set_caption` tools — fired from `Game.tsx` on gameplay actions, surfaces baby-hint near the visual |
| **GM agent** (gpt-5.5) | ✅ endpoint live, frontend not calling | `/api/gm` returns `DirectorCommand[]` + `rejected[]` (server-side validates against `BEAT_GRAPH[currentBeat].possibleNextBeats`) |
| **Realtime partner** | ✅ live | Gemini Flash Live default, OpenAI Realtime swappable behind `VITE_REALTIME_PARTNER_PROVIDER`; 4 partner tools (`take_night_shift`, `refuse_night_shift`, `concede_argument`, `raise_resentment`) wire back into game actions |
| **Live baby SFX** (ElevenLabs `text_to_sound_v2`) | ✅ live | `/api/baby/sfx?trigger=hunger\|tired\|discomfort\|coo` — 49KB MP3 per request; not yet wired to AudioDirector preference |
| **Live music** (Lyria-002 via Vertex AI) | ✅ live | `/api/music/probation-theme?vibe=intro\|argument\|verdict` — returns 6.3MB WAV; frontend still using pre-baked MP3 |
| **3D officer muppet** | ✅ live | Three.js custom rig (Ernest/Bern/Crumb characters); per-officer voice profiles; ResizeObserver fix for hidden→visible mounts |
| **Photo intake / Sing-mic / Verification / Cute payoff / Gacha debrief** | ✅ live | All UI surfaces shipping |
| **Custom domain** | ✅ active | `babysim.berlayar.ai` via Workers Custom Domain (auto-route) |
| **Pre-baked assets** | ✅ live | Older `gptimage2-fullbody-clean-face-rig-v1` baby PNGs, 4 partner archetype portraits, 3 officer expressions, Lyria 32s theme, 4 baby cry SFX, finger-snap |
| **Per-Worker secrets** | ✅ all set | OPENAI / GEMINI / GOOGLE / ELEVENLABS / ANTHROPIC / GOOGLE_SERVICE_ACCOUNT_JSON |

## 🟡 Wired but not yet browser-tested end-to-end

- **Live baby SFX in gameplay** — endpoint live, frontend `AudioDirector` still uses pre-baked URLs. Wiring is ~10 lines: add a `useLive: boolean` to `play()` so it `fetch`'s `/api/baby/sfx` and `URL.createObjectURL`'s the response when the flag is on.
- **Live music swap** — endpoint returns WAV; need to update `AudioDirector.ASSET_URLS["music.probation_theme"]` to optionally fetch from `/api/music/probation-theme` when `VITE_LIVE_MUSIC=1`.
- **Officer subtitle** — live transcript rendering is committed but only smoke-tested via curl, not visually verified mid-officer-beat.
- **Older baby PNG swap** — md5-verified deployed; needs visual confirmation that the older babyface (vs the upload-derived) is what's rendering.

## ❌ Known broken / blocked

- **Gemini Image quota exhausted** on `gemini-3-pro-image-preview` for the new key — `/api/baby/portrait` and `/api/officer/avatar` both return `429`. **Code is correct**; either wait for quota reset, upgrade billing tier, or rotate to a different Gemini key with quota. Frontend falls through to pre-baked PNGs gracefully.

## 🚧 Next priorities (in suggested order)

| # | Task | Effort | Why |
|---|---|---|---|
| 1 | **Frontend wire `/api/baby/sfx` + `/api/music/probation-theme` into AudioDirector** | ~20 min | Lights up "every cry is freshly synthesized" + "music is regenerated per session" — instant visible dynamic upgrade |
| 2 | **2.5D animated baby puppet rig** ✅ done | Approach: layered-PNG compositing on a single `<canvas>` (Canvas2D `drawImage` in z-order). A `puppet.json` manifest defines an ordered layer set per `BabyVisualState` (face backplate + landmark-aligned eye/mouth overlays). The React component `src/baby-rig/PuppetCanvas.tsx` preloads all 14 PNGs once, then swaps the active layer set per state change with no remount. A `requestAnimationFrame` loop adds an idle vertical bob (`sin(t)*2px`, ~0.16Hz) and an eye-layer-substitution blink every 3-5s. A `setMouthOpen(0..1)` ref method is exposed for future audio-reactive lip-sync. Assets ship at `public/puppets/baby/`. |
| 3 | **GM frontend wiring** | ~30 min | Call `/api/gm` at beat boundaries, dispatch its returned `DirectorCommand[]` through the existing reducer/runtime (which already validates). Makes beat transitions LLM-driven. |
| 4 | **DurableObject multiplayer** (`GameSessionDO`) | ~1-2h | "Join a room" button currently throws an alert. Worker → DO with WebSocket, partner role can be a real second player. |
| 5 | **Veo-3.1 cute payoff video** | ~1h | Endpoint stubbed with initiate/poll pattern; frontend needs the polling loop. CSS fallback already in place. |
| 6 | **Mobile responsive pass** | ~30 min | User flagged it; some breakpoints exist but not exhaustive. Specifically: home panel grid, action bar wrapping, font scaling. |
| 7 | **Session feed component** (scrolling log of all session events) | ~30 min | Skeleton at `src/components/SessionFeed.tsx` (built but not wired). Replace the officer-subtitle box with this; pin partner tab above. |
| 8 | **Cloudflare Agents SDK migration** (when GA) | future | Replace `/api/officer` etc. with proper Agents SDK agents — same `DirectorCommand` schema, runtime composition. |

## How to drive the project

### File layout shortcuts
```
contracts/                      ← Source-of-truth TS types
  beats.ts                      ← BEAT_GRAPH (21 beats, allowedActions, possibleNextBeats, timeoutMs+fallbackBeat)
  director-commands.ts          ← Tool-call schema for ALL agents
  game-state.ts                 ← BabyState/PartnerState/OfficerState/Ledger/RenderState
  messages.ts                   ← ClientMessage / ServerMessage transport types
  actions.ts                    ← Player GameAction enum

src/engine/                     ← Pure-function reducer + runtime + seed
src/realtime/                   ← Gemini Live + OpenAI Realtime adapters (provider-neutral interface)
src/llm/                        ← Browser → Worker LLM clients (officer, baby, voice)
src/muppet/                     ← Three.js Officer Tan + per-officer voice
src/worker/                     ← Cloudflare Worker entry + 10 handlers
  index.ts                      ← Router; hub for adding new /api/* routes
  handlers/
    officer.ts                  ← gpt-5.5 say tool
    officer-tts.ts              ← ElevenLabs MP3 proxy
    officer-avatar.ts           ← Gemini Image (rate-limited today)
    baby.ts                     ← gpt-5.5 play_audio + set_caption
    baby-sfx.ts                 ← ElevenLabs SFX live
    baby-portrait.ts            ← Gemini Image (rate-limited today)
    gm.ts                       ← gpt-5.5 DirectorCommand[] with possibleNextBeats validation
    music.ts                    ← Lyria-002 Vertex AI JWT signing in-Worker
    cute-payoff.ts              ← Veo-3.1 async (initiate POST + poll GET)
    realtime-{gemini,openai}-token.ts

src/components/                 ← React UI primitives
src/Game.tsx                    ← Main orchestrator: bootstrap transport, route render state, dispatch agents

public/                         ← Static assets (served by Worker ASSETS binding)
  audio/baby/, audio/music/, audio/sfx/, img/baby/, img/officer-tan*.png, img/partner-*.png

docs/agents.md                  ← Agent inventory + tool allow-list + wiring matrix + system prompts
docs/06-tool-calling-agents.md  ← Original research deliverable
docs/01..05-*.md                ← Build briefs, beat-loop spec, architecture, acceptance tests
AGENTS.md                       ← Build non-negotiables (mission flipped: dynamic IS the product)
```

### Common operations
```bash
# Run everything locally (Worker + assets + /api/*)
npm run dev:worker              # http://localhost:8787

# Deploy
npm run deploy                  # = npm run build && npx wrangler deploy

# Stream live Worker logs (correlate with browser console UUIDs)
npm run tail

# Generate / regenerate pre-baked assets at build time
npm run gen:baby-sounds         # Gemini 3.1 Flash TTS
npm run gen:officer-avatar      # Gemini 3 Pro Image
npm run gen:partner-avatars
# (no script for music yet — `scripts/generate-music.mjs` exists, can be added to package.json)

# Push a Worker secret
echo "$KEY" | npx wrangler secret put SECRET_NAME

# List current secrets
npx wrangler secret list
```

### Debug pattern in this project
Every Worker request gets a UUID logged on entry, upstream status + body head logged on response. Browser console emits `[Officer]`, `[BabyAgent]`, `[GeminiLive]`, `[OfficerVoice]`, `[Muppet]` lines with the same correlation. Use `npm run tail` to stream Worker logs in production, or `?debug=1` in the URL to see the current beat/phase indicator.

### Provider-swap matrix
- Officer text: `OPENAI_TEXT_MODEL` env var (default `gpt-5.5`); Anthropic `claude-opus-4-7` is a one-line swap (key already present)
- Realtime partner: `VITE_REALTIME_PARTNER_PROVIDER=gemini|openai` (default gemini)
- Officer voice: `VITE_OFFICER_VOICE_PROVIDER=elevenlabs|browser|off` (default elevenlabs)
- Baby SFX: `VITE_LIVE_BABY_SFX=1` to fetch live (not yet wired in `AudioDirector`)
- Music: `VITE_LIVE_MUSIC=1` to fetch live (not yet wired)

## Critical "non-negotiables" the user has emphasized

1. **The dynamic, fully-generated experience IS the product.** Deterministic implementations exist as testing harnesses and graceful-degradation fallbacks — NOT as the canonical path.
2. **Use the named provider.** If the user says "Gemini TTS" don't silently swap to ElevenLabs because it's better. Surface concerns first.
3. **Verify the full model catalog** before claiming a model is missing. Don't `head -25` and conclude.
4. **Cloudflare Workers, not Pages.** Pure Workers with `[assets]` binding. The Pages Function era is over.
5. **The reducer is authoritative regardless of mode.** LLM agents emit `DirectorCommand[]`; the runtime validates against `BEAT_GRAPH` before applying. Direct state mutation forbidden.
6. **Officer must NOT speak its own name** (system prompts already enforce this).
7. **Hide redundant UI on cinematic beats** (HUD hidden during officer/verif/cute/photo/reveal/home/debrief).
8. **Snap-into-music sequencing is choreographed**: line → 850ms pause → snap → 1200ms pause → music → 900ms → advance.

## What you can dispatch in parallel

If you're a fresh agent picking this up:
- One agent on the **2.5D puppet rig port** (longest-tail visual upgrade)
- One agent on **GM frontend wiring** (LLM-driven beat transitions)
- One agent on **AudioDirector live-music + live-SFX swap**
- You on **session feed wiring + mobile responsive pass + DurableObject scaffolding**

These are non-overlapping in files. Specifically: puppet rig touches `src/components/BabyVisual.tsx` + new `src/muppet/PuppetCanvas.tsx`; GM wiring touches `src/Game.tsx` + new `src/llm/gm-agent.ts`; AudioDirector swap touches `src/audio/AudioDirector.ts` only; you on the rest.

Last commit: `dbbfefb` — `feat: 5 live media-generation Worker endpoints`. Latest deploy: version `745bad2e-98d3-49f6-b91b-2a83564f2ba5`.
