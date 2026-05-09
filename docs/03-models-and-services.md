# Models And Services

## Locked Choices

- Runtime state: Cloudflare Worker (single Worker, no Durable Object yet — that's the next infra step).
- No Convex.
- Officer + Baby + GM text: `gpt-5.5` (OpenAI chat completions with tool calling).
- Partner text per beat: `gemini-3.1-flash-lite` via `/api/partner/line`.
- Realtime partner mic during arguments: `gemini-3.1-flash-live-preview` (default), `gpt-realtime` swap via `VITE_REALTIME_PARTNER_PROVIDER=openai`.
- Officer voice: ElevenLabs TTS by default; browser SpeechSynthesis fallback (`VITE_OFFICER_VOICE_PROVIDER`).
- Music: Lyria-002 via Vertex AI by default ON (`VITE_LIVE_MUSIC=1`); pre-baked MP3 fallback at `public/audio/music/probation-theme.mp3`.
- Baby cry SFX: real recordings from the donateacry public dataset, four categories (`hunger`, `tired`, `discomfort`, `coo`) at `public/audio/baby/`. ElevenLabs `text_to_sound_v2` is the live-generation alternative behind `VITE_LIVE_BABY_SFX=1`.
- Baby visual: 2.5D layered puppet rig at `public/puppets/baby/` (1 canonical rig today, 14 layer PNGs), composited by `src/baby-rig/PuppetCanvas.tsx`.
- Cinematic (cute_payoff + others): Veo-3.1 via Vertex AI; Replicate Seedance/Veo and fal.ai Kling are alternative providers selected per request.
- All live model features have a deterministic fallback.

## Env Defaults

```txt
# Worker vars (wrangler.toml)
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_REALTIME_MODEL=gpt-realtime
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_TEXT_MODEL=gemini-3.1-flash-lite

# Worker secrets (wrangler secret put)
OPENAI_API_KEY=...
GEMINI_API_KEY=...
GOOGLE_API_KEY=...                 # optional alternate for image gen
ANTHROPIC_API_KEY=...              # optional, kept for one-line officer-text swap
ELEVENLABS_API_KEY=...             # baby-sfx + officer-tts
GOOGLE_SERVICE_ACCOUNT_JSON=...    # music (Lyria-002) + cute-payoff (Veo-3.1)
REPLICATE_API_TOKEN=...            # baby-portrait (gpt-image-2) + cinematic
FAL_KEY=...                        # baby-portrait flux-pro/v1.1 + cinematic kling-v3-pro

# Frontend (Vite)
VITE_OFFICER_VOICE_PROVIDER=elevenlabs   # | browser | off
VITE_REALTIME_PARTNER_PROVIDER=gemini    # | openai
VITE_PARTNER_LIVE_TEXT=                  # 1 = call /api/partner/line
VITE_LIVE_BABY_SFX=                      # 1 = call /api/baby/sfx
VITE_LIVE_MUSIC=                         # default ON; 0 to disable
```

Model IDs must be read from config. Do not hard-code provider strings in game logic.

## Service Roles

| Need | Primary | Fallback | Runtime Required |
| --- | --- | --- | --- |
| Session state | `LocalGameTransport` (DO not yet wired) | — | Yes |
| Static app/assets | Worker `[assets]` binding | Local static dev server | Yes |
| Officer text | `gpt-5.5` (`/api/officer`, 7 tools) | Deterministic scripted lines | Optional |
| Officer voice | ElevenLabs TTS (`/api/officer/say`) | Browser `SpeechSynthesis` per-officer profile | Optional |
| Baby agent | `gpt-5.5` (`/api/baby`, 7 consultative tools + `trigger_fallback`) | Pure-function `BabyAgent` in `src/engine/baby-agent.ts` | Optional |
| Partner text per beat | `gemini-3.1-flash-lite` (`/api/partner/line`) | Scripted lines × 4 archetypes in `src/engine/partner-agent.ts` | Optional |
| Partner live voice (arguments only) | Gemini Live `gemini-3.1-flash-live-preview` | OpenAI Realtime `gpt-realtime` swap, then scripted | Optional |
| Baby sounds | donateacry public-dataset MP3s at `public/audio/baby/` | ElevenLabs `text_to_sound_v2` is the live alternative | Bundled |
| Baby image | 2.5D rig at `public/puppets/baby/` | Pre-baked state PNGs in `public/img/baby/` | Bundled |
| Music bed | Lyria-002 via Vertex AI | Pre-baked `public/audio/music/probation-theme.mp3` | Optional |
| Cute payoff | Veo-3.1 via Vertex AI (LRO) | CSS animation | Optional |

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

