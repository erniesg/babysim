# Models And Services

## Locked Choices

- Runtime state: Cloudflare Worker + Durable Object.
- No Convex.
- OpenAI text/GM/debrief: `gpt-5.5`.
- OpenAI Realtime partner: env-configured and optional.
- Gemini generation stack: Gemini `3.1` family where available.
- Baby sounds: Gemini TTS/audio pre-generation, bundled.
- Baby image animation states: pre-generated, bundled.
- All live model features are optional.

## Env Defaults

```txt
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_REALTIME_MODEL=gpt-realtime
GEMINI_TEXT_MODEL=gemini-3.1
GEMINI_TTS_MODEL=gemini-3.1
GEMINI_IMAGE_MODEL=gemini-3.1
GEMINI_VIDEO_MODEL=veo-3.1
BABYSIM_ENABLE_GM_AGENT=0
BABYSIM_ENABLE_REALTIME_PARTNER=0
BABYSIM_ENABLE_MODEL_DEBRIEF=0
BABYSIM_ENABLE_GENERATION=0
```

Model IDs must be read from config. Do not hard-code provider strings in game logic.

## Service Roles

| Need | Primary | Fallback | Runtime Required |
| --- | --- | --- | --- |
| Session state | `GameSessionDO` | `LocalGameTransport` | Yes |
| Static app/assets | Worker assets | Local static dev server | Yes |
| GM/debrief text | `gpt-5.5` | Deterministic/template output | Optional |
| Partner live voice | OpenAI Realtime | Scripted partner lines | Optional |
| Baby sounds | Gemini TTS/audio pre-generation | Existing bundled clips | No |
| Baby image states | Pre-generated assets | CSS placeholder | Bundled |
| Reveal/cute video | Gemini/Veo-generation later | CSS/image animation | Optional |

## Runtime Rule

The judging demo must run with all model flags disabled.

Live AI can improve the experience, but it must not be required for:

- first cry
- soothing discovery
- night argument
- verdict
- debrief

## Generation Rule

Generated media is produced before or during idle/generation beats, then bundled or swapped in. Gameplay never blocks on generation.

