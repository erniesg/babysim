# BabySim Agents Inventory

A multi-agent improv simulator: the Ministry of Family and Human Development pairs the player with a generative-AI newborn. A cast of LLM agents — officer, partner, baby, GM — calls tools in real time to render a 120-second co-parenting rehearsal. Hidden baby traits, a tired AI partner, a fairness ledger between parents, and a verdict that quotes the player back with names and numbers.

This doc enumerates those agents, the tools they may call, the system prompts they run under, and the wiring status of each. Every agent has a deterministic implementation **as a graceful-degradation fallback**, not as the canonical path — the dynamic mode is the product.

## TL;DR — what's actually wired today

| Agent | Tools defined? | Tools sent to provider? | Tool calls parsed back? | Mapped to game action? | End-to-end live? |
|---|:-:|:-:|:-:|:-:|:-:|
| **Officer** (gpt-5.5) | ✅ 7 tools (`say`, `set_expression`, `play_gesture`, `warn_player`, `start_challenge`, `advance_phase`, `request_player_input`) | ✅ `tools[]` (no forced `tool_choice`) | ✅ `tool_calls[*].function.arguments` parsed into `OfficerToolCall[]` | ✅ each call dispatched in `Game.tsx`; `say` → muppet ElevenLabs | ✅ verified in production at `babysim.berlayar.ai` |
| **Partner — per-beat text** (gemini-3.1-flash-lite) | ✅ 1 tool: `say_line` | ✅ `tool_config: { mode: "ANY", allowed_function_names: ["say_line"] }` | ✅ Gemini `functionCall.args` parsed | ✅ overrides scripted line per beat behind `VITE_PARTNER_LIVE_TEXT=1` | ✅ wired at `/api/partner/line` |
| **Partner — Gemini Live mic** (arguments only) | ✅ 4 tools | ✅ in `setup` frame | ✅ `msg.toolCall.functionCalls` | ✅ `concede→comfort_partner`, `refuse→get_up`, `take_night_shift→comfort_partner` | ⚠️ Google `v1alpha/auth/tokens` 404 — Worker falls back to master-key relay |
| **Partner — OpenAI Realtime swap** | ❌ tools NOT registered via `session.update` | ❌ | ⚠️ DataChannel listens for `response.function_call_arguments.done` | ⚠️ same browser handler, never fires | 🚧 ephemeral-key flow works; `session.update` tools is the missing piece |
| **Baby** (gpt-5.5) | ✅ 7 consultative tools (`play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`) plus `trigger_fallback` | ✅ `tool_choice: "auto"` | ✅ validated + channel-stripped | ✅ multi-call `{ tools: [{name, args}] }`; reducer clamps deltas via `dispatchAgentEvent` | ✅ wired at `/api/baby`; pure-function path retained as fallback |
| **GM (Director)** | ✅ 7 director tools | ✅ `tool_choice: "auto"` | ✅ `tool_calls[*].function.arguments` | ✅ validated + returned as `{ tools, rejected }` for browser dispatch | ✅ wired, deployed (`/api/gm`); deterministic fallback in `runtime.ts` still authoritative |

Code paths for the wiring (verify by grepping):
- Officer tool defs + parser: `src/worker/handlers/officer.ts`
- Officer tool args → muppet / engine: `src/Game.tsx` officer-intro effect → `muppet-engine.ts:say()` and `dispatchAgentEvent`
- Partner per-beat text: `src/worker/handlers/partner-line.ts` + `src/llm/partner-agent.ts`
- Partner Gemini Live tools: `src/realtime/gemini-live.ts`
- Baby agent dispatch + clamp: `src/worker/handlers/baby.ts` + `src/engine/runtime.ts:dispatchAgentEvent`

## Agent map

