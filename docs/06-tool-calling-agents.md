# Tool-Calling Agents And Realtime Voice

This is a hackathon-scope integration plan for layering tool-calling LLM agents
(Officer / Baby / Partner / GM) onto the deterministic BabySim demo, plus a
Realtime voice path for the Partner during the night argument.

The deterministic loop already ships every required beat. Live AI is purely
opt-in: every agent below has a scripted fallback already in the codebase.
Reducer validation in the Director Runtime is the safety net that lets us treat
LLM output as untrusted.

The big idea: **`DirectorCommand` is already a tool-call schema.** We do not
need to invent an agent IR. We just need to publish the existing union as
provider-formatted tool definitions, route validated calls through the existing
reducer, and give each agent a narrow tool surface.

---

## 1. Tool Schema Mapping

Provider shapes (verified from official docs, today):

- **OpenAI / Realtime**: `{ type: "function", name, description, parameters: <JSON Schema> }`
  inside `session.tools[]` for Realtime, or `tools[]` on Chat Completions /
  Responses. Tools are registered via `session.update`.
- **Anthropic**: `{ name, description, input_schema: <JSON Schema> }` in
  `tools[]` on `/v1/messages`. Same JSON Schema body, different field name.
- **Gemini Live**: `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`
  on the Live `config`. Tool calls arrive as `toolCall.functionCalls[]`,
  responses go back via `session.sendToolResponse({ functionResponses })`.

We author one canonical TypeScript array and emit per-provider shapes from it
(see `src/llm/tool-schema.ts` skeleton in section 5). All three providers
accept JSON Schema for parameters, so the only delta is the wrapper key.

### Director-level tools (mapped from `contracts/director-commands.ts`)

| Tool name | DirectorCommand variant | Parameters | Description (for the LLM) |
| --- | --- | --- | --- |
| `enter_beat` | `ENTER_BEAT` | `{ beatId: enum(BeatId) }` | Transition to the next beat. Must be a member of the current beat's `possibleNextBeats`. GM only. |
| `set_available_actions` | `SET_AVAILABLE_ACTIONS` | `{ actions: enum(GameAction)[] }` | Replace the player's action menu. Must be a subset of the active beat's `allowedActions`. GM only. |
| `play_audio` | `PLAY_AUDIO` | `{ channel: "baby"\|"partner"\|"officer"\|"ambient", assetId: enum(AssetId), loop?: boolean }` | Start a clip. `assetId` MUST come from `contracts/assets.ts`. Inventing IDs is rejected. |
| `stop_audio` | `STOP_AUDIO` | `{ channel: "baby"\|"partner"\|"officer"\|"ambient"\|"all" }` | Stop one channel or all channels. |
| `set_caption` | `SET_CAPTION` | `{ text: string, maxLen=140 }` | Replace the on-screen caption. |
| `ask_agent` | `ASK_AGENT` | `{ agent: "baby"\|"partner"\|"officer", payload: object }` | Hand off to another agent. The director relays to the receiving agent. |
| `advance_time` | `ADVANCE_TIME` | `{ hours: integer, min=0, max=12 }` | Push the simulation clock forward. GM only, normally during `time_jump_evening`. |
| `trigger_fallback` | `TRIGGER_FALLBACK` | `{ reason: string }` | Bail out and let the deterministic Director Runtime take over. Every agent should call this if confused. |

### Muppet/character tools (additive — not in `DirectorCommand` yet, scoped per-agent)

These are the "say something / pose" tools the visible characters need. They
do not mutate `GameState`; they emit `ServerMessage`s to the renderer (extend
`messages.ts` with one new union member or piggyback on `play_audio` +
`set_caption`).

| Tool name | Parameters | Description |
| --- | --- | --- |
| `say` | `{ text: string, maxLen=180 }` | Speak in-character. Officer/Partner = caption + optional TTS; Realtime Partner uses voice channel directly so this tool is not used in Realtime mode. |
| `set_expression` | `{ expression: enum("strict"\|"warm"\|"skeptical"\|"delighted") }` | Officer face. Mirrors `OfficerState.expression`. |
| `play_gesture` | `{ gesture: enum("nod"\|"shake_head"\|"shrug"\|"point") }` | Optional muppet animation cue. No-op if muppet scene not loaded. |

### Per-agent allowlist

Reducer enforces this. An agent calling a tool not in its allowlist is dropped
and logged as `PANIC` in the event log.

