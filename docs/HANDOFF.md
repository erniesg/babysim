# BabySim handoff (verified 2026-05-09)

**Live:** https://babysim.berlayar.ai · **Repo:** local at `/Users/erniesg/code/erniesg/babysim/`
`main` deploys via `npm run deploy` → Cloudflare Workers (`wrangler deploy`). Tail with `npm run tail`.
Source tests: 84 (`src/engine/__tests__/engine.test.ts` + `src/realtime/openai-realtime.test.ts`); `npx tsc --noEmit` clean.
Latest deploy: see `npx wrangler deployments list`.

> **Note on stale `.js` artifacts.** Compiled `.js` files still sit beside TypeScript sources, but `vitest.config.ts` now excludes `.js` tests and Vite/Vitest resolver order prefers `.ts` / `.tsx` before `.js`, so `npx vitest run` reports the source suite only.

## Goal

A 2-minute multi-agent improv simulator on Cloudflare Workers. Three LLM-driven characters share the stage:

- **Officer** (`gpt-5.5`) — Three.js muppet, ElevenLabs voice. **7 tools**: `say`, `set_expression`, `play_gesture`, `warn_player`, `start_challenge`, `advance_phase`, `request_player_input`. Drives the cinematic intake.
- **Baby** (`gpt-5.5`) — 2.5D layered PuppetCanvas, real recorded baby cries from the donateacry public dataset (hunger / tired / discomfort / coo). **8 tools**: `play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`, `trigger_fallback`. Reducer-modulated reactions via the rolled `soothing` trait (`SOOTHING_AFFINITY` table).
- **Partner** (`gemini-3.1-flash-lite` for text via `/api/partner/line`, OpenAI `gpt-realtime` by default for argument-beat realtime mic) — scripted-line floor + live-text override per beat. Gemini Flash Live is still selectable once Vertex Live API auth/tokens is enabled.
- **GM** (`gpt-5.5`) — `/api/gm` emits validated `DirectorCommand[]`; browser caller runs once per beat entry and dispatches through `DirectorRuntime.executeCommand()`.

Engine reducer (`src/engine/reducer.ts`) is authoritative. Agent tool calls are CONSULTATIVE — the runtime applies them through validated events, not direct mutation. `BEAT_GRAPH` (`contracts/beats.ts`) gates beat transitions.

## What's now live (deployed + verified)

### Components shipped this round
- **TimeProgressBar** (`src/components/TimeProgressBar.tsx`) — 24h day clock in HUD, sun/moon, hour ticks, dawn-dusk gradient.
- **LogoStrip** (`src/components/LogoStrip.tsx`) — looping marquee under MFH header. SVGs in `public/img/logos/` (OpenAI, Codex, Cloudflare, Google, Gemini, ElevenLabs).
- **OfficerWarning** (`src/components/OfficerWarning.tsx`) — banner that pops on threshold crossings (shirks ≥ 2, baby health < 55, discomfort > 80, connection < 30). Voiced via muppet ElevenLabs path.
- **MicLevelMeter** (`src/components/MicLevelMeter.tsx`) — `AnalyserNode` frequency-bar viz inside `RealtimePartner`.
- **AdoptOrGenerate** (`src/components/AdoptOrGenerate.tsx`) — chooser at `baby_roll`: pick from rig pool (currently 1 ward at `/puppets/baby/`) OR live `gpt-image-2` via `/api/baby/portrait`.
- **ActionBar** rebuild — per-action cooldowns (1.2-2.5 s), press-flash animation, icons, optional `actionPoints` budget for night/argument beats.

