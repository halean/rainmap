// More of the city's towers, modelled in detail like the riverfront's
// (riverfront.js createTowerSet, tower-kit.js): every floor and bay, about
// 100k triangles each, from their OSM footprints (citytowers-lines.js) and
// photographs:
//  - District 1: Saigon Centre's two towers on Lê Lợi and Lim Tower on
//    Tôn Đức Thắng;
//  - Vinhomes Golden River at Ba Son: Aqua 1-4, Lux 6 and The Lake;
//  - Vinhomes Central Park: Central 3; Saigon Pearl's older block;
//    Riverside 90;
//  - Thủ Thiêm: four 100 m towers across from District 1;
//  - District 4: Masteri Millennium;
//  - Thảo Điền: Masteri Thảo Điền T1, T2, T3, T5; Gateway Thảo Điền's
//    Aspen, Rio, Sol and Madison; Towers 1-4;
//  - Hà Đô Centrosa in District 10; City Garden in Bình Thạnh; eleven
//    towers in District 7 off Nguyễn Hữu Thọ.
// Each is a plain block until the camera comes within 1.6 km. See CITYTOWERS.md.
import {createTowerSet, CURTAIN, RESIDENTIAL} from './riverfront.js';
import {CITY_TOWER_OUTLINES as O} from './citytowers-lines.js';

/** Height (m) as tagged, else from the levels. */
export const towerHeight = key => O[key].height ?? O[key].levels * 3.3;
/** A spec with the shaft's top `crown` metres below the tagged height. */
const tower = (key, name, crownMetres, o) => {
  const height = o.height ?? towerHeight(key), floors = o.floors ?? O[key].levels ?? Math.round(height / 3.4);
  // Bays may narrow to 1.5 m (1 m of curtain wall) so small footprints still come to ~100k triangles.
  const style = {...o.style, bay: o.style.kind === 'residential' ? 1.5 : 1.0};
  return {key, name, body: height - crownMetres, calibrate: true, ...o, style, floors: Math.round(floors * (height - crownMetres) / height)};
};

