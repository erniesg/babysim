# GM Agent

The GM Agent is a future LLM-assisted layer for narration, escalation, and beat selection.

## Model

Default text model: `gpt-5.5`, read from `OPENAI_TEXT_MODEL`.

## Allowed Output

The GM may emit only validated `DirectorCommand`s:

- `ENTER_BEAT`
- `SET_AVAILABLE_ACTIONS`
- `PLAY_AUDIO`
- `STOP_AUDIO`
- `SET_CAPTION`
- `ASK_AGENT`
- `ADVANCE_TIME`
- `TRIGGER_FALLBACK`

## Guardrails

- Must choose only valid beats from the current beat's `possibleNextBeats`.
- Must not mutate `GameState` directly.
- Must not invent asset IDs outside the manifest.
- Must preserve fallback paths.
- Must never leave the baby crying without available resolution actions.

## First Implementation

Do not implement live GM in the first loop. Use deterministic Director Runtime.

