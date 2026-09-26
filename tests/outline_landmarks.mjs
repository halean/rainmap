// node --loader ./tests/three-loader.mjs tests/outline_landmarks.mjs
// The landmarks built on OSM outlines with 3d/landmark-kit.js: the Majestic,
// the Rex, the Opera House and the State Bank.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {MAJESTIC,createMajestic} from '../3d/majestic.js';
import {REX,createRex} from '../3d/rex.js';
import {OPERA,createOperaHouse} from '../3d/opera-house.js';
import {STATE_BANK,createStateBank} from '../3d/state-bank.js';
import {POST_OFFICE,createPostOffice} from '../3d/post-office.js';
import {CITY_HALL,createCityHall} from '../3d/city-hall.js';
import {BITEXCO,createBitexco} from '../3d/bitexco.js';
import {LANDMARK81,createLandmark81} from '../3d/landmark81.js';
import {NHA_RONG,createNhaRong} from '../3d/nha-rong.js';
import {CONTINENTAL,createContinental} from '../3d/continental.js';
import {CITY_MUSEUM,createCityMuseum} from '../3d/city-museum.js';
import {TAN_DINH,createTanDinh} from '../3d/tan-dinh.js';
import {JADE_EMPEROR,createJadeEmperor} from '../3d/jade-emperor.js';
import {BINH_TAY,createBinhTay} from '../3d/binh-tay.js';
import {THIEN_HAU,createThienHau} from '../3d/thien-hau.js';
import {insideOutline} from '../3d/landmark-kit.js';
const project=(lon,lat)=>[(lon-106.65)*111320*Math.cos(10.81*Math.PI/180),-(lat-10.81)*111320];
async function tile(id){const b=fs.readFileSync(new URL(`../3d/assets/tiles/${id}.glb`,import.meta.url));return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
function buildingTriangles(root){const out=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(!o.isMesh||!o.name.startsWith('building'))return;const p=o.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i+=3){const c=new THREE.Vector3();for(let j=0;j<3;j++)c.add(v.fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld));out.push(c.multiplyScalar(1/3));}});return out;}