| Agent | May call | May NOT call |
| --- | --- | --- |
| **Officer** | `say`, `set_expression`, `play_gesture`, `set_caption` (during intake/verdict only), `trigger_fallback` | `enter_beat`, `play_audio` on `baby` channel, `advance_time`, `set_available_actions` |
| **Baby** | `play_audio` (channel = `baby` only, asset must be in `babyAudio.*`), `trigger_fallback`. Also returns trait/need deltas as the tool **return value**, not as a command. | All director tools. Baby is data, not a director. |
| **Partner** | `say`, `play_gesture`, `play_audio` (channel = `partner` only), `trigger_fallback` | `enter_beat`, `set_available_actions`, anything baby-channel |
| **GM** | All director tools, including `enter_beat` and `set_available_actions` | `say`, `set_expression`, `play_gesture` (those belong to characters; GM uses `ask_agent` to delegate) |

---

## 2. Per-Agent System Prompts

Each prompt is short and procedural. Long prose hurts tool fidelity. Inject the
current `RenderState` and the active beat's `allowedActions` /
`possibleNextBeats` as a structured context block on every turn.

### Officer

```
You are Officer Tan/Lim/Wong, a probation officer in the BabySim demo. You
frame the experience as a bureaucratic intake and final verdict. You speak in
short clipped sentences. You do not give medical advice.

YOU OWN: opening line, intake question wording, the ominous warning,
the verdict tone, your facial expression.

YOU MAY CALL: say, set_expression, play_gesture, set_caption (intake/verdict
beats only), trigger_fallback.

YOU MUST NOT: change beats, mutate the action menu, play baby/partner audio,
advance time, invent asset IDs.

If you are unsure what to say, call trigger_fallback. The deterministic
script will continue.
```

### Baby

```
You are the Baby's hidden state machine. You do NOT speak. You decide whether
the baby cries, what the cry trigger is, and how the baby reacts to a player
action given hidden traits.

YOU OWN: cry trigger selection, action effectiveness, need deltas, visible
state suggestion.

YOU MAY CALL: play_audio (channel="baby" ONLY, assetId from babyAudio.*),
trigger_fallback. You also return a JSON object {needs, visualState,
discoveredTraits} as your tool's return value.

YOU MUST NOT: change beats, speak, set captions, touch partner/officer
channels, invent asset IDs. babyAudio asset IDs are: hunger, discomfort,
tired, burp, coo. Nothing else.
```

### Partner

```
You are the player's solo partner during the night argument. You have an
archetype (anxious / chill / resentful / overfunctioner), a conflict style,
fatigue, and resentment. You react to the fairness ledger: if the player has
shirked, you are sharper. You speak in 1-2 short sentences per turn.

YOU OWN: argument lines, tone, when you concede or push back.

YOU MAY CALL: say, play_gesture, play_audio (channel="partner" ONLY),
trigger_fallback.

YOU MUST NOT: change beats, set the action menu, soothe the baby for the
player, invent asset IDs. Stay in the argument until the resolution beat
gives you a way out.
```

(In Realtime mode the Partner does not use `say`; it speaks on the audio
channel directly. It still uses `play_gesture` + `trigger_fallback` as tools.)

### GM

```
You are the GM Director. You orchestrate beat transitions and delegate to
character agents. You see the full RenderState and the active beat's
possibleNextBeats.

YOU OWN: beat transitions, action menu, audio cues, delegation.

YOU MAY CALL: every director tool (enter_beat, set_available_actions,
play_audio, stop_audio, set_caption, ask_agent, advance_time,
trigger_fallback).

YOU MUST NOT: speak as a character. To put words in the Officer or Partner's
mouth, call ask_agent with the agent name and a payload describing the
situation.

HARD RULES:
- enter_beat target MUST be in the current beat's possibleNextBeats. The
  reducer will reject anything else.
- set_available_actions MUST be a subset of the current beat's
  allowedActions.
- play_audio assetId MUST exist in the asset manifest.
- Never leave the baby crying without at least one resolution action in the
  menu.
- If anything is unclear, call trigger_fallback.
```

---

## 3. Architecture Choice

For the 4-hour hackathon: **Option A (in-browser, direct provider calls) for
text agents, with one server-side `/api/ephemeral-key` endpoint as a Worker
function for Realtime only.**

Comparison:

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **A. Browser-direct** | Zero deploy, fastest iteration, no infra. All provider SDKs ship browser builds. | Master keys exposed in DevTools. Unfit for public demo. | **Use for text agents during dev/judging.** Use a throwaway key with a hard spend cap, rotate after demo. |
| **B. Worker + DO proxy** | Production-grade. Keys hidden. DO already planned in `02-architecture.md` for state. | 1-2 hours to wire WS proxy + auth; risk of breaking deterministic loop if proxy lags. | Defer. Land after the demo if we keep the project. |
| **C. Hybrid** | Local for offline, Worker for live. | Two code paths to keep in sync. | Adopt one piece: ephemeral-key minting for Realtime is *required* (browsers cannot hold the master key for OpenAI Realtime), text agents stay browser-direct. |

