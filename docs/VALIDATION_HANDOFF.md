# BabySim demo validation pass — fix what's claimed but not working

**Repo:** `/Users/erniesg/code/erniesg/babysim/`
**Live:** https://babysim.berlayar.ai
**Branch:** `main` · `npm run deploy` ships
**Stack:** Vite + React + TypeScript frontend, Cloudflare Workers backend (no Agents SDK)
**Latest version ID at handoff:** `806256be-a7fa-43fd-9d87-db8d019863ef`

## Context — what we're demoing

A 2-minute multi-agent improv simulator. The pitch (read once, hold it):

> The Ministry of Family and Human Development pairs you with an AI newborn whose traits are hidden: soothing archetype, feeding pattern, temperament. You don't chat with it. You read the cry, try feed / rock / sing / shush / hold, and learn what works. A tired AI partner shares the room with their own hidden state — fatigue, resentment, willingness to take the night shift. At 3am you argue out loud; they can take the shift or push back mid-sentence. Then the muppet judges you.
>
> Four LLM agents call tools live. Officer (gpt-5.5, ElevenLabs voice) drives the scene. Baby (gpt-5.5) picks mood and need deltas. Partner runs Gemini Flash Lite for lines and a realtime voice agent during the argument that can call `take_night_shift / refuse_night_shift / concede_argument / raise_resentment` mid-sentence. A GM emits validated `DirectorCommand[]` across a 21-beat graph. Every tool call goes through one reducer that clamps deltas and rejects out-of-graph beats. Same tool-call shape, swap any agent between scripted and live via env flag. Hand-rolled on Cloudflare Workers.

## Verified vs. broken (state at handoff)

| Claim | Status | Evidence / file |
|---|---|---|
| Hidden baby traits (5 dims) | OK | `src/engine/seed.ts` rolls `BABY_SOOTHING / FEEDING / TEMPERAMENT / SLEEP / STIMULATION`; `SOOTHING_AFFINITY` in `src/engine/reducer.ts` modulates effects per soothing style |
| Read-the-cry gameplay | OK | 9 actions in `BEAT_GRAPH.allowedActions`; baby cycles photo + cry MP3 + intensity per visualState |
| Partner hidden state | OK | `PartnerState` rolled per game (archetype × conflictStyle × helpBias = ~48 combos); accumulates fatigue/resentment via reducer |
| Officer = gpt-5.5 + ElevenLabs voice | OK | `src/worker/handlers/officer.ts` uses `OPENAI_TEXT_MODEL=gpt-5.5`; `officer-tts.ts` maps Ernest/Bern/Crumb to Liam/George/Daniel ElevenLabs voice IDs |
| Baby = gpt-5.5, picks mood + need deltas | OK | `handlers/baby.ts` (gpt-5.5), 8 tools incl. `set_mood_delta` / `set_need_delta` / `set_visual_state` |
| Partner text per beat = Gemini Flash Lite | OK | `handlers/partner-line.ts` calls `gemini-3.1-flash-lite`; default-on; chat-history threading shipped |
| Partner argument = realtime voice w/ tools | PARTIAL | OpenAI Realtime fully wired (`src/realtime/openai-realtime.ts` — system prompt + 4 tools + per-archetype voice + server_vad). Gemini Flash Live broken (auth/tokens 404 — see soft spot 2 below). |
| GM emits validated DirectorCommand[] | NOT WIRED | `/api/gm` exists with 7 tools but nothing on the client calls it (see soft spot 1) |
| 21-beat graph | OK | Counted 21 ids in `contracts/beats.ts` |
| Mid-sentence tool calls mutate state | UNVERIFIED | Code path is right; not smoke-tested live (see soft spot 3) |
| Reducer clamps + rejects out-of-graph | OK | `reducer.ts` clamps via `clamp()`; rejects unknown actions per beat at line ~84 |
| Per-agent scripted/live env swap | OK | `VITE_ENABLE_OFFICER_AGENT`, `VITE_ENABLE_BABY_AGENT`, `VITE_PARTNER_LIVE_TEXT`, `VITE_REALTIME_PARTNER_PROVIDER`. All have scripted fallbacks. |
| Cloudflare Workers, no SDK | OK | Plain `fetch` handlers in `src/worker/handlers/` |
| 2.5D rig | OK | `PuppetCanvas` + `public/puppets/baby-photoreal-v1/` (clean transparent plates from babysteps crib-cycle-v1) |

