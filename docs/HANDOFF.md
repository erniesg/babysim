# BabySim handoff (post agent-tools refactor)

**Live:** https://babysim.berlayar.ai · **Repo:** local at `/Users/erniesg/code/erniesg/babysim/`
`main` deploys via `npm run deploy` → Cloudflare Workers (`wrangler deploy`). Tail with `npm run tail`.
Latest deploy: `e584fa6c-3de0-49de-bfed-4cf8973c0840`. 152/152 engine tests pass; `tsc --noEmit` clean.

## Goal

A 2-minute multi-agent improv simulator on Cloudflare Workers. Three LLM-driven characters share the stage:

- **Officer** (`gpt-5.5`) — Three.js muppet, ElevenLabs voice. Tools: `say`, `set_expression`, `play_gesture`, `warn_player`, `start_challenge`, `advance_phase`, `request_player_input`. Drives the cinematic intake.
- **Baby** (`gpt-5.5`) — 2.5D layered PuppetCanvas, real recorded baby cries from the donateacry public dataset (hunger / tired / discomfort / burp). Tools (8): `play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`, `trigger_fallback`. Reducer-modulated reactions via the rolled `soothing` trait (`SOOTHING_AFFINITY` table).
- **Partner** (`gemini-3.1-flash-lite` for text, `gemini-3.1-flash-live-preview` for argument-beat realtime mic) — scripted-line floor + live-text override per beat. Realtime mic during arguments only.

Engine reducer (`src/engine/reducer.ts`) is authoritative. Agent tool calls are CONSULTATIVE — the runtime applies them through validated events, not direct mutation. `BEAT_GRAPH` (`contracts/beats.ts`) gates beat transitions.

## What's now live (deployed + curl-verified)

### Components shipped this round
- **TimeProgressBar** (`src/components/TimeProgressBar.tsx`) — 24h day clock in HUD, sun/moon, hour ticks, dawn-dusk gradient.
- **LogoStrip** (`src/components/LogoStrip.tsx`) — looping marquee under MFH header. SVGs in `public/img/logos/` (OpenAI, Codex, Cloudflare, Google, Gemini, ElevenLabs).
- **OfficerWarning** (`src/components/OfficerWarning.tsx`) — banner that pops on threshold crossings (shirks ≥ 2, baby health < 55, discomfort > 80, connection < 30). Voiced via muppet ElevenLabs path.
- **MicLevelMeter** (`src/components/MicLevelMeter.tsx`) — `AnalyserNode` frequency-bar viz inside `RealtimePartner`.
- **AdoptOrGenerate** (`src/components/AdoptOrGenerate.tsx`) — chooser at baby_roll: pick from rig pool (currently 1 ward at `/puppets/baby/`) OR live `gpt-image-2` via `/api/baby/portrait`.
- **ActionBar** rebuild — per-action cooldowns (1.2-2.5 s), press-flash animation, icons, optional `actionPoints` budget for night/argument beats.

### Engine + flow fixes
- **Game-stuck bug fixed**: `first_cry` had no transition + no timeout → never advanced. Added soothing-action transitions to `discovery_soothing` + 12 s safety timeout. Verdict + DebriefCard now reachable.
- **Beat timeouts trimmed** to fit the ~100 s arc: splash 5s→2.2s, baby_arrival 8s→4.5s, first_calm 8s→5s, discovery_soothing 25s→14s, night_cry 15s→9s, shirk_or_wake 12s→8s, argument_resolution 20s→12s, night_soothe 25s→12s.
- **Officer intro split**: short identification line (`OFFICER_INTRO_LINE1`) → 250 ms hold → wave + snap → 650 ms → music → 450 ms → second line (`OFFICER_INTRO_LINE2`) → scene_ack. Both lines voiced via ElevenLabs if enabled.
- **Trait-modulated baby reducer**: `SOOTHING_AFFINITY` table multiplies action effects by rolled `soothing` style (motion / sound / contact / silence). Discovered traits accumulate in `baby.discoveredTraits` for the debrief.
- **Partner scripted lines** extended to all gameplay beats (baby_arrival, first_calm, first_cry, discovery_soothing, time_jump_evening, night_cry, cute_payoff, verdict) × 4 archetypes.
- **Baby sounds** swapped from ElevenLabs `text_to_sound_v2` to recordings from the **donateacry** public dataset (categories: hungry / tired / discomfort / burping → mapped to `babyAudio.{hunger,tired,discomfort,coo}`). Real recorded baby cries — much more authentic than text-to-sound. Old ElevenLabs + intermediate same-baby-pack versions kept in `public/audio/baby/_archive/`.

### Agent tool surfaces (this round's headline)
- `src/worker/handlers/officer.ts` exposes 7 tools to gpt-5.5; `src/llm/officer-agent.ts` returns parsed `tools[]`; `src/Game.tsx` dispatches each.
- `src/worker/handlers/baby.ts` exposes 7 tools; runtime has `dispatchAgentEvent` for `AGENT_VISUAL_STATE` / `AGENT_NEED_DELTA` events; consultative deltas validated + clamped by reducer.
- `src/worker/handlers/partner-line.ts` (NEW) hits `gemini-3.1-flash-lite` per beat; client at `src/llm/partner-agent.ts`. Behind `VITE_PARTNER_LIVE_TEXT=1` flag.

