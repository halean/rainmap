# Chợ Bến Thành

`ben-thanh.js` creates a schematic exterior model at the market's map location. It follows the Buildings checkbox and has no dedicated camera button.

## Placement and architecture

The existing OSM-derived market polygon in `assets/tiles/2_2.glb` supplies the placement and heading: approximately 106.6980155° E, 10.7725641° N, with the clock entrance facing southeast. Its enclosing footprint is about 100.4 × 137.6 metres.

The model includes cream walls, repeated arched bays, four entrances, red roof halls and ventilation ridges, a projecting main gate, geometric lettering, and a clock tower with static hands. The enclosing footprint is simplified to a rectangle. Roof layout, facade proportions and the 28.8 m model height are visual approximations, not surveyed dimensions. Interiors, stalls, temporary decorations and street furniture are omitted.

References:

- [Ho Chi Minh City Tourism: Bến Thành Market](https://visithcmc.net/en/news/kham-pha-cho-ben-thanh-diem-den-khong-the-bo-qua-o-tp-ho-chi-minh): the south entrance, clock tower and market lettering.
- [Vietnam News Agency: market architecture](https://en.vietnamplus.vn/ben-thanh-market-a-symbol-of-ho-chi-minh-city-post72149.vnp): four entrances and clock tower.
- [Aerial reference photograph](https://www.e-voyageur.com/sites/default/files/section-img/ben-thanh-market-750x450.jpg): arcade, roof halls, vents and tower proportions.

The photographs are references only; no image assets or external fonts are loaded at runtime.

## Rendering and integration

Six merged material batches contain 11,964 triangles. There are no extra lights, shadow maps, reflection passes or animation updates. This is a geometry budget, not a measured GPU timing.

On each detailed tile load, the viewer removes the generic market's 70 triangles before applying city materials. The surrounding building geometry remains. The replacement operation is idempotent and repeats after tile eviction/reload. The landmark uses separate mesh names to retain its architectural materials.

## Checks

```sh
node --loader ./tests/three-loader.mjs tests/ben_thanh.mjs
node --loader ./tests/three-loader.mjs tests/notre_dame.mjs
```

Checks cover finite attributes, height, orientation, batching, actual map-tile replacement, reload behaviour and disposal. A depth-buffered offline geometry preview was inspected. Browser WebGL appearance has not been verified in this environment.