for (const [spec,create,tileId,expected,height,name] of [
  [MAJESTIC,createMajestic,'3_2',58,null,'Majestic'],   // 20-corner outline: 40 wall + 18 roof triangles
  [REX,createRex,'2_1',67,null,'Rex'],                 // 23-corner outline: 46 wall + 21 roof triangles
  [OPERA,createOperaHouse,'2_1',61,26,'Opera House'],  // 21 corners: 42 + 19
  [STATE_BANK,createStateBank,'2_2',49,null,'State Bank'], // 17 corners: 34 + 15
  [POST_OFFICE,createPostOffice,'2_1',74,null,'Post Office'], // 22 corners: 44 + 20, and the porch's 10
  [CITY_HALL,createCityHall,'2_1',142,null,'City Hall'],     // 48 corners: 96 + 46
  [BITEXCO,createBitexco,'2_2',106,269,'Bitexco'],            // the podium's 36 corners: 72 + 34; the tower is new
  [LANDMARK81,createLandmark81,'3_0',73,461.2,'Landmark 81'],  // the 461 m slab over the site's 25 corners: 50 + 23
  [NHA_RONG,createNhaRong,'3_2',10,null,'Nhà Rồng'],           // a rectangle: 8 + 2
  [CONTINENTAL,createContinental,'2_1',24,null,'Continental'], // a block round a courtyard: 8 + 8 walls, 8 roof
  [CITY_MUSEUM,createCityMuseum,'2_1',96,null,'City Museum'],  // 66 wall + 30 roof triangles
  [TAN_DINH,createTanDinh,'2_1',61,52.6,'Tân Định Church'],   // 21 corners: 42 + 19
  [JADE_EMPEROR,createJadeEmperor,'2_1',10,null,'Jade Emperor Pagoda'], // a rectangle: 8 + 2
  [BINH_TAY,createBinhTay,'0_3',51,null,'Bình Tây Market'],   // a ring round a courtyard: 17 edges' walls + 17 roof
  [THIEN_HAU,createThienHau,'0_3',118,null,'Thiên Hậu Temple'], // the halls round two light wells: 88 wall + 30 roof
]) {
  const scene=new THREE.Scene(), h=create({scene,project});
  assert.equal(h.group.parent,scene);
  assert(h.state.triangles<25000,`${name}: ${h.state.triangles} triangles`);
  const bounds=new THREE.Box3().setFromObject(h.group);
  if(height)assert(Math.abs(bounds.max.y-height)<1e-3,`${name}: height ${bounds.max.y}`);
  h.group.traverse(o=>{if(o.isMesh){assert(!o.name.startsWith('building'));for(const a of Object.values(o.geometry.attributes))assert(a.array.every(Number.isFinite));}});
  // The model covers its outline: every outline corner is within the body's bounding box.
  const inverse=h.group.matrixWorld.clone().invert();
  const t=await tile(tileId), before=buildingTriangles(t);
  const removed=h.replaceGeneric(t);
  assert.equal(removed,expected,`${name}: removes exactly its generic block`);
  const after=buildingTriangles(t);
  assert.equal(before.length-after.length,removed);
  // Nothing generic left inside the footprint, and nothing clearly outside it
  // touched. The generic walls stand exactly on the outline, so triangles are
  // judged by how far their centre is from it, not by which side it falls on.
  const local=p=>{const q=p.clone().applyMatrix4(inverse);return [q.x,q.z];};
  const area=spec.replaces??spec.outline;
  const gap=([u,v])=>Math.min(...area.map((a,i)=>{const b=area[(i+1)%area.length],du=b[0]-a[0],dv=b[1]-a[1],k=Math.max(0,Math.min(1,((u-a[0])*du+(v-a[1])*dv)/(du*du+dv*dv)));return Math.hypot(a[0]+k*du-u,a[1]+k*dv-v);}));
  const neighbour=p=>{const q=local(p);return !insideOutline(q,area)&&gap(q)>1;};
  assert.equal(after.filter(p=>{const q=local(p);return insideOutline(q,area)&&gap(q)>1;}).length,0,`${name}: generic block fully gone`);
  assert.equal(after.filter(neighbour).length,before.filter(neighbour).length,`${name}: neighbours untouched`);
  assert.equal(h.replaceGeneric(t),0,`${name}: idempotent`);
  assert.equal(h.replaceGeneric(await tile(tileId)),expected,`${name}: re-streamed tile replaced again`);
  h.dispose();assert.equal(h.group.parent,null);
  console.log(`ok - ${name}: ${h.state.triangles} triangles, ${h.state.drawCalls} batches, ${bounds.max.y.toFixed(1)} m; replaced exactly its ${removed} generic triangles, neighbours untouched`);
}
// The Rex crown stands on the corner tower, above the roof.
{const scene=new THREE.Scene(),r=createRex({scene,project});const gold=new THREE.Box3().setFromObject(r.group.getObjectByName('rex-gold'));
 assert(gold.max.y>r.state.height+3,'crown stands above the roof');r.dispose();console.log('ok - Rex crown on the corner tower');}
// The Opera House faces the square: its caryatids stand before the +z facade.
{const scene=new THREE.Scene(),o=createOperaHouse({scene,project});const g=o.group.getObjectByName('opera-statue').geometry;g.computeBoundingBox();
 assert(g.boundingBox.max.z>32.7,'caryatids in front of the facade');o.dispose();console.log('ok - Opera House faces Lam Sơn square');}
// Landmark 81's crown top is where the flag goes, and it is the model's highest point.
{const scene=new THREE.Scene(),l=createLandmark81({scene,project});const b=new THREE.Box3().setFromObject(l.group);
 assert(Math.abs(l.roof.y-b.max.y)<1e-3&&Math.abs(l.roof.y-461.2)<1e-3,'roof at the top');
 const local=l.group.worldToLocal(new THREE.Vector3(l.roof.x,l.roof.y,l.roof.z));const [c0,c1,d0,d1]=LANDMARK81.crown;
 assert(local.x>c0&&local.x<c1&&local.z>d0&&local.z<d1,'roof over OSM\'s 461.2 m part');l.dispose();console.log('ok - Landmark 81 hands the flag its crown top');}