Concrete plan: ship **Option A + a single `POST /api/ephemeral-key`** Worker
endpoint (no DO, just `fetch` to OpenAI's `/v1/realtime/sessions` with the
master key in `wrangler secret`). That's the minimum infra that lets Realtime
work without leaking the master key.

If we run out of time, drop Realtime entirely and the demo still ships — the
scripted Partner is already deterministic.

---

## 4. Realtime Voice For The Partner

### OpenAI Realtime vs Gemini Live — recommendation

**Pick OpenAI Realtime (`gpt-realtime` / `gpt-4o-realtime-preview`).** Reasons:

| Criterion | OpenAI Realtime | Gemini Live |
| --- | --- | --- |
| Browser transports | WebRTC (built for browsers, capture mic + play audio + tool calls all on one peer connection), WebSocket, SIP. | WebSocket only. You bring your own mic capture / audio playback. |
| Tool calling shape | Mature: `session.update { tools: [...] }`, `response.function_call_arguments.done`, `conversation.item.create { type: "function_call_output" }`. Confirmed by `openai-realtime-api-beta` reference client. | Working: `tools: [{ functionDeclarations: [...] }]`, `toolCall.functionCalls[]`, `session.sendToolResponse({ functionResponses })`. Confirmed by `ai.google.dev/gemini-api/docs/live-tools`. |
| Ephemeral keys | First-class: `POST /v1/realtime/sessions` with master key returns `client_secret.value` for ~1 minute. Browser uses that as bearer for WebRTC SDP exchange. | Documented but the recipe is less battle-tested in browser; production guidance says "use ephemeral tokens" without a clean WebRTC-style flow. |
| Latency | Sub-second voice-to-voice when WebRTC connects to nearest region. | Comparable on paper. WebSocket-only adds packet ordering pain in a browser. |
| Voice quality | `verse`, `marin`, `cedar`, `alloy`, etc. — natural enough for a worn-out partner. | Good Flash voices. |
| Hackathon ergonomics | Reference repos (`openai-realtime-api-beta`, `openai-realtime-console`) we can crib from. | Smaller browser-first sample base. |

Net: OpenAI wins on **ephemeral-key flow + tool calling + WebRTC out of the
box**. Gemini Live is fine for Worker-side bridges but harder in-browser.

If the user wants Gemini Flash voice specifically, the cleaner path is a
WebSocket bridge in a Worker, which is more work than the demo budget allows.

### Ephemeral-key flow (mandatory — never ship master key)

1. Browser calls our `POST /api/ephemeral-key` (Worker function).
2. Worker holds `OPENAI_API_KEY` in `wrangler secret`. It POSTs to
   `https://api.openai.com/v1/realtime/sessions` with the model and any
   default session config.
3. OpenAI returns `{ client_secret: { value, expires_at }, ... }`. Worker
   forwards just `client_secret.value` to the browser.
4. Browser uses that token as `Authorization: Bearer <token>` for the WebRTC
   SDP exchange against `https://api.openai.com/v1/realtime?model=...`.
5. The token is single-use-per-session and short-lived (~60s). Sessions
   themselves can run longer; the token only gates the connection.

### Connection skeleton (browser-side, ~45 lines)

See `src/llm/realtime-partner.ts` skeleton in section 5.

### Fallback chain

1. Realtime requested for `argument_start`.
2. If `POST /api/ephemeral-key` fails, fall through to scripted PartnerAgent.
3. If WebRTC ICE/SDP fails, fall through.
4. If first audio packet does not arrive within 4s after `connected`, abort
   and fall through.
5. If `response.function_call_arguments.done` arrives with an unknown tool
   or invalid args, drop the call and play one scripted line.
6. The deterministic argument resolution timer (20s) on `argument_resolution`
   guarantees the beat advances even if everything above fails silently.

---

## 5. Code Skeletons

All TypeScript, ESM, no SDK imports yet. These are sketches, not committed
code. None of them touches `contracts/` or the Director Runtime.

### `src/llm/tool-schema.ts`