### Engine + flow fixes
- **Game-stuck bug fixed**: `first_cry` had no transition + no timeout → never advanced. Added soothing-action transitions in `src/engine/runtime.ts:171-181` (`SOOTHE` map) + 12 s safety timeout via `contracts/beats.ts:108`. Verdict + DebriefCard now reachable.
- **Beat timeouts trimmed** (current values in `contracts/beats.ts`): probation_splash 2.2s, baby_arrival 4.5s, first_calm 5s, first_cry 12s, discovery_soothing 14s, time_jump_evening 6s, night_cry 9s, shirk_or_wake 8s, argument_start 12s (`timeoutMs: 12000` line 176), argument_resolution 12s, night_soothe 12s, cute_payoff 6s, verdict 10s.
- **Officer intro split**: short identification line (`OFFICER_INTRO_LINE1`) → 250 ms hold → wave + snap → 650 ms → music → 450 ms → second line (`OFFICER_INTRO_LINE2`) → scene_ack. Both lines voiced via ElevenLabs if enabled.
- **Trait-modulated baby reducer**: `SOOTHING_AFFINITY` table (`src/engine/reducer.ts`) multiplies action effects by rolled `soothing` style (motion / sound / contact / silence). Discovered traits accumulate in `baby.discoveredTraits` for the debrief.
- **Partner scripted lines** extended to all gameplay beats (`baby_arrival`, `first_calm`, `first_cry`, `discovery_soothing`, `time_jump_evening`, `night_cry`, `cute_payoff`, `verdict`) × 4 archetypes — see `src/engine/partner-agent.ts`.
- **Baby sounds** swapped from ElevenLabs `text_to_sound_v2` to recordings from the **donateacry** public dataset (categories: hungry / tired / discomfort / burping → mapped to `babyAudio.{hunger,tired,discomfort,coo}` in `src/audio/AudioDirector.ts:4-12`). Old ElevenLabs versions kept in `public/audio/baby/_archive/`.

### Agent tool surfaces
- `src/worker/handlers/officer.ts` exposes 7 tools to gpt-5.5; `src/llm/officer-agent.ts` returns parsed `tools[]`; `src/Game.tsx` dispatches each.
- `src/worker/handlers/baby.ts` exposes **8 tools**; runtime has `dispatchAgentEvent` (`src/engine/runtime.ts`) for `AGENT_VISUAL_STATE` / `AGENT_NEED_DELTA` events; consultative deltas validated + clamped by reducer.
- `src/worker/handlers/partner-line.ts` hits `gemini-3.1-flash-lite` per beat; client at `src/llm/partner-agent.ts`. Behind `VITE_PARTNER_LIVE_TEXT=1` flag.
- `src/worker/handlers/gm.ts` exposes **7 DirectorCommand tools**; client at `src/llm/gm-agent.ts`. `src/Game.tsx` calls it once per beat entry when `VITE_ENABLE_GM_AGENT` is not `0`/`false`, and maps tools through `DirectorRuntime.executeCommand()` so `ENTER_BEAT` remains graph-gated.
- `src/realtime/openai-realtime.ts` is the default argument provider. It registers the four partner tools via `session.update`, parses `response.function_call_arguments.done` plus `response.output_item.done`, acknowledges tool outputs, and routes tool effects through reducer-owned `agent_partner_tool` messages.
- **Per-beat baby agent trigger wired** at `src/Game.tsx:643-663` — `BEAT_ENTERED` fires one throttled `callBabyAgent()` per gameplay beat, dispatches resulting tools through `dispatchBabyTool`. (Was listed pending in prior handoff; closed.)
- **Music prefetch wired** at `src/Game.tsx:270` and `src/Game.tsx:405` — `audioRef.current?.prefetch("music.probation_theme")` fires before officer_intro snap so Lyria has head-start. (Was listed pending in prior handoff; closed.)

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
# Live URL responds (verified 2026-05-09)
curl -sI https://babysim.berlayar.ai/                          # 200
curl -sI https://babysim.berlayar.ai/puppets/baby/puppet.json  # 200
# All 6 logos serve
for L in openai codex cloudflare google gemini elevenlabs; do
  curl -s -o /dev/null -w "%{http_code} $L\n" \
    https://babysim.berlayar.ai/img/logos/$L.svg
