# The riverfront towers

`riverfront.js` models the 27 towers that line the river tour
(`RIVERTOUR.md`) in detail, each from its OpenStreetMap footprint and height
(`riverfront-lines.js`) and photographs.

## The towers

- **Vinhomes Central Park:** the nine 180 m towers, Park 1-7 and Central 1
  and 2. They are cream, with a window per bay, balconies and piers, a
  podium, and a frame over the lift cores.
- **Saigon Pearl:** Ruby and Topaz.
- **Sunwah Pearl:** Golden, White and Silver House, with staggered balconies
  and the frame that lights up at night.
- **At Ba Son:**
  - Grand Marina Saigon's two glass towers, 240 m and 236 m, crowned with
    fins;
  - The Kross (and its upper part) and The Nexus, in blue glass;
  - Riverfront Financial Centre;
  - The Waterfront.
- **The District 1 riverfront:**
  - Le Méridien, in green glass;
  - Vietcombank Tower, pale louvred glass with the stepped crown and the
    blade to 186 m;
  - Hilton Saigon, dark glass under a pale open frame;
  - Saigon Times Square, teal glass with deep vertical fins on a dark
    podium;
  - the Renaissance Riverside, cream with a red-stone base;
  - IFC One, 195 m.

The towers are built by `tower-kit.js`. Every floor and every bay is
geometry:
- **Curtain walls:** glass, mullions standing proud, spandrel bands, and slab
  ledges.
- **Residential towers:** walls with recessed windows and reveals, balcony
  slabs with glass railings, and piers.
- **Podiums and crowns:** as the photographs show.

Bay widths are chosen so each tower comes to about 100k triangles (15k-100k,
70k on average, 1.9M for all 27).

## Levels of detail

- **From afar:** each tower is a plain block in its main colour, a few
  hundred triangles, built at start.
- **Close up:** within 1.6 km of the camera, its detailed model is built,
  nearest first and one per frame (20-70 ms each), so the page never stalls.
- **Released:** it is freed once the camera has stayed beyond 2.4 km for
  30 s.

On a river tour the detail follows the yacht along the bank. Each tower
replaces its generic block in the city tiles.

## Approximations

Footprints and heights are OSM's. Where OSM gives only levels (Sunwah Pearl
Golden House, Saigon Pearl Topaz, Renaissance), heights are set from
neighbours and photographs. Colours, bay rhythm, crowns and podiums follow
the photographs by eye. Balconies, logos, signage and lighting are
schematic or omitted.

## Photographs (Wikimedia Commons)

- [Ho Chi Minh City, Vietcombank Tower, 2020-01 CN-01](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City,_Vietcombank_Tower,_2020-01_CN-01.jpg)
  and [Saigon Times Square, 2020-01 CN-01](https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City,_Saigon_Times_Square,_2020-01_CN-01.jpg)
  (Steffen Schmitz, CC BY-SA 4.0)
- [Hilton Saigon Hotel](https://commons.wikimedia.org/wiki/File:Hilton_Saigon_Hotel,_ph%C6%B0%E1%BB%9Dng_b%E1%BA%BFn_ngh%C3%A9,_qu%E1%BA%ADn_1,_tphcm.jpg)
  and [Vinhomes Central Park](https://commons.wikimedia.org/wiki/File:010624_C%C3%B4ng_vi%C3%AAn_Vinhomes_Central_Park_(2).png)
  (Xuanphuocle, CC BY-SA 4.0)
- [Saigon at Blue Hour](https://commons.wikimedia.org/wiki/File:Saigon_at_Blue_Hour.jpg)
  (Radek Kucharski, CC BY 2.0)
- [Saigon Pearl 1-2-3](https://commons.wikimedia.org/wiki/File:Saigon_Pearl_1-2-3.JPG)
  and [Two tallest buildings in Ho Chi Minh city](https://commons.wikimedia.org/wiki/File:Two_tallest_buildings_in_Ho_Chi_Minh_city.JPG)
  (Ngô Trung, CC BY-SA 3.0)
- [Renaissance Riverside Hotel Saigon](https://commons.wikimedia.org/wiki/File:C%C3%B4ng_tr%C6%B0%E1%BB%9Dng_M%C3%AA_Linh-B%E1%BA%BFn_Ngh%C3%A9,_Qu%E1%BA%ADn_1,_TPHCM,_Vi%E1%BB%87t_Nam_Renaissance_Riverside_Hotel_Saigon_-_panoramio.jpg)
  (trungydang, CC BY 3.0)

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/riverfront.mjs
```
