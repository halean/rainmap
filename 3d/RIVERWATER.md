# River water

`riverwater.js` makes the Saigon River move round the camera: wind waves,
the yachts' wakes with foam, bubbles and spray, reflections, rain rings and
night light streaks. The yachts ride the same surface.

## Where

Within 320 m of the view's focus (the orbit target), when the focus is
within 900 m of the river's centreline and the camera is below 700 m. There,
the tiles' flat water is cut away (`sky-render.js` `uWaterHole`) and a live
surface takes its place. Its displacement fades to nothing at the edge, so
it meets the flat water beyond without a seam. Elsewhere the module is idle:
it only records the yachts' tracks.

## What it draws

- **Surface:** a polar grid (finest at the centre, 26-126k triangles by
  quality), placed and displaced in the vertex shader. It is lit as a
  `MeshStandardMaterial` in the tiles' water colour.
- **Waves:** four wave trains about the downwind direction, 1.7-7.5 m long,
  with deep-water speeds. They run downwind and grow with the wind speed,
  both from the same wind feed as the flags (`flag.js`). Fine ripples on
  top fade with distance so they don't alias.
- **Wakes:** each yacht's stern is recorded every 2.5 m (for 150 s). Each
  frame the track is drawn from above into a 640 m wake map, as a ribbon
  whose vertices carry the distance behind the stern, the offset across
  the track, the time and the speed. The ribbon's shader computes, per
  texel:
  - the divergent Kelvin arms at 19.47°;
  - the transverse waves (weaker when planing);
  - the propellers' wash: bright for ~7 s, then fading, widening broken
    foam for about a minute.

  Heights go in red, foam in green, so a wake follows the track through
  the turns and does not swing with the hull. On the inside of a turn the
  ribbon is kept within the turn's radius so it can't fold over itself.
  The surface samples the map for displacement, normals and foam.
- **Water mask:** the tiles' water, drawn from above (layer 4). It keeps
  the surface, and so the wakes, inside the river. It is redrawn when tiles
  load or the centre moves 30 m.
- **Hulls:**
  - the water is cut away inside the after 60% of each hull, so waves
    never show through the cockpit or swim platform;
  - a foam line runs round each hull, stronger at speed and at the bow.
- **Bubbles and spray:** GPU points, spawned into a ring buffer and moved in
  the shader from spawn time:
  - bubbles from the two propellers rise and float;
  - spray is thrown out from the forefoot and falls.

  Dense within 150 m of the camera, sparse to 450 m, none beyond.
- **Reflection:** a mirrored camera below the water plane, with an oblique
  near plane at the water. It renders only layer 5, at half (recommended)
  or full (cinematic) resolution, every frame while active:
  - what is reflected: the skyline, the tiles' buildings and bridges,
    Bitexco, Landmark 81, the Nhà Rồng museum, the bridges, *Saigon Star*,
    and the sun and moon;
  - heavy models reflect as stand-ins: the riverfront towers as their far
    blocks, *Nha Rong* as its LOD2 proxy.

  The waves' slope ripples it; Fresnel mixes it in, never above 80% (a
  muddy river). Reflected empty sky is shaded lighter toward the horizon.
  At night it is drawn out into streaks down the view, the long
  reflections of lights on moving water.
- **Glint:** the sun and moon glint shared with the tiles' water.
- **Rain:** rings from drops on a 1.1 m grid, as many as the nearest
  camera within 2.5 km reports rain (light, medium, heavy).

## The yachts ride it

`sample(x, z, skip)` gives the surface height in JS: the same wave trains,
plus every other yacht's wake from its recorded track (the Kelvin field in
`wakeAt()`, shared text with the shader). `rivertour.js` feels it at bow,
stern and either side, and heaves, pitches and rolls with a 0.35 s lag (see
`RIVERTOUR.md`). Without a half-float wake map (no `EXT_color_buffer_float`)
the wake carries foam only, and the yachts feel only the waves.

## Quality

| | Economical | Recommended | Cinematic |
|---|---|---|---|
| Surface | 80 rings × 128 (20k tris) | 140 × 192 (54k) | 220 × 288 (126k) |
| Wake map | 256² (2.5 m) | 512² (1.25 m) | 1024² (0.6 m) |
| Reflection | off | half resolution | full resolution |
| Particles | 2k, 0.35× rate | 6k | 16k, 2.2× rate |

- **Auto** (the default) starts at Recommended and steps down after ~2-4 s
  of frames over 24 ms. At Economical it next drops the pixel ratio to 1.
  After ~10 s of frames under 14 ms it climbs back to Recommended;
  Cinematic is only by choice.
- **The legend's River water menu** sets the quality, as does `?water=`
  (`economical`, `recommended`, `cinematic` or `auto`).
- **`?perf=1`** shows the frame time, the GPU time (where the browser offers
  `EXT_disjoint_timer_query_webgl2`), and the levels in use.
  `cityModel.water` reports the same.

Expected cost on a discrete GPU at Recommended is a few ms a frame. Most of
it is the reflection pass, which re-draws the reflected layer at half
resolution. The test browser (SwiftShader, no GPU) cannot measure it.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/riverwater.mjs
```

The checks cover:
- the waves' size and motion;
- the Kelvin arm standing above the water outside it, and fading with age;
- the foam fading;
- the wake ribbon through a 30 m turn (inner side within the radius) and a
  reset on a jump;
- the surface grids at each quality;
- the yachts pitching and rolling on a tilted surface, each skipping its
  own wake, and falling back to the scripted bob.

In Chromium the river tour was checked by day, at night and in rain,
following close and orbiting, with the render targets read back (mask,
wake map, reflection).
