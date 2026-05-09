# Architecture

## Layers

### Director Runtime

The Director Runtime is deterministic and authoritative. It owns:

- Beat graph
- Phase and beat transitions
- Timers
- Allowed actions
- Audio commands
- Fallbacks
- Event log
- Reducer validation

It receives `GameEvent`s and emits `RenderState`.

### GM / Director Agent

The GM Agent is a wired LLM-assisted layer (`/api/gm`, `gpt-5.5`). It can propose narration, escalation, or beat transitions through `DirectorCommand`s. It cannot mutate state directly — the deterministic `DirectorRuntime` remains authoritative and rejects invalid commands.

Reducer validation rejects invalid commands.

### Baby Agent

The Baby Agent owns:

- Hidden baby traits
- Need ticks
- Cry triggers
- Action effectiveness
- Visual state selection
- Trait discovery cues

### Partner Agent

The Partner Agent owns:

- Partner archetype
- Fatigue
- Mood
- Resentment
- Helping probability
- Argument lines and escalation

### Officer Agent

The Officer Agent owns:

- Intake framing
- Ominous warning
- Verdict tone
- Officer line selection

## Transport

The frontend talks to a transport interface:

```ts
interface GameTransport {
  send(message: ClientMessage): void;
  subscribe(handler: (message: ServerMessage) => void): () => void;
}
```

Implementations:

- `LocalGameTransport`: first build, browser-only.
- `WebSocketGameTransport`: later build, talks to `GameSessionDO`.

## Cloudflare Runtime

Current runtime (single Worker, no Durable Object yet):

- Static SPA served from the `[assets]` binding (`./dist`).
- `GET  /api/healthz` — secrets + active models.
- `POST /api/officer` — gpt-5.5 with 7 tools (say / set_expression / play_gesture / warn_player / start_challenge / advance_phase / request_player_input).
- `POST /api/officer/say` — ElevenLabs TTS.
- `POST /api/officer/avatar` — Replicate `gpt-image-2`.
- `POST /api/baby` — gpt-5.5 with the consultative baby tool surface (`play_audio`, `set_caption`, `set_visual_state`, `set_mood_delta`, `set_need_delta`, `request_attention`, `acknowledge_action`, plus `trigger_fallback`).
- `POST /api/baby/sfx` — ElevenLabs `text_to_sound_v2`.
- `POST /api/baby/portrait` — Replicate `gpt-image-2`.
- `POST /api/gm` — gpt-5.5 emitting `DirectorCommand[]`; `enter_beat` server-side validated against `BEAT_GRAPH`.
- `POST /api/partner/line` — Gemini Flash Lite text per beat (`say_line` tool). Behind `VITE_PARTNER_LIVE_TEXT=1`.
- `POST /api/music/probation-theme` — Lyria-002 via Vertex AI.
- `POST /api/cute-payoff/video` and `GET /api/cute-payoff/video?operation=...` — Veo-3.1 LRO (initiate + poll).
- `POST /api/cinematic` and `GET /api/cinematic?operation=...` — Replicate cinematic (Seedance/Veo behind `provider`).
- `POST /api/realtime/gemini/token` and `POST /api/realtime/openai/token` — ephemeral-key minting for the realtime partner mic (active during `argument_start` + `argument_resolution`).

No Convex for this demo.

## Durable Object Responsibilities (NOT YET WIRED)

`GameSessionDO` is planned but not built. When introduced it will:

- Store `GameState`.
- Apply the same reducer as local mode.
- Broadcast `ServerMessage`.
- Store the event log.
- Handle reconnect by sending the latest state.
- Support `panic` and `skip_to`.
- Later support a second player in the same session.

Until then, all state lives in the browser via `LocalGameTransport` and "Join a Room" is a stub (alerts only).