## Three soft spots — your job is to close or restate the pitch

### 1. GM agent claim is currently false

`/api/gm` exists in `src/worker/handlers/gm.ts` with 7 tools (`enter_beat`, `set_caption`, `play_audio`, `stop_audio`, `ask_agent`, `advance_time`, `trigger_fallback`). The 21-beat graph is driven entirely by `src/engine/runtime.ts` + the reducer; **no client-side caller** invokes the GM agent.

Verify: `rg "callGmAgent|/api/gm" src/ --type tsx --type ts` returns 0 hits in `src/` (only the route table in `src/worker/index.ts`).

Path A — preferred, makes the pitch literally true: wire a per-beat `callGmAgent(beatId, state)` call from `src/Game.tsx` (similar shape to `callBabyAgent` at line ~643), throttled once per beat-entry. Dispatch its tool calls through the runtime so the GM can `set_caption` / `play_audio` / `advance_time`. Don't let it call `enter_beat` directly — route through the same beat-transition gate the reducer enforces.

Path B — cheaper, restate the pitch line: *"a GM tool surface is wired; the deterministic runtime currently fills that role and the reducer rejects out-of-graph mutations from any agent."*

### 2. Gemini Flash Live doesn't work in this environment

Verified live with curl:

```
curl -sX POST https://babysim.berlayar.ai/api/realtime/gemini/token
# -> {"source":"master_key_fallback","warning":"auth/tokens returned 404",...}
```

Root cause: the `GEMINI_API_KEY` is from AI Studio; the v1alpha `auth/tokens` endpoint requires Vertex AI / Cloud project enablement. The fallback hands the master key to `wss://...BidiGenerateContent?key=...`, which Google rejects with code 1000 close pre-`setupComplete`. **No code fix until the GCP project gets Live API enabled.**

Code today (`src/realtime/factory.ts`) defaults to OpenAI Realtime. The OpenAI path was rebuilt in commit `680ed10` to be fully featured — `session.update` with archetype-aware system prompt, per-archetype voice (`shimmer`/`ash`/`ballad`/`verse`), 4 function tools matching Gemini's, `server_vad` turn detection. The Gemini token handler already sends `liveConnectConstraints` so it'll work the moment auth/tokens stops 404'ing.

Decision: rewrite the pitch line to *"OpenAI Realtime by default; Gemini Flash Live ready when Vertex Live API is enabled"* OR enable the GCP API out-of-band. The HUD has an OpenAI ⇄ Gemini pill (top-right) for runtime A/B once both work.

### 3. OpenAI Realtime tool dispatch is unverified end-to-end

The code path: WebRTC connects → `session.update` sends tools → user speaks → OpenAI emits `response.function_call_arguments.done` → `dc.onmessage` parses → `emit({ type: "tool_call", ... })` → `RealtimePartner.onToolCall` → `Game.tsx` dispatches through engine reducer. Smoke-test it.

How:
- Start a new game with `?debug=1` to see beat IDs
- Ride to `argument_start` (you can speed via panic flow if needed)
- Confirm phase reaches `live` in the RealtimePartner pill
- Speak: "Just take the night shift, you owe me one"
- Expected: voice reply, transcript renders, `state.ledger.partnerNightShifts` increments if they concede
- Open devtools console; watch for `[OpenAIRealtime] tool call` log lines
- Also test the **text fallback** input — should always work even if mic blocked

If tool calls don't fire, check `dc.onmessage` event types coming from OpenAI; their event names occasionally drift between API versions. Current handler listens for: `response.audio_transcript.delta`, `response.text.delta`, `response.audio_transcript.done`, `response.text.done`, `response.function_call_arguments.done`, `error`.

## Acceptance checks (run all before deploying)

