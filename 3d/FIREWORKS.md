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

## Sound, from physics

The sound is computed, not recorded or hand-shaped:
- `fireworks-acoustics.js`: the physics;
- `fireworks-render.js`: renders each event with it, in a Web Worker
  (`fireworks-sound-worker.js`);
- `fireworks-sound.js`: plays the results.

**Sources** (acoustic yield in kg of TNT equivalent):

| Event | Waveform | Yield |
|---|---|---|
| burst | a blast wave: the Friedlander pulse, overpressure then a weaker suction phase | ~4 g for an 80 m burst, scaling with size³ |
| salute | the same, from flash powder, sharper | 30 g |
| mortar | a muzzle blast, and the tube ringing at its quarter-wave resonance c/4L (0.9 m tube, ~95 Hz) | 0.3 g; most of the lift's energy drives the shell |
| crackling star | a micro-blast from each star, where it is, when it pops | 0.3 g |
| whistle | a rising note (1.4 to 3.2 kHz, ~120 dB at 1 m), Doppler-shifted by the shell's climb | |
| willow, palm | combustion hiss of ~150 burning stars | |

- **Blast peak:** from Kinney and Graham's scaled distance; far out it
  falls as 1/R.
- **Blast duration:** the positive phase lengthens slowly with distance, as
  a weak shock's does.
- **Whistle:** each output sample is the tone as emitted at its retarded
  time, found by solving t_arrival = t_emit + |x(t_emit) − ear| / c.

A burst 700 m off peaks at ~120 dB at the listener, in line with
measurements at displays.

**Paths.** Each event reaches the listener (the camera) along several paths:
- **Direct.**
- **Off the river:** an image source below the water, reflection
  coefficient 0.95. Over the river it arrives some tens of milliseconds
  after the direct sound.
- **Off the tall buildings:** the riverfront and city towers, Bitexco and
  Landmark 81, each a scatterer of cross-section ~0.3 × its facade area.
  The four strongest echoes are kept. This is an approximation: real
  facades reflect specularly, and only some face the right way.

**Along each path:**
- **Delay:** its length at the speed of sound for the air temperature,
  plus the wind's component along it (the live wind feed).
- **Spreading:** 1/R.
- **Absorption:** ISO 9613-1 at the hour's typical HCMC air (27.5 ± 3.5 °C,
  78 ∓ 14 % humidity). At 20:30 over 700 m it takes 5 dB off 1 kHz, 15 dB
  off 4 kHz and 60 dB off 10 kHz, which is why a distant firework booms
  rather than cracks.
- **Upwind:** the path also loses up to 6 dB, a crude stand-in for
  refraction.
- **Panning:** each arrival is panned from its own direction.

A diffuse tail, the sound scattered again and again among the buildings,
is added by a convolver.

**Rendering.** Each event is rendered in the Web Worker and scheduled for
its first arrival. On the main thread each event costs well under a
millisecond; in the worker a burst takes 15-40 ms, and a whistling launch
about 100 ms on the test machine.

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
  happened, with the shell's velocity passed for the whistle;
- ISO 9613-1 absorption against its table at 20 °C and 70 % humidity
  (5.0 / 23.1 / 77.6 dB/km at 1 / 4 / 8 kHz; the table has
  5.0 / 22.9 / 76.6);
- the speed of sound;
- the blast's 1/R fall and slowly lengthening pulse, and its level;
- the Friedlander pulse's two phases;
- the air rounding off a crack;
- the arrivals: direct first, then the river's reflection 30-120 ms later,
  then an echo, later and quieter;
- wind: downwind sooner and louder;
- Doppler for a receding source;
- the renderers: a burst's first arrival at the right time and level, with
  its echo later; crackling stars after the burst; the mortar and its
  whistle;
- the sound staying silent (not failing) without Web Audio.

In Chromium it was watched at night from the default view, the sound
running through the worker. The sound was rendered offline and its levels
checked:
- a mortar 640 m off is heard at 1.85 s, its whistle following;
- a crackle 700 m off at 2.0 s, its stars popping from 3.2 s;
- a salute 330 m off, fired at 3.5 s, at 4.45 s;
- a willow at 4.9 s;
- the loudest peak is 0.71 of full scale (the salute, nearest), so
  nothing clips.
