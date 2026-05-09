# Full Demo Loop

## Moment Spine

The spine is fixed for demo reliability. The details inside each beat are dynamic through seeded baby and partner rolls.

| Beat | Phase | Required Interaction | System Behavior |
| --- | --- | --- | --- |
| `home` | `home` | Start New Game or Join Room | Creates a seeded local session. Join Room is URL/session theater first. |
| `probation_splash` | `intake` | Begin | Unlocks audio and shows "Welcome to Probation." |
| `officer_intro` | `intake` | Continue / answer | Random officer appears. Muppet scene if available; static fallback otherwise. |
| `photo_intake` | `intake` | Upload/webcam/skip | Photo is client-memory theater. If one person, ask for partner photo or system match. |
| `verification_games` | `generation` | Answer checks | Night-shift, support, and panic-plan checks while progress advances. |
| `generation_progress` | `generation` | Wait / complete checks | Uses bundled assets now; generated media can replace later. |
| `ominous_warning` | `generation` | Continue | Officer warns that care labor and shirking are tracked. |
| `baby_roll` | `reveal` | Name baby | Rolls gender, baby traits, partner traits, and officer flavor. |
| `baby_arrival` | `reveal` | Continue | "Your child has arrived." Partner reacts in character. |
| `first_calm` | `gameplay` | Observe / act | Baby begins initialized with randomized needs. |
| `first_cry` | `gameplay` | Try actions | Dominant need pressure triggers cry, baby audio, and visual state. |
| `discovery_soothing` | `gameplay` | Feed/rock/sing/shush/hold/wait | Correct response depends on hidden traits; wrong actions can worsen mood. |
| `time_jump_evening` | `gameplay` | Continue | Time accelerates; baby cycles through sleep/hunger. |
| `night_cry` | `night` | Get up / shirk / wake partner / wait | Screen darkens, partner asleep, cry audio starts. |
| `shirk_or_wake` | `night` | Choose responsibility path | Ledger updates; partner resentment/fatigue responds. |
| `argument_start` | `argument` | Get up / comfort / shirk | Partner argument line appears; Realtime can replace later. |
| `argument_resolution` | `argument` | Resolve shift | Player or partner takes the night shift. |
| `night_soothe` | `night` | Soothe baby | Baby still needs care after the argument. |
| `cute_payoff` | `cute` | Continue | Placeholder image/CSS moment now; generated clip later. |
| `verdict` | `verdict` | Continue | Officer returns with verdict. |
| `debrief_card` | `debrief` | Replay/share | Shows baby traits, player archetype, partner dynamic, and ledger. |

## Demo Timing

Default timing target:

- Full run: 2-3 minutes.
- `realSecondsPerGameHour`: configurable.
- Night sequence can be forced by `skip_to` during demos.

## Required Demonstrations

- Voice/sing affordance, with button fallback.
- Feeding/rocking/shushing/holding as different care choices.
- Shirking tracked in ledger.
- Partner response changes when player shirks or wakes them.
- Argument can resolve.
- Debrief names the player behavior.