```bash
cd /Users/erniesg/code/erniesg/babysim/

# Build sanity
npx tsc --noEmit         # must be clean
npx vitest run           # 79 tests, must pass

# Live API smoke tests against current prod
BASE=https://babysim.berlayar.ai
curl -sI $BASE/                                                # 200
curl -sX POST $BASE/api/realtime/openai/token | jq             # client_secret + model
curl -sX POST $BASE/api/realtime/gemini/token | jq             # acknowledged broken (master_key_fallback)
curl -sX POST $BASE/api/officer  -H 'content-type: application/json' -d '{}'  # 400 = body validation, endpoint live
curl -sX POST $BASE/api/baby     -H 'content-type: application/json' -d '{}'  # 400 = body validation, endpoint live
curl -sX POST $BASE/api/partner/line -H 'content-type: application/json' -d '{}'  # 400 = body validation
curl -sX POST $BASE/api/sfx -H 'content-type: application/json' \
  -d '{"prompt":"door slam in a quiet apartment","durationSeconds":2}' \
  -o /tmp/sfx.mp3 && file /tmp/sfx.mp3                         # MPEG audio

# Asset sanity — clean baby plates
for s in settled drowsy hungry fussy crying sleep; do
  curl -sI $BASE/puppets/baby-photoreal-v1/states/$s.png       # 200, transparent PNG
done
for c in hunger tired discomfort coo; do
  curl -sI $BASE/audio/baby/$c.mp3                             # 200
done
```

## Browser-test the full demo loop

Open https://babysim.berlayar.ai (or local `npm run dev:worker` on :8787). Hard-refresh to bust caches.

1. **Home → Start new game** → music kicks in immediately (pre-baked Lyria fallback or live if Lyria's ready). Top-right HUD cluster: AudioActivity pills (Officer/Partner/Baby/Music) + Realtime provider toggle (OpenAI/Gemini) + speaker icon. Music dot lights up.

2. **Officer intro** → muppet appears, speaks line 1 in distinct voice (Liam / George / Daniel per profile), wave + snap, music swell, line 2. Officer activity dot pulses while talking. If voice is generic, `wrangler tail` shows whether `/api/officer-tts` hits ElevenLabs vs falls back to browser TTS.

3. **Photo intake → verification (RPS) → adopt/generate chooser** → two big buttons. No baby preview imagery (was leaking babysteps lab UI before commit `09b10b5`).

4. **Baby arrival** → 90 s deadline starts here, NOT at start_game (commit `2b698bc`). Baby photo cycles through 6 transparent plates as needs change. Baby activity dot stays on through gameplay.

5. **First cry → soothe** → tap `feed`, watch needs drop, photo crossfade `crying → fussy → settled`, cry channel intensity drops. Open the sing modal: two buttons, "Sing into mic" + "Upload a clip"; either entry path runs the same volume/rhythm analysis.

6. **Night cry → argument_start** → realtime mic indicator goes "live"; speak; partner replies. Tool calls should mutate `state.ledger.partnerNightShifts`. **This is the validation gate for the realtime claim.** Text-input below the mic also routes through `/api/partner/line` with chat-history threading — works even if mic blocked.

7. **Verdict → debrief_card** → muppet stays on stage and signs off in profile-specific voice.

## Files most likely to need touching

- `src/Game.tsx` — adds `callGmAgent` call site if doing path A on gap #1
- `src/llm/gm-agent.ts` — currently doesn't exist (the worker handler does); create the client wrapper if path A
- `src/realtime/openai-realtime.ts` — only touch if event names drift; current code targets the late-2025 OpenAI Realtime API event surface
- `docs/HANDOFF.md` — last comprehensive update is from before the recent realtime / HUD commits; refresh if you change anything load-bearing

## Recent commits (newest first, last 9)

```
806256be  da7dae6  feat: HUD audio activity + realtime provider toggle + sing upload polish
35e48210  680ed10  fix: realtime partner via OpenAI by default, full session config
9dfdac70  b836159  fix: durable mute + every-state baby cry + partner chat continuity
539c0ff9  f420bc8  feat: type-to-partner fallback + /api/sfx generic endpoint
3e0aee9d  09b10b5  fix: clean baby plates + officer at debrief + looping cries + sing upload + muppet framing
12406ce1  2b698bc  fix: timer anchor + muppet 80vh + music on start + quote
1edd3c3d  1f06c7f  feat: dubstep intro vibe + mute toggle
ce7a50e2  a2360a1  chore: use restored-active-sealed-v1 as the only rig
83ca976c  290f74f  feat: photo-state rig as second adopt option
```

## When you're done

1. `npx tsc --noEmit && npx vitest run` — both green
2. Update `docs/HANDOFF.md` if you closed gap #1 or #2
3. **Single commit per gap closed** (don't bundle GM-wiring with pitch-rewrite)
4. `npm run deploy` and verify the live URL with the curl block above
5. Report back: which gaps closed, which restated, version ID of the last deploy
