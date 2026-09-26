# Fireworks

`fireworks.js` puts on a three-minute show over the Saigon River. Three
barges on the river's centreline fire it, 260 m apart between Bạch Đằng
wharf and Thủ Thiêm, where the city's New Year and National Day shows are
held. The **Fireworks** button starts a show, and pressing it again starts
a new one. The view is from the Thủ Thiêm bank, across the river to the
District 1 skyline. SIMULATED: the programme is random, not a real show's.
It looks best at night; the sky follows the clock as usual.

## The show

- **Opening:** single shells every 2-3 s from one barge or another.
- **Middle:** pairs and threes, mixed effects, and bursts of salutes.
- **Finale:** a shell every 0.18 s from all three barges, then a wall of
  willows and a last volley of salutes.

About 280-330 shells in all.

## Shells

Each shell rises as a flickering gold comet with a trail. It bursts at its
apex, 90-260 m up, into:

| Effect | Stars |
|---|---|
| peony | a sphere of stars in one or two colours |
| chrysanthemum | the same, with trails |
| crackle | stars that strobe as they fade |
| willow | long gold trails that drift down and dim to embers |
| ring | a tilted ring of stars, with a pistil |
| palm | 9-12 thick gold arms |
| salute | a white flash and crackle |

Every burst starts with a white flash. The stars are white-hot, then their
colour, then fade.

## Sound

`fireworks-sound.js` synthesises the sound with the Web Audio API; there are
no recordings.

- **Launch:** each mortar's thump; a quarter of the shells whistle as they
  rise.
- **Burst:** each burst's boom, with a low rumble.
- **Effects:**
  - crackles scatter tiny sharp pops;
  - salutes bang;
  - willows and palms hiss as the embers fall.

The camera is the listener:
- **Travel time:** every sound arrives late by the time it takes to cross
  the distance (343 m/s). From the default view a burst ~700 m off is
  heard about two seconds after it is seen.
- **Distance:** it grows quieter (1 at 150 m, falling as 150/d), and duller,
  since the air takes the high notes first (a low-pass from 16 kHz down to
  900 Hz).
- **Panning:** left or right by where it is in the view.
- **Echo:** a 3-second echo off the city is mixed in, more of it the
  further off.
- **Loudness:** a compressor keeps the finale from clipping.

Browsers allow sound only after a click, so the Fireworks button starts
it: `resume()` runs first in the tap's handler.

It falls silent whenever the page is hidden or loses focus (another tab or
window, the phone locked), and comes back when you return. Sounds already
scheduled at that moment, still travelling, are dropped: their audio chain
is replaced, so they don't all play at once on return. The show itself
carries on.

On an iPhone:
- **Silent switch:** Web Audio follows the ring/silent switch, so the page
  sets its audio session to playback (Safari 16.4+). On older iOS it loops
  a silent `<audio>` element instead, which does the same.
- **Unlock:** iOS unlocks Web Audio only once a sound starts inside the
  tap, so a one-sample silence is played there.
- **Interruptions:** if iOS suspends the audio (a call, the lock screen, a
  tab switch), the next tap resumes it.

Where there is no stereo panner (before Safari 14.1) the sound plays
unpanned. The legend's **Fireworks sound** checkbox mutes it.
`cityModel.fireworks.sound` reports whether it is running and how many
sounds have played.

## How

- **Stars:** each is a GPU point, written once at the burst into a ring
  buffer of 90,000. Only the part written that frame is uploaded. The
  vertex shader places it from its burst point, velocity, drag and gravity.
- **Trails:** the same star drawn again a few hundredths of a second
  behind, dimmer and smaller.
- **Physics:** `starAt()`, `apex()` and `launchSpeed()` are the same
  formulas in JS, so each shell bursts exactly at its apex.
- **Light:** each burst lights the city and the river for a moment, in its
  colour, through three pooled point lights.
- **Reflection:** the moving river (`riverwater.js`) reflects the stars
  and the flashes.

`cityModel.fireworks` reports whether a show is running, the seconds left,
and the shells fired.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/fireworks.mjs
```

The checks cover:
- the ballistics (launch speed to height, drag, fall);
- the barges on the river's centreline;
- a whole show run through: every shell fired, flashes, finite stars,
  bursts at the expected heights;
- the view;
- the sound hooks: every launch and burst is heard, timed from when it
  happened;
- the delay and loudness for a distance;
- the sound staying silent (not failing) without Web Audio.

In Chromium it was watched at night from the default view. The sound was
rendered offline and its levels checked:
- a mortar 200 m off is heard at 0.6 s;
- a crackle 700 m off at 2.0 s, its pops following;
- a salute 320 m off, fired at 3.5 s, at 4.4 s;
- the peak is 0.59, so nothing clips.