// Looks from photographs.
const VINHOMES = {wall: '#eadfc6', glass: '#394650', frame: '#d9ccb0', slab: '#f1ebdc', roof: '#b9b0a0'};
const GOLDEN_RIVER = {wall: '#eeeeea', glass: '#2c3a46', frame: '#c9ccce', slab: '#f5f5f2', rail: '#8fa7b6', roof: '#9da2a6'};
const MASTERI = {wall: '#f0efeb', glass: '#2b333b', frame: '#6f7479', slab: '#f4f3ef', accent: '#8c9196', roof: '#a3a6a8'};
const CENTROSA = {wall: '#e4dccd', glass: '#33414c', frame: '#9a8b73', slab: '#efe9dd', roof: '#9c968c'};
const CITY_GARDEN = {wall: '#e9e6df', glass: '#2e3b44', frame: '#6d7278', slab: '#f1efe9', rail: '#8ea4b1', roof: '#9a9ea2'};
const D7_WARM = {wall: '#e8dfcf', glass: '#34414b', frame: '#b49c7c', slab: '#f0eadf', roof: '#a19a8f'};
const D7_COOL = {wall: '#e6e7e5', glass: '#2f3c47', frame: '#7e8a94', slab: '#f2f2ef', roof: '#9ca1a5'};
const GATEWAY = {wall: '#dcdad4', glass: '#27323c', frame: '#4f5963', slab: '#ecebe6', roof: '#8e9296'};
export const CITY_TOWER_SPECS = [
  // District 1.
  tower('saigonCentre2', 'Saigon Centre – office tower', 9, {colours: {glass: '#3f5a73', frame: '#aeb8c1', spandrel: '#324a60'},
    podium: {h: 32, floors: 7, style: CURTAIN({bay: 3})}, style: CURTAIN({mullion: 0.3, mullionDepth: 0.3}), crown: 'fins'}),
  tower('saigonCentre2b', 'Saigon Centre – residence tower', 7, {floors: 44, colours: {glass: '#46617a', frame: '#c1c9d0', spandrel: '#3a5268'},
    style: CURTAIN(), crown: 'fins'}),
  tower('limTower', 'Lim Tower', 4, {colours: {glass: '#4172a6', frame: '#c9d3dc', spandrel: '#335d8a'},
    podium: {h: 16, floors: 4, style: CURTAIN({bay: 3})}, style: CURTAIN({ledge: 0.35, transom: 0.25}), crown: 'parapet'}),
  // Vinhomes Golden River, at Ba Son.
  ...[['aqua1', 'Aqua 1'], ['aqua2', 'Aqua 2'], ['aqua3', 'Aqua 3'], ['aqua4', 'Aqua 4'], ['lux6', 'Lux 6'], ['theLake', 'The Lake']].map(([key, n]) =>
    tower(key, `Vinhomes Golden River – ${n}`, 8, {colours: GOLDEN_RIVER, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})},
      style: RESIDENTIAL({balconyEvery: 1, balconyDepth: 1.5, stagger: true, window: 0.7}), crown: 'frames'})),
  // Vinhomes Central Park and its neighbours.
  tower('vinhomesCentral3', 'Vinhomes Central Park – Central 3', 12, {colours: VINHOMES, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})}, style: RESIDENTIAL(), crown: 'frames'}),
  tower('saigonPearl', 'Saigon Pearl – Sapphire', 6, {colours: {wall: '#e6dcc4', glass: '#3a4550', frame: '#cbbd9f'}, style: RESIDENTIAL({balconyEvery: 3}), crown: 'penthouse'}),
  tower('riverside90', 'Riverside 90', 6, {colours: {wall: '#e3ddd2', glass: '#3b4852', frame: '#a8927a', slab: '#efe9df'}, style: RESIDENTIAL({balconyEvery: 2}), crown: 'penthouse'}),
  // Thủ Thiêm, across from District 1 (OSM gives heights only).
  ...['A', 'B', 'C', 'D'].map((n, i) => tower(`thuThiem${n}`, `Thủ Thiêm tower ${n}`, 5, {floors: 30, colours: {glass: '#50677a', frame: '#dfe3e6', spandrel: i % 2 ? '#e6e8ea' : '#44596b', wall: '#e9e8e4'},
    podium: {h: 10, floors: 2, style: CURTAIN({bay: 3})}, style: CURTAIN({ledge: 0.45, ledgeDepth: 0.5, transom: 0.25}), crown: 'parapet'})),
  // District 4.
  tower('masteriMillennium', 'Masteri Millennium', 6, {colours: MASTERI, podium: {h: 14, floors: 4, style: CURTAIN({bay: 3})}, style: RESIDENTIAL({balconyEvery: 2, stagger: true}), crown: 'lit-frame'}),
  // Thảo Điền.
  ...[['masteriT1', 'T1'], ['masteriT2', 'T2'], ['masteriT3', 'T3'], ['masteriT5', 'T5']].map(([key, n]) =>
    tower(key, `Masteri Thảo Điền – ${n}`, 6, {colours: MASTERI, podium: {h: 14, floors: 4, style: CURTAIN({bay: 3})}, style: RESIDENTIAL({balconyEvery: 2, stagger: true}), crown: 'lit-frame'})),
  ...[['gatewayAspen', 'Aspen'], ['gatewayRio', 'Rio'], ['gatewaySol', 'Sol'], ['gatewayMadison', 'Madison']].map(([key, n]) =>
    tower(key, `Gateway Thảo Điền – ${n}`, 6, {colours: GATEWAY, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})},
      style: RESIDENTIAL({balconyEvery: 1, balconyDepth: 1.2, window: 0.72, pier: 2}), crown: 'penthouse'})),
  // Hà Đô Centrosa, District 10 (on 3 Tháng 2): eight 30-storey towers.
  ...[['Iris1', 'Iris 1'], ['Iris2', 'Iris 2'], ['Iris3', 'Iris 3'], ['Iris4', 'Iris 4'], ['Jasmine1', 'Jasmine 1'], ['Jasmine2', 'Jasmine 2'], ['Orchid1', 'Orchid 1'], ['Orchid2', 'Orchid 2']].map(([k, n]) =>
    tower(`centrosa${k}`, `Hà Đô Centrosa – ${n}`, 5, {colours: CENTROSA, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})}, style: RESIDENTIAL({balconyEvery: 2, pier: 2}), crown: 'penthouse'})),
  // City Garden, Bình Thạnh.
  tower('cityGardenPromenade2', 'City Garden – Promenade 2', 5, {colours: CITY_GARDEN, podium: {h: 10, floors: 2, style: CURTAIN({bay: 3})}, style: RESIDENTIAL({balconyEvery: 1, window: 0.7}), crown: 'penthouse'}),
  tower('cityGardenBoulevard1', 'City Garden – Boulevard 1', 5, {colours: CITY_GARDEN, podium: {h: 10, floors: 2, style: CURTAIN({bay: 3})}, style: RESIDENTIAL({balconyEvery: 1, window: 0.7}), crown: 'penthouse'}),
  // District 7, off Nguyễn Hữu Thọ (named as OSM names them).
  ...[['d7Tower37', 'tower'], ['d7W1', 'W1'], ['d7W2', 'W2'], ['d7W3', 'W3'], ['d7W4', 'W4'], ['d7BlockA36', 'Block A (north)'], ['d7BlockA', 'Block A'], ['d7BlockB', 'Block B'], ['d7BlockC', 'Block C'], ['d7X1', 'X1'], ['d7X2', 'X2']].map(([key, n], i) =>
    tower(key, `District 7 – ${n}`, 5, {colours: i % 3 === 0 ? D7_WARM : D7_COOL, podium: {h: 12, floors: 3, style: CURTAIN({bay: 3})},
      style: RESIDENTIAL({balconyEvery: i % 2 ? 1 : 2, stagger: i % 3 === 2}), crown: i % 2 ? 'frames' : 'penthouse'})),
  // Thảo Điền, Towers 1-4 (as OSM names them).
  ...[1, 2, 3, 4].map(n => tower(`thaoDienTower${n}`, `Thảo Điền – Tower ${n}`, 5, {colours: GATEWAY, podium: {h: 10, floors: 3, style: CURTAIN({bay: 3})},
    style: RESIDENTIAL({balconyEvery: 2, stagger: true}), crown: 'lit-frame'})),
];

export function createCityTowers({scene, project}) {
  return createTowerSet({scene, project, specs: CITY_TOWER_SPECS, outlines: O, prefix: 'citytowers'});
}
