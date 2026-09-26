# Independence Palace (Dinh Độc Lập)

`independence-palace.js` builds a schematic, exterior-only model of the palace
Ngô Viết Thụ designed (1962–66) at its map location. It follows the Buildings
checkbox and has no dedicated camera button (`view` holds a front
three-quarter viewpoint, as for the cathedral).

## Placement and references

The footprint and heading come from the palace's OpenStreetMap outline, way
39598493 (`building=palace`, 21 corners), in the manifest projection. The
model origin is approximately 106.6953124° E, 10.7769346° N, on the T's axis
of symmetry; the main facade faces north-east, toward Lê Duẩn (heading
137.39°). The outline is a T: a front block 85.8 m long and 24–28 m deep, a
neck 23 m wide, and a rear wing 31.8 m wide, 76.5 m front to back overall.
The model reproduces those blocks and the notches where they meet.

From the palace's official site:

- [Kiến trúc Dinh Độc Lập](https://dinhdoclap.gov.vn/di-tich/kien-truc-dinh/) and
  [Architecture of the Independence Palace](https://dinhdoclap.gov.vn/en/independence-palace-architecture/):
  T-shaped main building, 4,500 m², 26 m high; three floors, two mezzanines,
  a rooftop terrace, ground floor and basement; the "rèm hoa đá" stone screen
  of stylised bamboo around the upper floors; the front facade -- balconies,
  roof eaves and two columns -- forming 興, the eaves and balconies 三; the
  Pavilion of Universal Peace on the roof shaped like 口, with the central
  flagpole making it 中; a semicircular lotus pond before the hall; the 102 m
  oval front lawn.
- [Independence Palace (Wikipedia)](https://en.wikipedia.org/wiki/Independence_Palace):
  the UH-1 helicopter on the rooftop helipad and the red circles marking where
  bombs struck in April 1975.

The official 26 m is taken as the top of the rooftop pavilion. The division
into floors (plinth 1.2 m, floors at 6.2 and 11.4 m, eaves at 16.6 m, roof
18.2 m), the screen's cane spacing, the columns, porch, pond size and position,
helipad and helicopter are visual approximations, not survey measurements.
The oval lawn comes from the existing map (OSM), not this model. Interiors,
the basement bunker, the gate tanks and the garden are omitted; the rooftop
flagpole has no flag.

## Rendering and integration

Geometry is merged by material into nine meshes (concrete, stone screen,
glass, roof, stone, metal, olive, red, water): 10,040 triangles. No textures,
lights, shaders or per-frame updates. Neighbouring blocks' overlapping slabs
are offset by a few millimetres so their level faces don't z-fight.

As with the cathedral, the viewer removes the generic OSM building whenever a
tile loads -- only building triangles wholly inside the palace's footprint
box, which in `assets/tiles/2_1.glb` is exactly the generic palace (61
triangles: its 21-corner outline extruded). Meshes are named `palace-*`, so
the generic facade shader leaves them alone.

Edit `PALACE` for location and heading, and the dimensions in
`createIndependencePalace` for architecture. If the map source or projection
changes, recheck the replacement box and the test's triangle count.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/independence_palace.mjs
```

The test checks finite geometry, the 26 m pavilion, nothing but the flagpole
above it, the north-east facing, the footprint width, material batching, and
that exactly the generic palace is replaced in the real tile (idempotently,
and again on reload), then disposal. Checked in the browser at a simulated
midday: front and rooftop views, no page errors.