### RPS rebuilt with proper MediaPipe
- `src/components/verify/RockPaperScissors.tsx` runs continuous `HandLandmarker` detection (1 hand, GPU delegate).
- Landmarks rendered as connected lines + joint dots on a canvas overlay above the mirrored 320×240 webcam feed.
- Live "I see: ✌️ scissors" readout updates every frame.
- Sampling phase aggregates 1.5 s of frames → majority vote → no random fallback unless mediapipe truly sees nothing.

### RealtimePartner mic indicator
- Pulsing red dot + "LISTENING…" pill while mic is hot.
- Live freq-bar meter (24 bars, gold→red on peak) tied to the mic stream.

## Verified deploy state

```bash
# Live URL responds
curl -sI https://babysim.berlayar.ai/                          # 200
curl -sI https://babysim.berlayar.ai/puppets/baby/puppet.json  # 200
# All 6 logos serve
for L in openai codex cloudflare google gemini elevenlabs; do
  curl -s -o /dev/null -w "%{http_code} $L\n" \
    https://babysim.berlayar.ai/img/logos/$L.svg
done
# CSS classes verified in deployed bundle
curl -s /assets/index-<hash>.css | grep -oE \
  '\.(time-bar|logo-strip|officer-warning|mic-level-meter|mic-indicator|action-btn-cooldown|rps-overlay|rps-live-readout|baby-stage)' | sort -u
# Worker endpoints reachable (400 = body validation)
curl -sX POST https://babysim.berlayar.ai/api/officer    # 400 (expects JSON)
curl -sX POST https://babysim.berlayar.ai/api/baby       # 400 (expects JSON)
```

## What's NOT yet built / untested

