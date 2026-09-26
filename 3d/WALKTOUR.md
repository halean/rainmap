# Walking tour: Đồng Khởi

The **Walking tour** button walks the length of Đồng Khởi, from Công xã Paris
(Notre-Dame and the Post Office) down to the river at Tôn Đức Thắng. It
crosses at the end and walks back up the other side, about 24 minutes a lap
at 1.35 m/s. The camera follows the walker with the same chase as the river
tour: drag to turn round and tilt (up at the trees too), scroll to zoom in
as close as 2.5 m, and pan to hand the view back.

## Loaded only for the tour

`walktour.js` is not imported with the city. The button imports and builds
it (~1.4 s), and leaving the tour frees it. Its budget is 1M triangles; it
comes to about 710k:
- **Shopfronts:** 206 units along both street walls, each 4-8.5 m wide.
  - A glazed front in a dark mullioned frame, with a door, a lit interior
    strip, a fascia sign with a lettering band, piers and planters.
  - About two-thirds have a scalloped awning.
  - Where OSM maps no building (most of this street's shophouses), the whole
    shophouse is built behind it: 3-6 storeys with a cornice, some arched
    windows, balconies with railings, air-conditioners, pilasters and some
    tiled roofs.
- **Trees:** 123 tall street trees, 18-28 m, along the kerbs every ~11 m.
  Each has a slender trunk leaning towards the road, 4-6 limbs with twigs,
  and a wide crown of leaf clusters in five greens (~450k of the triangles).
- **Lamp posts:** 64, dark green, each with a lantern on an arm.
- **Sidewalks:** granite paving from the kerb to the frontage, and kerbs.

## Data

`walktour-street.js` holds the street's OSM centreline (970 m) and the cross
streets. Nguyễn Du, Lý Tự Trọng, Lê Thánh Tôn, Lam Sơn square with Lê Lợi,
Nguyễn Thiệp, Đông Du, Mạc Thị Bưởi, Hồ Huấn Nghiệp, Ngô Đức Kế and Tôn Đức
Thắng are left open.

It also holds the street wall either side, sampled every 3 m by casting
sideways into the city model:
- **A building face:** gets a shopfront on its ground floor.
- **A modelled landmark** (the Post Office, the Continental, the Opera
  House, the Majestic): left alone.
- **No building:** gets a built shophouse at 12.5 m from the centreline.

Façade colours, sign colours, awnings, storeys and widths are drawn from a
fixed-seed random sequence, so every visit looks the same.

## Approximations

The shops are generic, not the street's actual tenants: no real names or
brands. The tree species and exact positions are not mapped (OSM has six
trees here), so they are spaced along the kerbs. There are no pedestrians,
traffic or street furniture beyond the lamps and planters.

## Photographs (Wikimedia Commons)

- [Dong Khoi Street, Ho Chi Minh City 2013](https://commons.wikimedia.org/wiki/File:Dong_Khoi_Street,_Ho_Chi_Minh_City_2013.jpg)
  (TomW712, CC BY-SA 3.0)
- [Đường Đồng Khởi](https://commons.wikimedia.org/wiki/File:%C4%90%C6%B0%E1%BB%9Dng_%C4%90%E1%BB%93ng_Kh%E1%BB%9Fi.JPG)
  (Ngô Trung, CC BY 3.0)

## Verification

```sh
node --loader ./tests/three-loader.mjs tests/walktour.mjs
```
