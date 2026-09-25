The flag uses a dependency-free `Cloth` class from `cloth.js`, re-exported
by `flag.js`. Both files are plain browser ES modules; no packages or build
step are needed. `createFlag({scene, skyline, camera})` accepts an optional
camera and still returns `{state, group, update}`. The viewer passes its
camera; existing callers acquire the render camera on the first render.

The solver uses [XPBD distance constraints](https://matthias-research.github.io/pages/publications/XPBD.pdf),
Verlet position history, and a 31 × 21 particle grid. Gravity is 9.81 m/s²,
fabric mass is 0.3 kg/m² (about 835 kg for this flag), and air density is
1.2 kg/m³. Rest triangle areas determine particle masses, including the
lighter boundary particles. Each deformed triangle receives normal drag
and small tangential drag from air velocity relative to its mean velocity.
A diagonal implicit drag correction stabilizes rapid changes in pressure.

Four alternating constraint sweeps keep stretch and shear small. Soft
two-edge distance constraints resist tight bending; one-sided hoist tethers
limit accumulated stretch to about 1.5% without resisting folds. These are
an economical bending approximation, not a calibrated woven-fabric model.
There is no self-collision or fluid wake simulation.

Wind is converted from aloft knots to m/s exactly once. Smooth correlated
eddies vary speed by at most ±25% and horizontal direction by at most ±10°.
Small synthesized pulses are included even without a reported gust.
The air field is delayed by up to 1.8 seconds toward the lower hem, encouraging
twist and lag. Reported gusts make narrow smooth pulses roughly every 22 s;
gust timing is synthesized because a METAR provides a peak, not a time series.
Both `gust_kt` and the existing API's raw METAR `GxxKT` are supported.
Only wind and a tiny initial imperfection are prescribed; vertex motion
comes from forces and constraints.

The step is fixed at 1/120 s, with at most six steps per frame. Excess elapsed
time is discarded. Hidden groups, hidden ancestors, hidden tabs, and cameras
over 20 km away pause the simulation. Visibility events and gaps over 250 ms
reset the clock. Resume preserves the shape and velocity, with no catch-up.
The same position attribute is reused and normals are recomputed after steps.

A horizontal plane 2 m above the roof guarantees clearance, including when
the flag hangs fully down. A conservative downstream half-space prevents
the movable cloth from crossing the pole, including between mesh vertices.
The specified x=0 hoist seam and its attachment strip intentionally enter
the pole's sleeve; all remaining fabric stays beyond the pole radius.
This collision approximation prevents wrapping around the mast.

For heavier, slower Bosphorus-style motion, tune the `Cloth` options:

| Parameter | Default | Effect |
| --- | --- | --- |
| `density` | 0.3 kg/m² | Try 0.4–0.5 for more inertia and sag; weak winds will extend it less. |
| `damping` | 0.12 /s | Try 0.18–0.25 to suppress small chatter; too much removes the snaps. |
| `bendCompliance` | 0.025 m/N | Lower to 0.01 for broader, stiffer folds; higher permits tighter creases. |
| `turbulence` | 1 | Lower toward 0.6 for quieter air; 0 disables eddies for deterministic still-air tests. |
| `normalDrag` | 1.2 | Larger values couple cloth more strongly to cross-flow. |
| `tangentialDrag` | 0.04 | Small skin drag keeps air pulling along an almost flat flag. |

For slower wind changes, multiply the wind phase frequencies in `step()` by
0.7. Keep physical gravity and the fixed timestep unchanged. Lower the
reported gust peak or broaden the gust pulse exponent (12 → 6) for gentler
snaps. Do not increase timestep to slow the animation.

Run the plain Node assertions from the repository root:

```sh
node --loader ./tests/three-loader.mjs tests/cloth.mjs
node --loader ./tests/three-loader.mjs tests/flag.mjs
node --loader ./tests/three-loader.mjs tests/flag_cloth.mjs
```

The first test requires no three.js; the loader only makes Node treat `3d/*.js` as ES modules. It checks 30 simulated seconds
in calm, steady 10 m/s wind, 5–40 kt winds and gusts, and abrupt changes;
it also checks pins, collision clearance, bounded stretch, and relative drag.
The integration test uses the existing vendored-three loader, with browser
services stubbed, to verify pause/resume, gust parsing and buffer updates.

On this environment's Node 18 runtime, 1,800 warmed samples of two fixed
steps plus position upload to the CPU attribute and normal recomputation
averaged 1.57 ms, with a 1.76 ms 95th percentile. This excludes rendering and
is not a desktop-browser guarantee. The available Chromium runtime could
not launch reliably, so browser timing and visual appearance remain to be
checked on the target machine. Slow frames taking all six substeps cost more.

## Tuning applied (2026-09-25)

Measured headless (40 s runs, averaged over the second half) at 11 kt aloft:
the solver defaults left the flag 81% extended with the free end ~22 m below
mid-hoist. `createFlag()` now passes `density: 0.2` (light polyester, usual for
giant flags) and `tangentialDrag: 0.15` (flapping-flag drag coefficients run
~0.1–0.3), giving ~97% extension and ~7 m droop. The height profile exponent is
0.3 (dense urban terrain) rather than 0.2 (open country), so a 5 kt surface
reading becomes ~16 kt at the flag.

`step()` originally capped `turbulence` at 1, so higher values did nothing.
The cap is now 3 (±75% speed, ±30° direction). In this model the flag's
rolling comes from that air variation -- normal drag damps sideways motion,
so a taut flag in steady air settles almost flat. Damping, bend compliance,
normal drag and density barely changed the swing (0.16–0.29 m at 13 kt).
`createFlag()` passes `turbulence: 3`: fly-end swing ~1.5 m at 13 kt and ~2 m
at 20 kt (was 0.23 / 0.46 m), extension 97–99%. Also `Cloth` now lives in
`cloth.js`, not `cloth.mjs`: nginx served `.mjs` as `application/octet-stream`,
which browsers refuse as a module, and that broke the whole viewer.

The air now has a vertical component too (updrafts/downdrafts, up to ±10° per
unit of turbulence), and the aerodynamic force uses it -- before, the vertical
relative air was only the cloth's own velocity, so nothing lifted or dipped the
flag. Tried and rejected: per-point wind with gusts travelling along the flag.
It made the forcing less coherent (up-down swing and twist both fell) and
doubled the step cost (0.70 -> 1.38 ms).
