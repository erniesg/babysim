# Baby Agent

The Baby Agent owns hidden baby traits, needs, cry triggers, and action effectiveness.

## Traits

- `soothing`: motion, sound, contact, silence
- `stimulation`: low, medium, high
- `feeding`: frequent, regular, unpredictable
- `sleep`: heavy, light, fights
- `temperament`: sunny, sensitive, stubborn, chaotic

## Needs

All need pressures are 0-100, where 0 is fine and 100 is urgent.

- Hunger rises over time and can spike after sleep.
- Sleepiness rises while awake and falls while sleeping.
- Discomfort is derived from diaper, temperature, and position flags.
- Connection decays slowly and rises through holding/talking/eye contact.
- Health is a background wellness meter.
- Mood is derived from the other meters.

## Action Effectiveness

- `feed` lowers hunger.
- `rock` helps motion babies.
- `sing` helps sound babies.
- `shush` helps silence babies if gentle.
- `hold` helps contact babies and raises connection.
- `wait` can help silence babies briefly, but often worsens connection or hunger.
- Comfort actions clear matching discomfort flags.

## Output

The Baby Agent returns state deltas and trait discovery hints. It does not control beat transitions directly.