| Agent | Where it runs | Model (default) | Provider swap | Tools | Status |
|---|---|---|---|---|---|
| **Officer** | Cloudflare Worker `/api/officer` | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` (any OpenAI text-capable model). Anthropic key is wired for one-line swap. | `say`, `set_expression`, `play_gesture`, `warn_player`, `start_challenge`, `advance_phase`, `request_player_input` | **Live in production** |
| **Partner per-beat text** | Cloudflare Worker `/api/partner/line` | `gemini-3.1-flash-lite` | env var `GEMINI_TEXT_MODEL` | `say_line({ text, mood?, raise_resentment? })` | **Live behind `VITE_PARTNER_LIVE_TEXT=1`** — falls back to scripted lines × 4 archetypes |
| **Partner (Realtime mic, arguments only)** | Browser direct WebSocket / WebRTC | `gemini-3.1-flash-live-preview` | env flag `VITE_REALTIME_PARTNER_PROVIDER=openai` swaps to `gpt-realtime`. Same `RealtimePartnerSession` interface for both. | `take_night_shift`, `refuse_night_shift`, `concede_argument`, `raise_resentment` | **Live**; Gemini ephemeral-token endpoint falls back to master-key relay because Google's `v1alpha/auth/tokens` returns 404 for this preview key (see Worker logs) |
| **Baby** | Cloudflare Worker `/api/baby` + Browser pure-fn fallback | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` | `play_audio` (baby ch only, server-hardcoded), `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`, `trigger_fallback` | **Live** — Worker wired; pure-function fallback retained; reducer clamps `set_visual_state` / `set_need_delta` via `dispatchAgentEvent` |
| **GM (Director)** | Cloudflare Worker `/api/gm` + Browser pure-fn fallback | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` | `enter_beat` (exclusive), `set_caption`, `play_audio`, `stop_audio`, `ask_agent`, `advance_time`, `trigger_fallback` | **Live** — Worker wired; deterministic `runtime.ts` fallback retained |

> Pattern: all agent endpoints are minimal hand-rolled Worker handlers. The
> published Cloudflare Agents SDK package and Durable Objects are NOT yet
> in use; agent state lives in the browser `LocalGameTransport`.

## Tool schema (DirectorCommand → JSON Schema)

The contracts in `contracts/director-commands.ts` are already shaped like a tool-call schema. Every agent emits a subset of these. The **GM** is the only agent allowed to emit `enter_beat` (beat transitions). The **Baby** is the only agent allowed to emit `play_audio` on the `baby` channel.

```ts
// Director-level tools (GM-callable):
type DirectorTool =
  | { name: "enter_beat";  args: { beatId: string } }
  | { name: "set_caption"; args: { text: string } }
  | { name: "play_audio";  args: { channel: "baby"|"partner"|"officer"|"ambient", assetId: string, loop?: boolean } }
  | { name: "stop_audio";  args: { channel: "baby"|"partner"|"officer"|"ambient"|"all" } }
  | { name: "ask_agent";   args: { agent: "baby"|"partner"|"officer", payload: object } }
  | { name: "advance_time";args: { hours: number } }
  | { name: "trigger_fallback"; args: { reason: string } };

// Officer tools (the deployed Officer surface — see src/worker/handlers/officer.ts):
type OfficerTool =
  | { name: "say";                   args: { text: string, expression: "strict"|"warm"|"skeptical"|"delighted", gesture: "stamp"|"lean"|"nod"|"wave"|"point"|"none" } }
  | { name: "set_expression";        args: { expression: "strict"|"warm"|"skeptical"|"delighted" } }
  | { name: "play_gesture";          args: { gesture: "stamp"|"lean"|"nod"|"wave"|"point"|"none" } }
  | { name: "warn_player";           args: { text: string, severity: "note"|"stern"|"final" } }
  | { name: "start_challenge";       args: { challenge: "rps"|"voice"|"keymash"|"konami" } }
  | { name: "advance_phase";         args: { to: string } }
  | { name: "request_player_input";  args: { kind: "confirm"|"choice"|"text", prompt: string } };

