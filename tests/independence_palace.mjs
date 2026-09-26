// node --loader ./tests/three-loader.mjs tests/independence_palace.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {PALACE,createIndependencePalace} from '../3d/independence-palace.js';
const project=(lon,lat)=>[(lon-106.65)*111320*Math.cos(10.81*Math.PI/180),-(lat-10.81)*111320];
const scene=new THREE.Scene(), palace=createIndependencePalace({scene,project});
assert.equal(palace.group.parent,scene);
assert.equal(palace.state.drawCalls,9);
assert(palace.state.triangles<25000);
// The official 26 m is the top of the rooftop pavilion; only the flagpole rises above it.
const roof=new THREE.Box3().setFromObject(palace.group.getObjectByName('palace-roof'));
assert(Math.abs(roof.max.y-PALACE.height)<1e-3,'pavilion roof at 26 m');
const all=new THREE.Box3().setFromObject(palace.group);
assert(all.max.y<PALACE.height+6,'nothing but the flagpole above the pavilion');
// The main facade faces north-east, toward Lê Duẩn (+X east, -Z north).
const forward=new THREE.Vector3(0,0,1).transformDirection(palace.group.matrixWorld);
assert(forward.x>0.6&&forward.z<-0.7,'entrance faces north-east');
// The footprint matches the OSM outline's 85.8 m front and 76.5 m depth, give or take the eaves and front steps.
palace.group.updateWorldMatrix(true,true);
const local=new THREE.Box3();
for(const m of palace.group.children){if(m.name==='palace-concrete'){m.geometry.computeBoundingBox();local.union(m.geometry.boundingBox);}}
assert(Math.abs((local.max.x-local.min.x)-(PALACE.width+2*3.6))<0.5,'front block plus eaves');
palace.group.traverse(o=>{if(o.isMesh){assert(!o.name.startsWith('building'),'landmark avoids generic facade recoloring');for(const attr of Object.values(o.geometry.attributes))assert(attr.array.every(Number.isFinite));}});
const bytes=fs.readFileSync(new URL('../3d/assets/tiles/2_1.glb',import.meta.url));
const tile=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let original=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))original+=o.geometry.attributes.position.count/3;});
// The generic palace is its 21-corner OSM outline extruded: 42 wall and 19 roof triangles.
const removed=palace.replaceGeneric(tile.scene);assert.equal(removed,61,'remove exactly the generic palace');
let remaining=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))remaining+=o.geometry.attributes.position.count/3;});
assert.equal(original-remaining,removed);
assert.equal(palace.replaceGeneric(tile.scene),0,'replacement is idempotent');
const reload=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert.equal(palace.replaceGeneric(reload.scene),removed,'a re-streamed tile is replaced again');
palace.dispose();assert.equal(palace.group.parent,null);
console.log(`ok - palace placement, north-east facade, 26 m pavilion, ${palace.state.triangles} triangles, 9 batches; replaced ${removed} generic triangles`);
