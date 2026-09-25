# Notre-Dame Cathedral of Saigon

`notre-dame.js` builds a schematic, exterior-only model using the existing vendored three.js modules. The Buildings checkbox controls its visibility.

## Placement and references

The footprint and heading were measured from the cathedral polygon in the project's OSM-derived `assets/tiles/2_1.glb`, using the manifest projection. The model centre is approximately 106.6990174° E, 10.7798036° N, with its entrance facing southeast. Its footprint is approximately 34.4 × 89.2 metres.

Architectural references:

- [Mary Ann Sullivan's cathedral photographs and description](https://homepages.bluffton.edu/~sullivanm/vietnam/hcmc/notredame/notredame.html): brick facade, twin towers, portals, nave, transept and apse.
- [VTC aerial photograph](https://cdn-i.vtcnews.vn/files/f2/2014/09/11/ngam-nha-tho-duc-ba-tu-camera-bay-0.jpg): roof and facade proportions.
- [Cathedral overview](https://en.wikipedia.org/wiki/Notre-Dame_Cathedral_Basilica_of_Saigon): 60.5 m tower height including crosses.

The remaining dimensions are visual approximations, not survey measurements. Windows, roof sections, stonework and the forecourt statue are simplified. The model depicts the permanent architecture without restoration scaffolding. Reference photographs are not bundled or used as textures.

## Rendering and integration

The geometry is merged by material into eight meshes, totalling 18,964 triangles. Brick mortar is procedural and fades at distance. There are no external textures, new lights, shadow maps, reflection passes or animation updates. Actual GPU cost depends on the device and view; these geometry counts are not a timing benchmark.

The viewer replaces the original generic church geometry whenever its detailed tile loads. Only building triangles wholly inside the replacement bounds are removed; surrounding neighbourhood meshes remain. The landmark uses separate names so the generic city facade shader does not overwrite its materials.

Edit `CATHEDRAL` for location/orientation and the geometry dimensions in `createNotreDame` for architectural changes. If the map source or projection changes, recheck the replacement bounds and tile test.

## Verification

Run from the repository root:

```sh
node --loader ./tests/three-loader.mjs tests/notre_dame.mjs
```

The test checks finite geometry, tower height, entrance orientation, material batching, replacement against the actual streamed tile, reload behaviour and disposal. An offline depth-buffered geometry preview was also inspected; browser WebGL appearance has not been verified in this environment.