// Baby tools (consultative — reducer clamps via dispatchAgentEvent):
type BabyTool =
  | { name: "play_audio";          args: { assetId: "babyAudio.hunger"|"babyAudio.tired"|"babyAudio.discomfort"|"babyAudio.coo", loop: boolean } }
  | { name: "set_caption";         args: { text: string } }
  | { name: "set_visual_state";    args: { state: "settled"|"drowsy"|"hungry"|"fussy"|"crying"|"sleep" } }
  | { name: "set_mood_delta";      args: { delta: number } }
  | { name: "set_need_delta";      args: { need: "hunger"|"sleepiness"|"discomfort"|"connection"|"health", delta: number } }
  | { name: "request_attention";   args: { kind: "cry"|"fuss"|"coo", intensity: number } }
  | { name: "acknowledge_action";  args: { action: string, success: boolean } }
  | { name: "trigger_fallback";    args: { reason: string } };

// Partner per-beat text tool (Gemini Flash Lite):
type PartnerLineTool =
  | { name: "say_line"; args: { text: string, mood?: "warm"|"tense"|"exhausted"|"cold", raise_resentment?: boolean } };

// Partner Realtime mic tools (Gemini Live or OpenAI Realtime, arguments only):
type PartnerRealtimeTool =
  | { name: "take_night_shift";   args: {} }
  | { name: "refuse_night_shift"; args: {} }
  | { name: "concede_argument";   args: {} }
  | { name: "raise_resentment";   args: { delta?: number } };