done
# Worker endpoints reachable (400 = body validation)
curl -sX POST https://babysim.berlayar.ai/api/officer    # 400 (expects JSON)
curl -sX POST https://babysim.berlayar.ai/api/baby       # 400 (expects JSON)
```

## NEW headline priority — wire babysteps photo-state iteration cycle into the adopted rig

> **Source assets:** `/Users/erniesg/code/erniesg/babysteps-ai-baby-simulator/artifacts/ai-baby-simulator/visual-validation/restored-active-sealed-v1/{01-settled,02-drowsy,03-hungry,04-fussy,05-crying,06-sleep}.png`
> **Iteration parameters from babysteps viewer:** `holdMs: 900`, `crossfadeMs: 320`, six states matching `BabyVisualState` exactly.

**Why this matters.** Today the adopted rig at `/puppets/baby/` is a single 14-layer composited rig that crossfades expressions per state. The babysteps `restored-active-sealed-v1` set is a parallel option: six full-frame photoreal stills, one per state, designed to be cycled on the same state graph. The baby agent's tools (`set_visual_state`, `set_need_delta`, `play_audio`) should drive both visual transitions AND audio intensity in lockstep — so when the player or partner acts, the reducer's need/mood delta flows out to (a) the right per-state photo crossfade and (b) the right cry MP3 at the right channel volume.

**Plan (in order):**

1. **Drop assets into the repo.** Copy the six PNGs to `public/puppets/baby-photoreal-v1/states/{settled,drowsy,hungry,fussy,crying,sleep}.png`. Author `public/puppets/baby-photoreal-v1/puppet.json` with `layout: "full-frame-photo-states"`, one layer per state, expressions = `{ layers: ["state-photo"], tears: state === "crying" }`. PuppetCanvas's manifest model already accepts arbitrary `layout` strings — add a branch in the renderer for `full-frame-photo-states` that skips the layered eye/mouth compositing and just crossfades the single state plate.
2. **Add the rig to `ADOPT_RIG_POOL`** (`src/components/AdoptOrGenerate.tsx:26-33`) as a second entry pointing at `/puppets/baby-photoreal-v1/`. Now the pool has two rigs and the random pick at line 40 is meaningful.
3. **Tighten PuppetCanvas crossfade** from `TRANSITION_MS = 400` (`src/baby-rig/PuppetCanvas.tsx:108`) to **320** to match the babysteps reference. Hold per state is reducer-driven (engine ticks at game-hour pace), so 900 ms isn't a constant — but verify auto-transitions don't fire faster than ~900 ms between visualState changes via a debounce in the agent-event dispatch path (`src/engine/runtime.ts` `dispatchAgentEvent`).
4. **Reducer: derive visualState from needs.** Today `set_visual_state` is consultative-only. Add a `deriveVisualState(needs, activeCry, isAsleep)` helper in `src/engine/reducer.ts` that maps:
   - `isAsleep` → `"sleep"`
   - `activeCry` → `"crying"`
   - `discomfort > 70 || (hunger > 60 && energy > 30)` → `"fussy"`
   - `hunger > 70` → `"hungry"`
   - `sleepiness > 70 && hunger < 60` → `"drowsy"`
   - default → `"settled"`
   Apply on every `tick` and every `action_applied` event. Agent's `set_visual_state` becomes a 1.5 s override window (stored on state) that decays back to derived. Reducer stays authoritative.
5. **Audio: per-state baby-channel volume.** Extend `AudioDirector.handle` to accept a new `set_channel_intensity` server message OR add an `intensity` field to `play_audio`. Map state → baby-channel target volume:
   ```
   settled  0.00   drowsy   0.10   hungry   0.40
   fussy    0.55   crying   0.85   sleep    0.00
   ```
   Layer in the 0.6 default `CHANNEL_VOLUME.baby` as a global ceiling. Fade-to over 240 ms (existing `fadeTo` helper at `src/audio/AudioDirector.ts:69-82`).
6. **Pick the right cry MP3 from `activeCry.trigger`.** `cryTrigger` already maps `hunger | sleepiness | discomfort | lonely | health | overstimulated`; collapse into the four available samples: `hunger → babyAudio.hunger`, `sleepiness → babyAudio.tired`, `discomfort | overstimulated → babyAudio.discomfort`, `lonely | health → babyAudio.coo`. Wire this in the runtime's cry-onset path so the baby agent doesn't need to pick.
7. **Action response loop.** Verify end-to-end: player taps `feed` → reducer applies `hunger -= 30` → `deriveVisualState` returns `"settled"` (was `"crying"` ) → PuppetCanvas crossfades `crying → settled` over 320 ms → AudioDirector fades baby channel 0.85 → 0.00 over 240 ms → `acknowledge_action` from the baby agent confirms. Same path for partner soothe.
8. **Acceptance test.** Add a unit test in `src/engine/__tests__/engine.test.ts` that walks: needs at `{hunger: 80}` → expect `visualState === "hungry"`; apply `feed` action → `visualState` settles to `"settled"` within one tick; `crying → settled` triggers cry-channel fadeout. Keep total tests at ≤ ~85.

**Non-goals (this slice).** Don't replace the 14-layer canonical rig — keep it as the second pool entry. Don't port the `puppet-layer-plan.mjs` pipeline (separate work item). Don't change the `BabyVisualState` union — it already matches.

**Files expected to change:** `public/puppets/baby-photoreal-v1/**` (new), `src/components/AdoptOrGenerate.tsx` (pool entry), `src/baby-rig/PuppetCanvas.tsx` (layout branch + 320 ms transition), `src/engine/reducer.ts` (`deriveVisualState`), `src/engine/runtime.ts` (cry-trigger → assetId mapping, debounce visualState dispatch), `src/audio/AudioDirector.ts` (intensity), `contracts/messages.ts` (`set_channel_intensity` message if path 5a), `src/engine/__tests__/engine.test.ts` (test).

## Other open gaps (revised)

1. **Adopt rig pool size = 1.** Closed when the photo-state rig above is added.
2. **Generate path doesn't yet run a full rig pipeline.** `/api/baby/portrait` returns a flat `gpt-image-2` portrait; promoting that to a 14-layer 2.5D rig requires porting `babysteps-ai-baby-simulator/tools/ai-baby-simulator/lib/puppet-layer-plan.mjs` into a Worker handler. Until then, fallback to the canonical rig and overlay the live portrait on top.
3. **Photo intake face count + partner-photo branch.** `PhotoIntake` accepts 1-or-2-face with `countHint` but doesn't branch the flow.
4. **DurableObject multiplayer.** "Join a Room" still alerts (`src/Game.tsx:1117`); no `GameSessionDO` + WebSocket.
5. **Stale compiled `.js` in `src/`** (60 files alongside the `.tsx` sources). Mitigated locally by `vitest.config.ts` excluding `.js` tests and both Vite/Vitest preferring `.ts` / `.tsx` before `.js`. Cleanup still worth doing later: delete generated artifacts and add a repo rule to prevent them coming back.
6. **Gemini realtime model name in handoff doc was wrong.** Code uses `gemini-3.1-flash-live` (`src/worker/handlers/realtime-gemini-token.ts:40`). Prior doc said `-preview`. Fixed here.

## Provider swap matrix

| Surface | Env | Default | Alt |
|---|---|---|---|
| Officer text | `OPENAI_TEXT_MODEL` | `gpt-5.5` | any chat model |
| Officer voice | `VITE_OFFICER_VOICE_PROVIDER` | `elevenlabs` | `browser` / `off` |
| GM director | `VITE_ENABLE_GM_AGENT` | on | `0`/`false` to force deterministic runtime only |
| Realtime partner | `VITE_REALTIME_PARTNER_PROVIDER` | `openai` | `gemini` once Vertex Live API auth/tokens is enabled |
| Realtime partner model (gemini) | `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live` | any Live-API-capable Gemini |
| Live partner text | `VITE_PARTNER_LIVE_TEXT` | off | `1` to enable |
| Live baby SFX | `VITE_LIVE_BABY_SFX` | off | `1` (ElevenLabs `text_to_sound_v2`) |
| Live music | `VITE_LIVE_MUSIC` | on | `0`/`false` to force fallback (Lyria-002 via Vertex; needs `GOOGLE_SERVICE_ACCOUNT_JSON` Worker secret) |
| Cinematic | per-request `body.provider` | `seedance` | `veo` |

## Gotchas

1. **Prompt cache TTL is 5 min.** Multi-step LLM tool flows should reuse the same model+system prompt to stay cached.
2. **Replicate `gpt-image-2` cold-start = 60-90 s.** Image-gen handlers use `Prefer: wait=60` + 5×5 s polls. Worker subrequest wall-clock is unbounded.
3. **Bytedance Seedance moderation E005** rejects photoreal-newborn frames. Always pass `provider: "veo"` for any baby cinematic.
4. **`/api/baby` body shape:** `{ beatId, baby:{...}, recentEvents:[] }`. `recentEvents` required (empty array OK).
5. **Reducer is authoritative.** Agent `set_visual_state` / `set_need_delta` go through `dispatchAgentEvent` which clamps via the reducer. No direct state mutation. The new `deriveVisualState` (priority work above) keeps this property — agent overrides decay back to derived.
6. **Don't reintroduce external project name references** in commits/docs/code per `AGENTS.md`.
7. **React StrictMode is on.** In dev, useEffects run twice — `lastSpokenBeatRef` guards officer say. Prod doesn't double-fire.
8. **The 2.5D rig at `/puppets/baby/` IS the canonical gpt-image-2 baby.** Its 14 layers were derived from one source PNG via the babysteps landmark+segmentation pipeline. The babysteps `restored-active-sealed-v1` photo-state set (priority work above) is a different, simpler rig — six full-frame photoreal plates rather than landmark-aligned layers. Both can coexist in `ADOPT_RIG_POOL`.

## Common ops

```bash
npm run dev:worker                                       # local full stack on :8787
npm run deploy                                           # build + wrangler deploy
npm run tail                                             # stream Worker logs
npx vitest run                                           # 84 source tests
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

## File map (most relevant for the priority work)

```
src/components/
├── ActionBar.tsx              ← cooldowns, action-points, icons, press-flash
├── AdoptOrGenerate.tsx        ← chooser at baby_roll (extend ADOPT_RIG_POOL here)
├── LogoStrip.tsx              ← marquee under MFH header
├── MicLevelMeter.tsx          ← AnalyserNode bars for RealtimePartner
├── OfficerWarning.tsx         ← threshold-banner for gameplay
├── TimeProgressBar.tsx        ← 24h day clock
├── BabyVisual.{tsx,css}       ← framing fix (1024/1280 aspect, metadata bottom-pinned)
├── verify/RockPaperScissors.{tsx,css}  ← rebuilt with continuous MediaPipe + landmark overlay
src/baby-rig/PuppetCanvas.tsx  ← layout branch + tighten TRANSITION_MS to 320 (priority work)
src/audio/AudioDirector.ts     ← prefetch(); per-channel intensity (priority work)
src/engine/
├── reducer.ts                 ← SOOTHING_AFFINITY trait-modulated effects;
│                                deriveVisualState() (priority work)
├── runtime.ts                 ← first_cry transitions (line 192), dispatchAgentEvent;
│                                cry-trigger → assetId map (priority work)
├── partner-agent.ts           ← scripted lines for all beats × 4 archetypes
src/llm/
├── officer-agent.ts           ← llmOfficerBeat() returns parsed tools[]
├── baby-agent.ts              ← extended tool dispatch
├── partner-agent.ts           ← callPartnerAgent() per beat
src/muppet/muppet-engine.ts    ← double-voice fix (stop activeRemoteAudio before new say)
src/worker/handlers/
├── officer.ts                 ← 7-tool schema
├── baby.ts                    ← 8-tool schema
├── partner-line.ts            ← Gemini Flash partner-line handler
contracts/beats.ts             ← trimmed timeouts, first_cry safety net (line 108)
contracts/messages.ts          ← agent_set_visual_state, agent_set_need_delta (extend with set_channel_intensity if needed)
public/audio/baby/             ← donateacry public-dataset MP3s (hunger/tired/discomfort/coo); _archive/ has prior versions
public/img/logos/              ← openai/codex/cloudflare/google/gemini/elevenlabs SVGs
public/puppets/baby/           ← canonical rig (gpt-image-2 + 14 landmark-aligned layers)
public/puppets/baby-photoreal-v1/  ← NEW — six per-state plates from babysteps restored-active-sealed-v1 (priority work)
```

## Pickup prompt for next agent

> Continue work on https://babysim.berlayar.ai/. Repo: `/Users/erniesg/code/erniesg/babysim/`. Read `docs/HANDOFF.md` first — it lists what's deployed, what's not built, and the gotchas. The current validation branch wires the GM browser caller, routes realtime partner tools through reducer-owned ledger/state updates, defaults the argument mic to OpenAI Realtime, and keeps Gemini Live documented as blocked until Vertex Live API auth/tokens works. Keep `npx tsc --noEmit` and `npx vitest run` green before deploy.
