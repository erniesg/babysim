# Acceptance Tests

## Core Demo

- New game rolls different baby, partner, and officer profiles.
- Same seed reproduces the same roll.
- Baby needs tick over time and derive mood.
- Hunger, sleepiness, discomfort, connection, and health affect visual state.
- Correct soothing action can calm baby.
- Wrong action can fail or worsen mood.
- Voice/sing path has button fallback.
- Shirking changes ledger and partner response.
- Wake partner can help or trigger argument.
- Night argument always resolves.
- Panic stops all audio and timers.
- Full run reaches debrief in 2-3 minutes.
- Demo works without mic, OpenAI, Gemini, Convex, or generated videos.

## Backend Parity

- `LocalGameTransport` and `WebSocketGameTransport` produce equivalent visible behavior.
- `GameSessionDO` sends latest state on reconnect.
- `panic` works through the DO.
- `skip_to` works for demo recovery.

## Model Fallbacks

- `gpt-5.5` failure returns templated debrief.
- Realtime failure uses scripted partner scene.
- Gemini media absence uses bundled placeholder assets.
- GM Agent invalid command is rejected by reducer validation.