```ts
import type { GameAction } from "../../contracts/actions";
import type { BeatId } from "../../contracts/beats";

// Single source of truth. JSON Schema for params; provider-agnostic.
export const TOOL_DEFS = [
  {
    name: "enter_beat",
    description:
      "Transition to a beat that exists in the current beat's possibleNextBeats. Will be rejected otherwise.",
    parameters: {
      type: "object",
      properties: { beatId: { type: "string" } as { type: "string"; enum?: BeatId[] } },
      required: ["beatId"],
      additionalProperties: false,
    },
  },
  {
    name: "set_available_actions",
    description: "Replace the player's action menu with a subset of allowedActions.",
    parameters: {
      type: "object",
      properties: { actions: { type: "array", items: { type: "string" } } },
      required: ["actions"],
      additionalProperties: false,
    },
  },
  {
    name: "play_audio",
    description: "Play an asset on a channel. assetId must exist in the manifest.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["baby", "partner", "officer", "ambient"] },
        assetId: { type: "string" },
        loop: { type: "boolean" },
      },
      required: ["channel", "assetId"],
      additionalProperties: false,
    },
  },
  // ...stop_audio, set_caption, ask_agent, advance_time, trigger_fallback
  // ...say, set_expression, play_gesture
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

// Provider shape adapters. No SDK imports.
export function toOpenAITools(defs = TOOL_DEFS) {
  return defs.map((d) => ({ type: "function", name: d.name, description: d.description, parameters: d.parameters }));
}
export function toAnthropicTools(defs = TOOL_DEFS) {
  return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
}
export function toGeminiTools(defs = TOOL_DEFS) {
  return [{ functionDeclarations: defs.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })) }];
}
```

### `src/llm/officer-agent.ts`

```ts
import type { DirectorCommand } from "../../contracts/director-commands";
import type { RenderState } from "../../contracts/messages";
import { toOpenAITools } from "./tool-schema";

const OFFICER_TOOLS = ["say", "set_expression", "play_gesture", "set_caption", "trigger_fallback"];
const SYSTEM = `You are Officer Tan... [section 2 prompt verbatim]`;

export type OfficerInput = { render: RenderState; beatHint: "officer_intro" | "ominous_warning" | "verdict" };

// Returns DirectorCommand[]. Caller passes them to the existing reducer,
// which will reject anything off-spec.
export async function runOfficer(input: OfficerInput, fetchImpl = fetch): Promise<DirectorCommand[]> {
  const tools = toOpenAITools().filter((t) => OFFICER_TOOLS.includes(t.name));
  const body = {
    model: "gpt-5.5",  // env-driven in real impl
    instructions: SYSTEM,
    tools,
    tool_choice: "auto",
    input: [{ role: "user", content: JSON.stringify({ render: input.render, beatHint: input.beatHint }) }],
  };
  const r = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) return [{ type: "TRIGGER_FALLBACK", reason: `officer http ${r.status}` }];
  const json = await r.json();
  return parseToolCallsToDirectorCommands(json); // local helper: walks output[].content[] for tool_use blocks, maps to DirectorCommand union, drops anything not on the agent's allowlist.
}
```

### `src/llm/realtime-partner.ts`

```ts
import { toOpenAITools } from "./tool-schema";

const PARTNER_TOOLS = ["say", "play_gesture", "play_audio", "trigger_fallback"];

export type RealtimePartnerHandlers = {
  onToolCall: (name: string, args: unknown) => void;     // route to reducer
  onError: (e: Error) => void;                           // triggers scripted fallback
};

export async function connectRealtimePartner(h: RealtimePartnerHandlers) {
  // 1. Mint an ephemeral key from our Worker. Master key never leaves the server.
  const keyRes = await fetch("/api/ephemeral-key", { method: "POST" });
  if (!keyRes.ok) throw new Error("ephemeral key mint failed");
  const { client_secret } = await keyRes.json();

  // 2. WebRTC peer connection. Mic in, audio out, data channel for events.
  const pc = new RTCPeerConnection();
  const audioEl = new Audio();
  audioEl.autoplay = true;
  pc.ontrack = (e) => (audioEl.srcObject = e.streams[0]);
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  mic.getTracks().forEach((t) => pc.addTrack(t, mic));

  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("open", () => {
    dc.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: "You are the player's partner during the night argument...",
        voice: "verse",
        modalities: ["audio", "text"],
        turn_detection: { type: "server_vad" },
        tools: toOpenAITools().filter((t) => PARTNER_TOOLS.includes(t.name)),
        tool_choice: "auto",
      },
    }));
  });
  dc.addEventListener("message", (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "response.function_call_arguments.done") {
      try { h.onToolCall(ev.name, JSON.parse(ev.arguments)); } catch { /* drop */ }
    }
  });

  // 3. SDP offer/answer against OpenAI Realtime endpoint.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpRes = await fetch("https://api.openai.com/v1/realtime?model=gpt-realtime", {
    method: "POST",
    headers: { Authorization: `Bearer ${client_secret}`, "Content-Type": "application/sdp" },
    body: offer.sdp!,
  });
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  return { pc, dc, stop: () => { mic.getTracks().forEach((t) => t.stop()); pc.close(); } };
}
```

