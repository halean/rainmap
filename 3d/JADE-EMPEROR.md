# Jade Emperor Pagoda (Chùa Ngọc Hoàng)

`jade-emperor.js` builds a schematic, exterior-only model of the Jade Emperor
Pagoda, officially Phước Hải Tự, at 73 Mai Thị Lựu in Đa Kao. It follows the
Buildings checkbox and has no dedicated camera button.

## Placement and references

The footprint is the OpenStreetMap outline, way 1272651080: a rectangle
9.8 m by 27 m covering the halls, extruded as-is. The model origin is about
106.6976869° E, 10.7915281° N, and the front faces the courtyard and Mai Thị
Lựu to the north-east (-z). The pagoda's lower side wings and outbuildings,
seen either side of the front in photographs, are outside the outline and
not modelled.

- [Jade Emperor Pagoda, Wikipedia](https://en.wikipedia.org/wiki/Jade_Emperor_Pagoda):
  completed in 1909 by Liu Daoyuan (Lưu Minh), a Cantonese merchant; Taoist,
  Buddhist and Confucian; named Phước Hải Tự since 1984.
- Photographs on Wikimedia Commons:
  [Phước Hải Tự](https://commons.wikimedia.org/wiki/File:Ph%C6%B0%E1%BB%9Bc_H%E1%BA%A3i_T%E1%BB%B1.jpg)
  (Bùi Thụy Đào Nguyên, CC BY-SA 3.0), the front straight on;
  [Jade Emperor Pagoda Saigon](https://commons.wikimedia.org/wiki/File:Jade_Emperor_Pagoda_Saigon.jpg)
  (Ymblanter, CC BY-SA 4.0); and
  [Jade Emperor Pagoda (9981950475)](https://commons.wikimedia.org/wiki/File:Jade_Emperor_Pagoda_(9981950475).jpg)
  (Gary Todd, CC0), the courtyard.

The front follows the photographs:
- **The gate front:** a tall red wall with the gold-framed signboard 玉皇殿
  (drawn as three red panels). Relief panels of glazed ceramic sit either
  side of it, and turrets with gold finials stand at its corners.
- **Its crest:** glazed ceramic figures along the coping, two dragons and a
  pearl.
- **The porch:** a green-glazed roof with upturned corners on two dark posts
  over the doorway, hung with red lanterns.
- **The halls behind:** red walls under green-glazed gable roofs with
  ceramic ridges.
- **The courtyard:** a three-tiered bronze incense tower.

Heights come from the photographs' proportions, not measurements: the halls'
walls at 6 m, and the gate front at 10.4 m under its crest, to about 13.8 m.
The figures, the characters and the tile rolls are simple shapes. The stone
lions, the brazier, the turtle pond and the interior are omitted.

## Rendering and integration

Built with `landmark-kit.js`, merged into nine meshes (about 1,700
triangles). The generic block is replaced when its tile (`2_1`) loads:
exactly its 10 triangles. It is listed in `LANDMARKS` in `viewer.js`.

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
```
