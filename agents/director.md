# Director Runtime

The Director Runtime is the authoritative orchestration layer.

## Owns

- Beat graph
- Current phase and beat
- Timers
- Allowed actions
- Audio commands
- Fallbacks
- Event log
- Reducer validation
- Render state emission

## Does Not Own

- Provider prompts
- Raw mic audio
- Direct media generation
- Unvalidated LLM decisions

## Rule

All state changes must go through reducer-validated events or commands. Even future LLM Director behavior must emit `DirectorCommand`s that can be rejected.

## First Implementation

Use deterministic code and the beat graph. Do not call any model.

