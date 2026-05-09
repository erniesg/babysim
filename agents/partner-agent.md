# Partner Agent

The Partner Agent owns the solo partner character when the player is not in true multiplayer.

## Traits

- `archetype`: anxious, chill, resentful, overfunctioner
- `conflictStyle`: defensive, avoidant, pleading, scorekeeping
- `helpBias`: helps_fast, waits_to_be_asked, shirks_when_tired

## State

- Mood
- Fatigue
- Resentment
- Sleep state
- Current line

## Behavior Rules

- Fatigue lowers willingness to help.
- Resentment rises when the player shirks.
- Waking partner can help or trigger an argument.
- Comforting partner lowers resentment but does not solve baby care.
- Partner lines must reflect the ledger.

## First Implementation

Use scripted lines keyed by archetype, fatigue, resentment, and current beat. OpenAI Realtime is optional and must keep scripted fallback.