```

## Per-agent allow-list

`Partner-text` = `/api/partner/line` (Gemini Flash Lite). `Partner-mic` = realtime mic during arguments only.

| Tool | GM | Officer | Baby | Partner-text | Partner-mic |
|---|:-:|:-:|:-:|:-:|:-:|
| `enter_beat` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `set_caption` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `play_audio` | ✓ | ✗ | ✓ (baby ch only, server-hardcoded) | ✗ | ✗ |
| `stop_audio` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `ask_agent` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `advance_time` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `trigger_fallback` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `say` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `set_expression` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `play_gesture` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `warn_player` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `start_challenge` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `advance_phase` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `request_player_input` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `set_visual_state` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `set_mood_delta` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `set_need_delta` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `request_attention` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `acknowledge_action` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `say_line` | ✗ | ✗ | ✗ | ✓ | ✗ |
| `take_night_shift` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `refuse_night_shift` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `concede_argument` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `raise_resentment` | ✗ | ✗ | ✗ | ✗ | ✓ |

## System prompts

### Officer (`src/worker/handlers/officer.ts`)
Tone: bureaucratic, ominous, slightly absurd, dry-funny — never cruel. Per-character voice profiles via `voiceProfileFor()` (Ernest = dry-mischievous UK lilt, Bern = severe-clipped clinical, Crumb = Singlish-chaotic). Officer typically emits one `say()` per beat (officer_intro / ominous_warning / verdict), optionally chained with `set_expression`, `warn_player`, `advance_phase`, etc. The verdict prompt requires the model to reference at least one ledger number so the verdict feels personal. See `systemPromptFor()` in `src/worker/handlers/officer.ts`.

### Partner (`src/worker/handlers/partner-line.ts` + `src/realtime/gemini-live.ts`)
Tone keyed by archetype:
- **anxious** → hushed, fretty, sentences trailing
- **chill** → laconic, low-energy, half-amused
- **resentful** → scorekeeping, clipped, cites the ledger
- **overfunctioner** → martyred, performatively competent, quietly exhausted

The per-beat text path (Gemini Flash Lite, `say_line`) injects archetype + ledger + recent events on every call; see `partner-line.ts:SYSTEM_PROMPT`. The realtime mic path injects the same shape on every Gemini Live session start, so the partner can say things like "you've been up twice tonight, you've earned this one." See `systemPromptFor()` in `src/realtime/gemini-live.ts`.

### Baby (`src/worker/handlers/baby.ts`)
"You are the baby's internal-state translator … HIDDEN TRAITS the player must discover through trial and error: soothing / stimulation / feeding / sleep / temperament." The system prompt (full text in `BABY_SYSTEM_PROMPT`) walks the model through tool-by-tool guidance for the consultative surface, with explicit rules for BEAT_ENTERED vs action-evaluation turns. Server hardcodes `channel: "baby"` and clamps numeric deltas. If genuinely uncertain, the model is told to call `trigger_fallback` and the deterministic BabyAgent in `src/engine/baby-agent.ts` takes over.

### GM (`src/worker/handlers/gm.ts`)
Tone: invisible stage director — never speaks to the player as a character. Accepts `{ state, recentEvents, reason }`, emits `{ tools: ParsedToolCall[], rejected: [...] }`. Every `enter_beat` call is server-side validated against `BEAT_GRAPH[currentBeat].possibleNextBeats`; invalid transitions are dropped and logged as `[gm <uuid>] rejected_beat_transition`. Multiple tool calls per response are supported (`tool_choice: "auto"`). The deterministic `DirectorRuntime` in `runtime.ts` remains authoritative — this endpoint only returns commands; the browser dispatches them and the runtime validates again.

## Provider swap matrix

| Slot | Default | Swap with | Mechanism |
|---|---|---|---|
| Officer text | `gpt-5.5` | any OpenAI text model; Anthropic `claude-*` is wired (one-line swap) | env var `OPENAI_TEXT_MODEL`; ANTHROPIC_API_KEY already a Worker secret |
| Officer voice | ElevenLabs TTS (`/api/officer/say`) | Browser `SpeechSynthesis` per-officer profile; off | `VITE_OFFICER_VOICE_PROVIDER=elevenlabs` (default) / `browser` / `off` |
| Partner per-beat text | `gemini-3.1-flash-lite` | scripted lines × 4 archetypes | `VITE_PARTNER_LIVE_TEXT=1` to enable; off → scripted fallback |
| Partner realtime mic | Gemini Live (`gemini-3.1-flash-live-preview`) | OpenAI Realtime (`gpt-realtime`) | `VITE_REALTIME_PARTNER_PROVIDER=openai`; same `RealtimePartnerSession` interface in `src/realtime/{gemini-live,openai-realtime}.ts` |
| Baby SFX | donateacry public-dataset MP3s in `public/audio/baby/` | Live ElevenLabs `text_to_sound_v2` (`/api/baby/sfx`) | `VITE_LIVE_BABY_SFX=1`; pre-baked path otherwise |
| Baby portrait | 2.5D rig in `public/puppets/baby/` | live `gpt-image-2` via Replicate (`/api/baby/portrait`) | AdoptOrGenerate chooser at `baby_roll`; fal.ai flux-pro available with `provider="fal"` |
| Officer avatar | Pre-baked PNGs in `public/img/` | live `gpt-image-2` via Replicate (`/api/officer/avatar`) | per-request |
| Music bed | Lyria-002 via Vertex AI (`/api/music/probation-theme`) | Pre-baked `public/audio/music/probation-theme.mp3` | `VITE_LIVE_MUSIC` default ON, set `0` to force pre-baked |
| Cute payoff | Veo-3.1 via Vertex AI (`/api/cute-payoff/video`) | CSS animation | LRO 2-step (initiate POST + poll GET) |
| Cinematic | Replicate `seedance` / `veo` / fal `kling-v3-pro` | per-request `body.provider` (`seedance` default; pass `veo` for any baby cinematic to skirt Seedance moderation) | `/api/cinematic` |

## Endpoints

```
GET  /api/healthz                          → secrets present + active models
POST /api/officer                          → gpt-5.5 → { tools: [{name, args}] } (7 officer tools)
POST /api/officer/say                      → ElevenLabs TTS → audio/mpeg
POST /api/officer/avatar                   → Replicate gpt-image-2 → image/png (or raw mime if non-PNG)
POST /api/baby                             → gpt-5.5 → { tools: [{name, args}] } (7 consultative tools + trigger_fallback)
POST /api/baby/sfx                         → ElevenLabs text_to_sound_v2 → audio/mpeg
POST /api/baby/portrait                    → Replicate gpt-image-2 (or fal flux-pro) → image/png
POST /api/partner/line                     → gemini-3.1-flash-lite → { tools: [{ name: "say_line", args: { text, mood?, raise_resentment? } }] }
POST /api/music/probation-theme            → Lyria-002 via Vertex AI → audio/wav
POST /api/cute-payoff/video                → Veo-3.1 initiate → { operationName, status: "running" }
GET  /api/cute-payoff/video?operation=...  → Veo-3.1 poll → video bytes or { status: "pending" }
POST /api/cinematic                        → Replicate Seedance/Veo or fal Kling initiate → { operationName, status: "running" }
GET  /api/cinematic?operation=...          → poll → video bytes or { status: "pending" }
POST /api/gm                               → gpt-5.5 → { tools: [{name, args}], rejected: [...] } (DirectorCommand variants; enter_beat BEAT_GRAPH-validated)
POST /api/realtime/gemini/token            → ephemeral token (or master-key fallback)
POST /api/realtime/openai/token            → OpenAI Realtime client_secret
```

All endpoints CORS-permissive (`*`) for browser direct calls. Every request gets a UUID logged on entry, upstream status + body head logged on response, errors include `upstreamStatus` + `detail` so failures are diagnosable from `wrangler tail` or Cloudflare's observability stream.

## Live media generation endpoints

Session-time generation endpoints under `src/worker/handlers/`. All follow the `officer-tts.ts` pattern: single exported handler function, exported `Env` interface, `crypto.randomUUID()` request-id on every call, `console.log` prefixed with `[<handler> <reqId>]`, surfaced upstream errors as `{ error, detail }` JSON, CORS `*` headers on all responses.

| Endpoint | Handler file | Inputs | Provider | Returns | Frontend fallback |
|---|---|---|---|---|---|
| `POST /api/baby/sfx` | `baby-sfx.ts` | `{ trigger: "hunger"\|"tired"\|"discomfort"\|"coo", durationSeconds?: 3 }` | ElevenLabs `text_to_sound_v2` | `audio/mpeg`, `cache-control: public, max-age=3600` | donateacry public-dataset MP3s at `public/audio/baby/{trigger}.mp3` |
| `POST /api/baby/portrait` | `baby-portrait.ts` | `{ state: BabyVisualState, gender: "girl"\|"boy", traits: BabyTraits, babyName?: string, provider?: "replicate"\|"fal" }` | Replicate `openai/gpt-image-2` (default) or fal `flux-pro/v1.1` (with `provider="fal"`); 60-90 s cold start so handler uses `Prefer: wait=60` + 5×5 s polls | `image/png` (or raw JPEG if non-PNG), `cache-control: public, max-age=3600` | Canonical 2.5D rig at `public/puppets/baby/`; pre-baked state PNGs in `public/img/baby/` |
| `POST /api/officer/avatar` | `officer-avatar.ts` | `{ expression: "strict"\|"warm"\|"skeptical"\|"delighted", officer?: "Ernest"\|"Bern"\|"Crumb"\|"Tan"\|"Lim"\|"Wong" }` | Replicate `openai/gpt-image-2` | `image/png`, `cache-control: public, max-age=3600` | Pre-baked `public/img/officer-{ernest,bern,crumb}-{strict,warm,skeptical,delighted}.png` |
| `POST /api/music/probation-theme` | `music.ts` | `{ vibe?: "intro"\|"argument"\|"verdict" }` | Lyria-002 via Vertex AI (JWT-signed service-account, `crypto.subtle`) | `audio/wav`, `cache-control: public, max-age=86400` | Pre-baked `public/audio/music/probation-theme.mp3` |
| `POST /api/cute-payoff/video` (initiate) | `cute-payoff.ts` | `{ babyName: string, gender: "girl"\|"boy" }` | Veo-3.1 via Vertex AI `predictLongRunning` | `{ operationName: string, status: "running" }` (202) | CSS animation in frontend |
| `GET /api/cute-payoff/video?operation=...` (poll) | `cute-payoff.ts` | `operation` query param | Vertex AI LRO poll | Video bytes (`video/mp4`) when done; `{ status: "pending" }` (202) while running | CSS animation |
| `POST /api/cinematic` (initiate) | `cinematic.ts` | `{ provider?: "seedance"\|"veo"\|"fal", prompt, ... }` | Replicate Seedance/Veo (default) or fal Kling (`provider="fal"`). Pass `provider: "veo"` for any baby cinematic — Bytedance Seedance moderation E005 rejects photoreal-newborn frames. | `{ operationName, status: "running" }` (202) | per-beat CSS / static fallback |
| `GET /api/cinematic?operation=...` (poll) | `cinematic.ts` | `operation` query param | LRO poll | Video bytes (`video/mp4`) when done; `{ status: "pending" }` (202) while running | per-beat fallback |
| `POST /api/partner/line` | `partner-line.ts` | `{ beatId, partner, ledger, baby, recentEvents }` | `gemini-3.1-flash-lite` with `say_line` function-call (forced `mode: "ANY"`) | `{ tools: [{ name: "say_line", args: { text, mood?, raise_resentment? } }] }` | Scripted lines × 4 archetypes in `src/engine/partner-agent.ts` |

### Secrets required

| Secret name | Used by | How to set |
|---|---|---|
| `OPENAI_API_KEY` | `officer.ts`, `baby.ts`, `gm.ts` | `wrangler secret put OPENAI_API_KEY` |
| `GEMINI_API_KEY` | `partner-line.ts`, realtime-token handlers | `wrangler secret put GEMINI_API_KEY` |
| `ELEVENLABS_API_KEY` | `baby-sfx.ts`, `officer-tts.ts` | `wrangler secret put ELEVENLABS_API_KEY` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `music.ts`, `cute-payoff.ts` | `wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` (paste full service-account JSON) |
| `REPLICATE_API_TOKEN` | `baby-portrait.ts`, `officer-avatar.ts`, `cinematic.ts` | `wrangler secret put REPLICATE_API_TOKEN` |
| `FAL_KEY` | optional fal path for `baby-portrait.ts`, `cinematic.ts` | `wrangler secret put FAL_KEY` |
| `ANTHROPIC_API_KEY` | optional one-line officer-text swap | `wrangler secret put ANTHROPIC_API_KEY` |

### Failure modes

- `baby-sfx.ts`: upstream ElevenLabs error → **503** `{ error, detail }`. Frontend falls back to pre-baked.
- `baby-portrait.ts`: all upstream attempts fail → **503**. Frontend uses canonical rig / pre-baked PNG.
- `officer-avatar.ts`: upstream fail → **503**. Frontend uses pre-baked officer PNGs.
- `music.ts`: `GOOGLE_SERVICE_ACCOUNT_JSON` unset → **503** with clear message. Auth failure → **503**. Lyria predict failure → **503**. Frontend uses pre-baked MP3 in all cases.
- `cute-payoff.ts` (initiate): Veo unreachable → **503**. Frontend retains CSS animation.
- `cute-payoff.ts` (poll): operation error or missing video → **502**. Pending → **202** `{ status: "pending" }`.
- `cinematic.ts`: Seedance moderation E005 on photoreal-newborn frames → caller should retry with `provider: "veo"`.
- `partner-line.ts`: upstream fail or empty `say_line` → returns synthesized empty `say_line` so the frontend keeps the scripted fallback path.

### Wiring status

| Endpoint | Status |
|---|:-:|
| `POST /api/baby/sfx` | Live — wired |
| `POST /api/baby/portrait` | Live — wired |
| `POST /api/officer/avatar` | Live — wired |
| `POST /api/music/probation-theme` | Live — wired; requires `GOOGLE_SERVICE_ACCOUNT_JSON` secret |
| `POST /api/cute-payoff/video` (initiate) | Live — wired; requires `GOOGLE_SERVICE_ACCOUNT_JSON` secret |
| `GET /api/cute-payoff/video` (poll) | Live — wired |
| `POST /api/cinematic` (initiate) | Live — wired; requires `REPLICATE_API_TOKEN` and/or `FAL_KEY` |
| `GET /api/cinematic` (poll) | Live — wired |
| `POST /api/partner/line` | Live — wired behind `VITE_PARTNER_LIVE_TEXT=1`; requires `GEMINI_API_KEY` |

## Why the Cloudflare Workers shape (vs. Pages)

Pages Functions ARE Workers — same V8 isolates runtime — but the file-based `/functions/api/*.ts` routing is the legacy shape. We ship as a single Worker with the static SPA bound via `[assets]`:

```toml
# wrangler.toml
name = "babysim"
main = "src/worker/index.ts"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

This is the path-forward for adding Durable Objects (multiplayer + agent state). Today the agent handlers are minimal hand-rolled implementations — the published Cloudflare Agents SDK package is NOT in use.

## Roadmap

| Lift | Status | Notes |
|---|---|---|
| Officer agent (gpt-5.5) | ✅ Live | 7 tools; per-character voice profiles (Ernest / Bern / Crumb); ledger-aware verdict |
| Partner per-beat text (Gemini Flash Lite) | ✅ Wired at `/api/partner/line` | `say_line` only; behind `VITE_PARTNER_LIVE_TEXT=1`; scripted lines × 4 archetypes are the fallback |
| Partner Realtime mic (Gemini Live) | ⚠️ Live with master-key fallback | Active during `argument_start` / `argument_resolution` only; need WS-relay Worker if Google's v1alpha auth-tokens stays 404 |
| OpenAI Realtime swap | ✅ Wired | env flag flip; ephemeral-key flow already works; `session.update` tool registration still missing |
| Baby agent | ✅ Wired at `/api/baby` | gpt-5.5, `tool_choice: "auto"`, 7 consultative tools + `trigger_fallback`, channel hardcoded to `"baby"`, assetId enum-validated, deltas clamped via `dispatchAgentEvent` |
| GM agent | ✅ Wired at `/api/gm` | gpt-5.5, `tool_choice: "auto"`, 7 DirectorCommand tools, server-side BEAT_GRAPH transition validation, `{ tools, rejected }` response shape |
| GameSessionDO (multiplayer) | ❌ Not started | Adds two-player rooms, partner-as-second-player, observability. "Join a Room" still alerts. |
| Baby SFX live generation (`/api/baby/sfx`) | ✅ Wired | ElevenLabs `text_to_sound_v2`; frontend falls back to donateacry public-dataset clips |
| Baby portrait live generation (`/api/baby/portrait`) | ✅ Wired | Replicate `gpt-image-2` (default) / fal `flux-pro` (alt); 60-90 s cold start; frontend falls back to canonical 2.5D rig |
| Officer avatar live generation (`/api/officer/avatar`) | ✅ Wired | Replicate `gpt-image-2`; frontend falls back to pre-baked PNGs |
| Probation-theme music (`/api/music/probation-theme`) | ✅ Wired | Lyria-002 via Vertex AI (JWT service-account); returns WAV; frontend falls back to pre-baked MP3 |
| Veo-3.1 cute-payoff video | ✅ Wired (initiate + poll) | Async 2-step LRO. Frontend CSS animation remains fallback. |
| Cinematic generation | ✅ Wired (initiate + poll) | Replicate Seedance/Veo + fal Kling; pass `provider: "veo"` for any baby cinematic to skirt Seedance moderation |
