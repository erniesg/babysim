# BabySim Agents Inventory

A multi-agent improv simulator: the Ministry of Family and Human Development pairs the player with a generative-AI newborn. A cast of LLM agents — officer, partner, baby, GM — calls tools in real time to render a 120-second co-parenting rehearsal. Hidden baby traits, a tired AI partner, a fairness ledger between parents, and a verdict that quotes the player back with names and numbers.

This doc enumerates those agents, the tools they may call, the system prompts they run under, and the wiring status of each. Every agent has a deterministic implementation **as a graceful-degradation fallback**, not as the canonical path — the dynamic mode is the product.

## TL;DR — what's actually wired today

| Agent | Tools defined? | Tools sent to provider? | Tool calls parsed back? | Mapped to game action? | End-to-end live? |
|---|:-:|:-:|:-:|:-:|:-:|
| **Officer** (gpt-5.5) | ✅ `say` | ✅ `tool_choice: { name: "say" }` | ✅ `tool_calls[0].function.arguments` | ✅ `muppet.say()` | ✅ verified in production at `babysim.berlayar.ai` |
| **Partner — Gemini Live** | ✅ 4 tools | ✅ in `setup` frame | ✅ `msg.toolCall.functionCalls` | ✅ `concede→comfort_partner`, `refuse→get_up`, `take_night_shift→comfort_partner` | ⚠️ blocked on Google `v1alpha/auth/tokens` 404 — Worker falls back to master-key relay; needs WS-relay Worker for prod |
| **Partner — OpenAI Realtime** | ❌ tools NOT registered via `session.update` | ❌ | ⚠️ DataChannel listens for `response.function_call_arguments.done` | ⚠️ same browser handler as Gemini, just never fires | 🚧 ephemeral key flow works; tool-registration `session.update` is the missing piece (~30 lines) |
| **Baby** | ✅ `play_audio`, `set_caption`, `trigger_fallback` | ✅ `tool_choice: "auto"` | ✅ validated + channel-stripped | ✅ multi-call `{ tools: [{name, args}] }` | ✅ wired at `/api/baby`; pure-function path retained as fallback |
| **GM (Director)** | ✅ 7 tools | ✅ `tool_choice: "auto"` | ✅ `tool_calls[*].function.arguments` | ✅ validated + returned as `{ tools, rejected }` for browser dispatch | ✅ wired, deployed (`/api/gm`); deterministic fallback in `runtime.ts` still authoritative |

Code paths for the wiring (verify by grepping):
- Officer tool def → call → parse: `src/worker/handlers/officer.ts:29,114,142`
- Officer tool args → muppet: `src/Game.tsx:183-187` (LLM line) → `muppet-engine.ts:say()`
- Partner Gemini tools → emit: `src/realtime/gemini-live.ts:31,161,215`
- Partner tool call → action: `src/Game.tsx:336-345`

## Agent map

| Agent | Where it runs | Model (default) | Provider swap | Tools | Status |
|---|---|---|---|---|---|
| **Officer** | Cloudflare Worker `/api/officer` | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` (any OpenAI text-capable model). Anthropic `claude-opus-4-7` is keyed in `.env` and is a one-line swap. | `say(text, expression, gesture)` | **Live in production** |
| **Partner (Realtime)** | Browser direct WebSocket / WebRTC | `gemini-3.1-flash-live-preview` | env flag `VITE_REALTIME_PARTNER_PROVIDER=openai` swaps to `gpt-realtime`. Same `RealtimePartnerSession` interface for both. | `take_night_shift`, `refuse_night_shift`, `concede_argument`, `raise_resentment` | **Live in production**; Gemini ephemeral-token endpoint falls back to master-key relay because Google's `v1alpha/auth/tokens` returns 404 for this preview key (see Worker logs) |
| **Baby** | Cloudflare Worker `/api/baby` + Browser pure-fn fallback | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` | `play_audio` (baby ch only, server-hardcoded), `set_caption`, `trigger_fallback` | **Live** — Worker wired; pure-function fallback retained |
| **GM (Director)** | Cloudflare Worker `/api/gm` + Browser pure-fn fallback | `gpt-5.5` | env var `OPENAI_TEXT_MODEL` | `enter_beat` (exclusive), `set_caption`, `play_audio`, `stop_audio`, `ask_agent`, `advance_time`, `trigger_fallback` | **Live** — Worker wired; deterministic `runtime.ts` fallback retained |

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

