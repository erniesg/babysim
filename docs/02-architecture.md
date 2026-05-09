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

The GM Agent is a future LLM-assisted layer. It can propose narration, escalation, or beat transitions through `DirectorCommand`s. It cannot mutate state directly.

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

Final runtime:

- One Worker serving static assets.
- `POST /api/session` creates a session.
- `GET /api/session/:id/ws` upgrades to `GameSessionDO`.
- `POST /api/ephemeral-key` optionally mints Realtime key.
- `POST /api/debrief` optionally calls `gpt-5.5`.

No Convex for this demo.

## Durable Object Responsibilities

`GameSessionDO`:

- Stores `GameState`.
- Applies the same reducer as local mode.
- Broadcasts `ServerMessage`.
- Stores event log.
- Handles reconnect by sending latest state.
- Supports `panic` and `skip_to`.
- Later supports a second player in the same session.

