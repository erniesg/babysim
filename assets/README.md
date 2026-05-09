# Assets

Binary assets ship under `public/` (served by the Cloudflare Worker `[assets]` binding):

- `public/img/baby/{settled,drowsy,hungry,fussy,crying,sleep}.png` — photoreal baby state previews.
- `public/img/officer-{ernest,bern,crumb}-{strict,warm,skeptical,delighted}.png` — officer puppet portraits.
- `public/audio/baby/{hunger,tired,discomfort,coo}.mp3` — pre-baked baby cry SFX (live alternative: `/api/baby/sfx`).
- `public/audio/music/probation-theme.mp3` — pre-baked Lyria theme (live alternative: `/api/music/probation-theme`).
- `public/audio/sfx/snap.mp3` — finger-snap one-shot.
- `public/puppets/baby/puppet.json` + `public/puppets/baby/layers/*.png` — 2.5D layered baby puppet rig.
- `public/video/baby/{state}-idle.mp4` and `public/video/baby/{from}-to-{to}.mp4` — Seedance/Veo state-transition clips (optional; missing files fall through to PNGs).

Placeholder asset paths are defined in `contracts/assets.ts`.

Asset generation scripts live in `scripts/`:

- `gen:baby-sounds` — Gemini 3.1 Flash TTS for cry pack
- `gen:baby-clips` — Replicate Seedance 2.0 / Veo-3.1-fast for state-transition video clips
- `gen:officer-avatar` — Replicate `openai/gpt-image-2` for officer puppet portraits
- `gen:partner-avatars` — Replicate `openai/gpt-image-2` for partner archetype portraits