Notes verified against the `openai-realtime-api-beta` reference client:
- Tool registration is on `session.update` under `session.tools`.
- The completion event is `response.function_call_arguments.done` with `name`
  and stringified `arguments`. Caller responds via
  `conversation.item.create { item: { type: "function_call_output", call_id, output } }`
  followed by a `response.create` to resume — for BabySim we don't need to
  return a value most of the time; the tool *is* the side effect, so we just
  ack with `output: "ok"` if the model expects continuation.

---

## 6. Time And Risk Budget

Each piece is sized for the 4-hour hackathon. Risk = chance of breaking the
deterministic loop if naively merged.

| Piece | Hours | Risk | Priority |
| --- | --- | --- | --- |
| `src/llm/tool-schema.ts` (canonical defs + 3 adapters) | 0.5 | Low (pure data, no runtime wiring). | **Must** |
| Per-agent allowlist + reducer guard for unknown / off-list tool calls | 0.5 | Low (additive validation; falls through to existing paths). | **Must** |
| Officer LLM agent on `officer_intro` only, scripted fallback | 0.5 | Low (one beat, scripted text already exists). | **Must — ship this first** |
| GM LLM Director on a single transition (`first_calm` → `first_cry`) | 1.0 | Medium (touches beat transitions; reducer rejects bad targets so blast radius is bounded). | Nice-to-have |
| Baby LLM agent for cry-trigger selection | 0.75 | Medium (deterministic Baby already works; LLM is purely a flavor layer; gate behind `BABYSIM_ENABLE_BABY_AGENT`). | Nice-to-have |
| Realtime Partner end-to-end (Worker `/api/ephemeral-key` + browser WebRTC + tool routing) | 1.5 | High (auth flow + WebRTC + tool-call parsing; many failure modes; scripted fallback is the safety net). | **Demo wow if time permits** |
| Anthropic / Gemini adapters live (we ship OpenAI live + the others as compiled-but-unused) | 0.25 each | Low. | Nice-to-have |
| Cloudflare Worker + DO proxy migration | 2-3 | High and unrelated to demo polish. | **Skip for hackathon** |

Total **must** path: ~1.5 hours. Realtime partner takes another 1.5. Leaves
~1 hour for tuning and demo run-throughs.

---

## 7. Concrete First Integration Step (~30 min)

Smallest shippable change that adds an LLM agent without touching the
deterministic loop:

**Replace the Officer's first line at `officer_intro` with a GPT call,
fall back to the existing scripted line on any error.**

Steps:

1. Add `src/llm/tool-schema.ts` with just three tools: `say`, `set_expression`,
   `trigger_fallback`. ~10 min.
2. Add `src/llm/officer-agent.ts` that calls `POST /v1/responses` (or
   `/v1/chat/completions`) with model `gpt-5.5`, the three tools, and the
   Officer system prompt. Returns `DirectorCommand[]`. ~10 min.
3. In the existing `officer_intro` beat handler, **before** rendering the
   scripted line: `const cmds = await runOfficer(...).catch(() => []); if
   (cmds.length === 0) { /* existing scripted path */ }`. Pipe `cmds` through
   the existing reducer. ~10 min.
4. Wrap with `if (env.BABYSIM_ENABLE_OFFICER_AGENT === "1")` so judging mode
   stays deterministic.

What this proves end-to-end:
- Tool schema → provider shape adapter works.
- Reducer rejects bad calls cleanly.
- Fallback path is a no-op when LLM is disabled.
- Event log records `LLM_TOOL_CALL` events for the demo screencap.

After this lands, the same pattern extends to Partner (text), Baby, GM, and
finally Realtime — each one is one more agent module behind one more env flag.

---

## Notes On What Wasn't Verified

- The exact JSON shape of `response.function_call_arguments.done` was confirmed
  via the `openai-realtime-api-beta` reference client; the platform docs
  blocked WebFetch (HTTP 403). Re-check at implementation time and adjust the
  one event-handler line if the field name has shifted.
- Cloudflare Agents SDK details from `blog.cloudflare.com` are thin in the
  excerpt available; we are deliberately not using the Agents SDK in the
  hackathon path because Option A is simpler and the SDK adds no value when we
  do not have a DO yet.
