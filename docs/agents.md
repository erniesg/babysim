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
POST /api/baby                             → gpt-5.5 → { tools: [{name, args}] } (play_audio / set_caption / trigger_fallback)
POST /api/gm                               → gpt-5.5 → { tools: [{name, args}], rejected: [...] } (all DirectorCommand variants; enter_beat BEAT_GRAPH-validated)
POST /api/realtime/gemini/token            → ephemeral token (or master-key fallback)
POST /api/realtime/openai/token            → OpenAI Realtime client_secret
```

All endpoints CORS-permissive (`*`) for browser direct calls. Every request gets a UUID logged on entry, upstream status + body head logged on response, errors include `upstreamStatus` + `detail` so failures are diagnosable from `wrangler tail` or Cloudflare's observability stream.

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
| Veo-3.1 cute-payoff video | ❌ Not started | Currently CSS animation; pre-gen pipeline already exists for music+images |