// Muppet-level tools (Officer-callable):
type MuppetTool =
  | { name: "say";          args: { text: string, expression: "strict"|"warm"|"skeptical"|"delighted", gesture: "stamp"|"lean"|"nod"|"wave"|"none" } }
  | { name: "set_expression"; args: { expression: ... } }
  | { name: "play_gesture";   args: { gesture: ... } };

// Partner-level tools (Realtime partner-callable):
type PartnerTool =
  | { name: "take_night_shift"; args: {} }
  | { name: "refuse_night_shift"; args: {} }
  | { name: "concede_argument"; args: {} }
  | { name: "raise_resentment"; args: { delta?: number } };
```

## Per-agent allow-list

| Tool | GM | Officer | Partner | Baby |
|---|:-:|:-:|:-:|:-:|
| `enter_beat` | ✓ | ✗ | ✗ | ✗ |
| `set_caption` | ✓ | ✗ | ✗ | ✓ |
| `play_audio` | ✓ | ✗ | ✗ | ✓ (baby ch only) |
| `stop_audio` | ✓ | ✗ | ✗ | ✓ (baby ch only) |
| `ask_agent` | ✓ | ✗ | ✗ | ✗ |
| `advance_time` | ✓ | ✗ | ✗ | ✗ |
| `trigger_fallback` | ✓ | ✓ | ✓ | ✓ |
| `say` (muppet) | ✗ | ✓ | ✗ | ✗ |
| `set_expression` | ✗ | ✓ | ✗ | ✗ |
| `play_gesture` | ✗ | ✓ | ✗ | ✗ |
| `take_night_shift` | ✗ | ✗ | ✓ | ✗ |
| `refuse_night_shift` | ✗ | ✗ | ✓ | ✗ |
| `concede_argument` | ✗ | ✗ | ✓ | ✗ |
| `raise_resentment` | ✗ | ✗ | ✓ | ✗ |

## System prompts

### Officer (`functions/api → src/worker/handlers/officer.ts`)
Tone: bureaucratic, ominous, slightly absurd, dry-funny — never cruel. Emits **one** `say()` per beat (officer_intro / ominous_warning / verdict). The verdict prompt requires the model to reference at least one ledger number so the verdict feels personal. See `SYSTEM_PROMPTS` in `src/worker/handlers/officer.ts`.

### Partner (`src/realtime/gemini-live.ts`)
Tone keyed by archetype:
- **anxious** → hushed, fretty, sentences trailing
- **chill** → laconic, low-energy, half-amused
- **resentful** → scorekeeping, clipped, cites the ledger
- **overfunctioner** → martyred, performatively competent, quietly exhausted

Plus the live ledger snapshot is injected on every session start, so the partner can say things like "you've been up twice tonight, you've earned this one." See `systemPromptFor()` in `src/realtime/gemini-live.ts`.

### Baby (planned)
> "You are the baby's internal state translator. You may emit `play_audio` on the `baby` channel and `set_caption` to surface a single trait-discovery hint. You may NOT call `enter_beat` or any other agent's tool. If unsure, call `trigger_fallback` and the deterministic BabyAgent function will take over."

### GM (`src/worker/handlers/gm.ts`)
Tone: invisible stage director — never speaks to the player as a character. Accepts `{ state, recentEvents, reason }`, emits `{ tools: ParsedToolCall[], rejected: [...] }`. Every `enter_beat` call is server-side validated against `BEAT_GRAPH[currentBeat].possibleNextBeats`; invalid transitions are dropped and logged as `[gm <uuid>] rejected_beat_transition`. Multiple tool calls per response are supported (`tool_choice: "auto"`). The deterministic `DirectorRuntime` in `runtime.ts` remains authoritative — this endpoint only returns commands; the browser dispatches them and the runtime validates again.

## Provider swap matrix

| Slot | Default | Swap with | Mechanism |
|---|---|---|---|
| Officer text | gpt-5.5 | claude-opus-4-7 (Anthropic) | Replace fetch URL + headers in `src/worker/handlers/officer.ts`. ANTHROPIC_API_KEY already present in `.env`. |
| Partner realtime | Gemini Live (gemini-3.1-flash-live-preview) | OpenAI Realtime (gpt-realtime) | Set `VITE_REALTIME_PARTNER_PROVIDER=openai` and rebuild. Same `RealtimePartnerSession` interface; two implementations in `src/realtime/{gemini-live,openai-realtime}.ts`. |
| Officer voice | Browser SpeechSynthesis (Daniel/Karen/Alex per officer) | Gemini Flash voice via Live API; or OpenAI TTS via REST | Refactor `muppet-engine.ts:say()` to optionally route through a `<TTSProvider>` instead of SpeechSynthesisUtterance. |
| Baby SFX | Pre-generated Gemini TTS clips in `public/audio/baby/` | Live ElevenLabs SFX | Already coded in `scripts/generate-baby-sounds.mjs`. |
| Music bed | Pre-generated Lyria-002 (`public/audio/music/probation-theme.mp3`) | Suno / Udio | `scripts/generate-music.mjs` chain. |

## Endpoints

```
GET  /api/healthz                          → secrets present + active models
POST /api/officer                          → gpt-5.5 → say() tool args
POST /api/officer/say                      → ElevenLabs TTS → audio/mpeg
POST /api/baby                             → gpt-5.5 → { tools: [{name, args}] } (play_audio / set_caption / trigger_fallback)
POST /api/baby/sfx                         → ElevenLabs sound-generation → audio/mpeg
POST /api/baby/portrait                    → Gemini image → image/png (or raw mime if non-PNG)
POST /api/officer/avatar                   → Gemini image → image/png (or raw mime if non-PNG)
POST /api/music/probation-theme            → Lyria-002 via Vertex AI → audio/wav
POST /api/cute-payoff/video                → Veo-3.1 initiate → { operationName, status: "running" }
GET  /api/cute-payoff/video?operation=...  → Veo-3.1 poll → video bytes or { status: "pending" }
POST /api/gm                               → gpt-5.5 → { tools: [{name, args}], rejected: [...] } (all DirectorCommand variants; enter_beat BEAT_GRAPH-validated)
POST /api/realtime/gemini/token            → ephemeral token (or master-key fallback)
POST /api/realtime/openai/token            → OpenAI Realtime client_secret
```

All endpoints CORS-permissive (`*`) for browser direct calls. Every request gets a UUID logged on entry, upstream status + body head logged on response, errors include `upstreamStatus` + `detail` so failures are diagnosable from `wrangler tail` or Cloudflare's observability stream.

## Live media generation endpoints

Five session-time generation endpoints added under `src/worker/handlers/`. All follow the `officer-tts.ts` pattern: single exported handler function, exported `Env` interface, `crypto.randomUUID()` request-id on every call, `console.log` prefixed with `[<handler> <reqId>]`, surfaced upstream errors as `{ error, detail }` JSON, CORS `*` headers on all responses.

| Endpoint | Handler file | Inputs | Provider | Returns | Frontend fallback |
|---|---|---|---|---|---|
| `POST /api/baby/sfx` | `baby-sfx.ts` | `{ trigger: "hunger"\|"tired"\|"discomfort"\|"coo", durationSeconds?: 3 }` | ElevenLabs `text_to_sound_v2` | `audio/mpeg`, `cache-control: public, max-age=3600` | Pre-baked clips in `public/audio/baby/{trigger}.mp3` |
| `POST /api/baby/portrait` | `baby-portrait.ts` | `{ state: BabyVisualState, gender: "girl"\|"boy", traits: BabyTraits, babyName?: string }` | Gemini image (tries `gemini-3-pro-image-preview` → `gemini-3-image-preview` → `gemini-2.5-flash-image-preview` → `gemini-2.0-flash-preview-image-generation`) | `image/png` (or raw JPEG if non-PNG), `cache-control: public, max-age=3600` | Pre-baked PNGs at `public/img/baby/{state}.png` |
| `POST /api/officer/avatar` | `officer-avatar.ts` | `{ expression: "strict"\|"warm"\|"skeptical"\|"delighted", officer?: "Tan"\|"Lim"\|"Wong" }` | Gemini image (same model waterfall as baby-portrait) | `image/png`, `cache-control: public, max-age=3600` | Pre-baked `public/img/officer-tan-{strict,warm}.png` |
| `POST /api/music/probation-theme` | `music.ts` | `{ vibe?: "intro"\|"argument"\|"verdict" }` | Lyria-002 via Vertex AI (JWT-signed service-account, `crypto.subtle`) | `audio/wav`, `cache-control: public, max-age=86400` | Pre-baked `public/audio/music/probation-theme.mp3` |
| `POST /api/cute-payoff/video` (initiate) | `cute-payoff.ts` | `{ babyName: string, gender: "girl"\|"boy" }` | Veo-3.1 via Vertex AI `predictLongRunning` | `{ operationName: string, status: "running" }` (202) | CSS animation in frontend |
| `GET /api/cute-payoff/video?operation=...` (poll) | `cute-payoff.ts` | `operation` query param | Vertex AI LRO poll | Video bytes (`video/mp4`) when done; `{ status: "pending" }` (202) while running | CSS animation |

### Secrets required

| Secret name | Used by | How to set |
|---|---|---|
| `ELEVENLABS_API_KEY` | `baby-sfx.ts`, `officer-tts.ts` | `wrangler secret put ELEVENLABS_API_KEY` |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `baby-portrait.ts`, `officer-avatar.ts` | `wrangler secret put GEMINI_API_KEY` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `music.ts`, `cute-payoff.ts` | `wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` (paste full service-account JSON) |

### Failure modes

- `baby-sfx.ts`: upstream ElevenLabs error → **503** `{ error, detail }`. Frontend falls back to pre-baked.
- `baby-portrait.ts`: all Gemini models fail → **503**. Frontend uses `public/img/baby/{state}.png`.
- `officer-avatar.ts`: all Gemini models fail → **503**. Frontend uses pre-baked officer PNGs.
- `music.ts`: `GOOGLE_SERVICE_ACCOUNT_JSON` unset → **503** with clear message. Auth failure → **503**. Lyria predict failure → **503**. Frontend uses pre-baked MP3 in all cases.
- `cute-payoff.ts` (initiate): Veo unreachable → **503**. Frontend retains CSS animation.
- `cute-payoff.ts` (poll): operation error or missing video → **502**. Pending → **202** `{ status: "pending" }`.

### Wiring status

| Endpoint | Status |
|---|:-:|
| `POST /api/baby/sfx` | Live — wired |
| `POST /api/baby/portrait` | Live — wired |
| `POST /api/officer/avatar` | Live — wired |
| `POST /api/music/probation-theme` | Live — wired; requires `GOOGLE_SERVICE_ACCOUNT_JSON` secret |
| `POST /api/cute-payoff/video` (initiate) | Live — wired; requires `GOOGLE_SERVICE_ACCOUNT_JSON` secret |
| `GET /api/cute-payoff/video` (poll) | Live — wired |

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

This is the same shape the Cloudflare Agents SDK uses, and is the path-forward for adding Durable Objects (multiplayer + agent state).

## Roadmap

| Lift | Status | Notes |
|---|---|---|
| Officer agent (gpt-5.5) | ✅ Live | Quotes the ledger; flips expression+gesture per beat |
| Partner Realtime (Gemini Live) | ⚠️ Live with master-key fallback | Need ephemeral-token endpoint; build WS-relay Worker if Google's v1alpha auth-tokens stays 404 |
| OpenAI Realtime swap | ✅ Wired | env flag flip; ephemeral-key flow already works |
| Baby agent | ✅ Wired at `/api/baby` | gpt-5.5, tool_choice auto, multi-call response, channel locked to "baby", assetId enum-validated |
| GM agent | ✅ Wired at `/api/gm` | gpt-5.5, tool_choice auto, 7 DirectorCommand tools, server-side BEAT_GRAPH transition validation, `{ tools, rejected }` response shape |
| GameSessionDO (multiplayer) | ❌ Not started | Adds two-player rooms, partner-as-second-player, observability |
| Baby SFX live generation (`/api/baby/sfx`) | ✅ Wired | ElevenLabs `text_to_sound_v2`; frontend falls back to pre-baked clips |
| Baby portrait live generation (`/api/baby/portrait`) | ✅ Wired | Gemini image model waterfall; frontend falls back to pre-baked PNGs |
| Officer avatar live generation (`/api/officer/avatar`) | ✅ Wired | Gemini image model waterfall; frontend falls back to pre-baked PNGs |
| Probation-theme music (`/api/music/probation-theme`) | ✅ Wired | Lyria-002 via Vertex AI (JWT service-account); returns WAV; frontend falls back to pre-baked MP3 |
| Veo-3.1 cute-payoff video | ✅ Wired (initiate + poll) | Async 2-step: POST initiates, GET polls. Frontend CSS animation remains fallback. |