1. **Adopt rig pool size = 1.** `ADOPT_RIG_POOL` in `AdoptOrGenerate.tsx` only has the canonical `/puppets/baby/`. To grow: drop sibling dirs `/puppets/baby-002/...` with own `puppet.json` + 14 layer PNGs, append to the array.
2. **Generate path doesn't yet run a full rig pipeline.** Today the Generate option just calls `/api/baby/portrait` for a flat gpt-image-2 portrait. Going from that to a 14-layer 2.5D rig requires the babysteps landmark+segmentation pipeline (`/Users/erniesg/code/erniesg/babysteps-ai-baby-simulator/tools/ai-baby-simulator/lib/puppet-layer-plan.mjs`) ported into a Worker handler. Until then, fallback to the canonical rig and overlay the live portrait on top.
3. **Dynamic music prefetch wiring.** `AudioDirector.prefetch()` exists but isn't called from `Game.tsx` yet. Need to fire `audioRef.current.prefetch("music.probation_theme")` at officer_intro start so Lyria has 5-30 s head-start before snap. Set `VITE_LIVE_MUSIC=1` to enable.
4. **Photo intake face count + partner-photo branch.** Today `PhotoIntake` accepts 1-or-2-face with `countHint` but doesn't branch the flow. Stream K work.
5. **DurableObject multiplayer.** "Join a Room" still alerts; no `GameSessionDO` + WebSocket.
6. **Baby agent BEAT_ENTERED triggers.** The new tool surface includes throttled per-beat invocations, but the dispatch needs the per-beat call site in `Game.tsx` (not just per-action — that's already wired).

## Provider swap matrix

| Surface | Env | Default | Alt |
|---|---|---|---|
| Officer text | `OPENAI_TEXT_MODEL` | `gpt-5.5` | any chat model |
| Officer voice | `VITE_OFFICER_VOICE_PROVIDER` | `elevenlabs` | `browser` / `off` |
| Realtime partner | `VITE_REALTIME_PARTNER_PROVIDER` | `gemini` | `openai` |
| Live partner text | `VITE_PARTNER_LIVE_TEXT` | off | `1` to enable |
| Live baby SFX | `VITE_LIVE_BABY_SFX` | off | `1` (ElevenLabs `text_to_sound_v2`) |
| Live music | `VITE_LIVE_MUSIC` | off | `1` (Lyria-002 via Vertex; needs `GOOGLE_SERVICE_ACCOUNT_JSON` Worker secret) |
| Cinematic | per-request `body.provider` | `seedance` | `veo` |

## Gotchas

1. **Prompt cache TTL is 5 min.** Multi-step LLM tool flows should reuse the same model+system prompt to stay cached.
2. **Replicate `gpt-image-2` cold-start = 60-90 s.** Image-gen handlers use `Prefer: wait=60` + 5×5 s polls. Worker subrequest wall-clock is unbounded.
3. **Bytedance Seedance moderation E005** rejects photoreal-newborn frames. Always pass `provider: "veo"` for any baby cinematic.
4. **`/api/baby` body shape:** `{ beatId, baby:{...}, recentEvents:[] }`. `recentEvents` required (empty array OK).
5. **Reducer is authoritative.** Agent `set_visual_state` / `set_need_delta` go through `dispatchAgentEvent` which clamps via the reducer. No direct state mutation.
6. **Don't reintroduce external project name references** in commits/docs/code per `AGENTS.md`.
7. **React StrictMode is on.** In dev, useEffects run twice — `lastSpokenBeatRef` guards officer say. Prod doesn't double-fire.
8. **The 2.5D rig at `/puppets/baby/` IS the canonical gpt-image-2 baby.** Its 14 layers were derived from one source PNG via the babysteps landmark+segmentation pipeline. Adopt = pick from rig pool. Generate = new portrait → port the pipeline server-side.

## Common ops

```bash
npm run dev:worker                                       # local full stack on :8787
npm run deploy                                           # build + wrangler deploy
npm run tail                                             # stream Worker logs
npx vitest run                                           # 152 engine tests, all green
npx tsc --noEmit                                         # typecheck
echo "$KEY" | npx wrangler secret put SECRET_NAME

# Test the officer + baby + partner agent endpoints directly
curl -sX POST https://babysim.berlayar.ai/api/officer \
  -H 'content-type: application/json' \
  -d '{"beatId":"officer_intro","officerName":"Officer Bern","ledger":{...}}'

curl -sX POST https://babysim.berlayar.ai/api/baby \
  -H 'content-type: application/json' \
  -d '{"beatId":"first_cry","baby":{"traits":{"soothing":"motion"}, ...},"recentEvents":[]}'

curl -sX POST https://babysim.berlayar.ai/api/partner/line \
  -H 'content-type: application/json' \
  -d '{"beatId":"first_cry","partner":{...},"ledger":{...},"baby":{...},"recentEvents":[]}'
```

## File map (this round's changes only)

```
src/components/
├── ActionBar.tsx        ← cooldowns, action-points, icons, press-flash
├── AdoptOrGenerate.tsx  ← NEW chooser at baby_roll
├── LogoStrip.tsx        ← NEW marquee under MFH header
├── MicLevelMeter.tsx    ← NEW AnalyserNode bars for RealtimePartner
├── OfficerWarning.tsx   ← NEW threshold-banner for gameplay
├── TimeProgressBar.tsx  ← NEW 24h day clock
├── BabyVisual.{tsx,css} ← framing fix (1024/1280 aspect, metadata bottom-pinned)
├── verify/RockPaperScissors.{tsx,css} ← rebuilt with continuous MediaPipe + landmark overlay
src/baby-rig/PuppetCanvas.tsx
                         ← vignette, cross-fade, per-state idle motion, blink, mouth-sync
src/audio/AudioDirector.ts
                         ← prefetch() method
src/engine/
├── reducer.ts           ← SOOTHING_AFFINITY trait-modulated effects, discoveredTraits
├── runtime.ts           ← first_cry transitions, dispatchAgentEvent
├── partner-agent.ts     ← scripted lines for all beats × 4 archetypes
src/llm/
├── officer-agent.ts     ← llmOfficerBeat() returns parsed tools[]
├── baby-agent.ts        ← extended tool dispatch
├── partner-agent.ts     ← NEW callPartnerAgent() per beat
src/muppet/muppet-engine.ts
                         ← double-voice fix (stop activeRemoteAudio before new say)
src/worker/handlers/
├── officer.ts           ← 7-tool schema
├── baby.ts              ← 7-tool schema
├── partner-line.ts      ← NEW Gemini Flash partner-line handler
contracts/beats.ts       ← trimmed timeouts, first_cry safety net
public/audio/baby/       ← donateacry public-dataset MP3s (hunger/tired/discomfort/coo); _archive/ has prior versions
public/img/logos/        ← NEW openai/codex/cloudflare/google/gemini/elevenlabs SVGs
public/puppets/baby/     ← canonical rig (gpt-image-2 + 14 landmark-aligned layers)
```

## Pickup prompt for next agent

> Continue work on https://babysim.berlayar.ai/. Repo: `/Users/erniesg/code/erniesg/babysim/`. Read `docs/HANDOFF.md` first — it lists what's deployed, what's not built, and the gotchas. Then start on the highest-impact pending item: the **adopt rig pool** (clone `/puppets/baby/` into 4 sibling dirs with traits-themed variants), the **dynamic music prefetch wiring** (call `audioRef.current.prefetch("music.probation_theme")` at the officer_intro entry useEffect in `src/Game.tsx`), and the **Generate path rig pipeline** (port `babysteps-ai-baby-simulator/tools/ai-baby-simulator/lib/puppet-layer-plan.mjs` into a Worker handler). Engine tests must stay green (`npx vitest run` → 152 passing). Don't reintroduce external project name references. Deploy with `npm run deploy` and verify the live URL with the curl block in this doc.
